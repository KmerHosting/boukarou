// Browser <-> LXD interactive exec bridge (root shell inside the container).
import WebSocket, { WebSocketServer } from "ws";
import { config } from "./config.js";
import { cookieToken, sessionUser } from "./auth.js";
import { getRow } from "./instances.js";
import { logEvent } from "./db.js";
import * as lxd from "./lxd.js";

const SHELL = "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi";
const MAX_PER_USER = 6;
const open = new Map(); // userId -> count

export function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    const m = url.pathname.match(/^\/api\/instances\/([0-9a-f-]{36})\/terminal$/);
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!m) return reject(404, "Not Found");
    // same-origin only
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return reject(403, "Forbidden");
      } catch {
        return reject(403, "Forbidden");
      }
    }
    const user = sessionUser(cookieToken(req));
    if (!user) return reject(401, "Unauthorized");
    const row = getRow(m[1]);
    if (!row || (row.user_id !== user.id && user.role !== "admin")) return reject(404, "Not Found");
    if ((open.get(user.id) || 0) >= MAX_PER_USER) return reject(429, "Too Many Requests");

    const cols = Math.min(500, Math.max(20, Number(url.searchParams.get("cols")) || 100));
    const rows = Math.min(300, Math.max(5, Number(url.searchParams.get("rows")) || 30));

    let op;
    try {
      op = await lxd.socketRequest(
        "POST",
        `/1.0/instances/${encodeURIComponent(row.name)}/exec?project=${encodeURIComponent(config.project)}`,
        {
          command: ["/bin/sh", "-c", SHELL],
          environment: { TERM: "xterm-256color", HOME: "/root", USER: "root", LANG: "C.UTF-8" },
          "wait-for-websocket": true,
          interactive: true,
          width: cols,
          height: rows,
          user: 0,
          group: 0,
          cwd: "/root",
        },
      );
    } catch (e) {
      return reject(502, "Bad Gateway");
    }
    const fds = op.metadata?.metadata?.fds || {};
    const opPath = op.operation;

    wss.handleUpgrade(req, socket, head, (client) => {
      open.set(user.id, (open.get(user.id) || 0) + 1);
      logEvent({ userId: row.user_id, actorId: user.id, instanceId: row.id, action: "terminal.open", message: row.name });
      const data = new WebSocket(lxd.wsUrl(`${opPath}/websocket?secret=${fds["0"]}`));
      const control = new WebSocket(lxd.wsUrl(`${opPath}/websocket?secret=${fds.control}`));
      let closed = false;
      const closeAll = () => {
        if (closed) return;
        closed = true;
        open.set(user.id, Math.max(0, (open.get(user.id) || 1) - 1));
        for (const s of [client, data, control]) {
          try {
            s.close();
          } catch {}
        }
      };
      const pending = [];
      data.on("open", () => {
        for (const p of pending) data.send(p);
        pending.length = 0;
      });
      data.on("message", (msg, isBinary) => {
        if (!isBinary && msg.length === 0) return closeAll(); // LXD signals EOF with an empty text frame
        if (client.readyState === WebSocket.OPEN) client.send(msg, { binary: true });
      });
      data.on("close", closeAll);
      data.on("error", closeAll);
      let pendingSize = null;
      const sendSize = (c, r) => control.send(JSON.stringify({ command: "window-resize", args: { width: String(c), height: String(r) } }));
      control.on("open", () => {
        if (pendingSize) sendSize(...pendingSize);
      });
      control.on("error", () => {});
      control.on("close", closeAll);

      client.on("message", (msg) => {
        let parsed;
        try {
          parsed = JSON.parse(msg.toString());
        } catch {
          return;
        }
        if (parsed.t === "i" && typeof parsed.d === "string") {
          const buf = Buffer.from(parsed.d, "utf8");
          if (data.readyState === WebSocket.OPEN) data.send(buf, { binary: true });
          else pending.push(buf);
        } else if (parsed.t === "r") {
          const c = Math.min(500, Math.max(20, Number(parsed.c) || cols));
          const r = Math.min(300, Math.max(5, Number(parsed.r) || rows));
          if (control.readyState === WebSocket.OPEN) sendSize(c, r);
          else pendingSize = [c, r];
        }
      });
      client.on("close", closeAll);
      client.on("error", closeAll);
      // keep proxies from dropping idle sessions
      const ping = setInterval(() => {
        if (closed) return clearInterval(ping);
        try {
          client.ping();
        } catch {}
      }, 25_000);
    });
  });
}
