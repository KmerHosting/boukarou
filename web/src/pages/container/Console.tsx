import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { t } from "../../lib/i18n";
import type { Instance } from "../../lib/types";
import { Button } from "../../components/ui";

export function ConsoleTab({ inst }: { inst: Instance }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [attempt, setAttempt] = useState(0);
  const running = inst.status === "running";

  useEffect(() => {
    if (!running || !box.current) return;
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 13.5,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: "#121110", foreground: "#e9e6df", cursor: "#e07a52", selectionBackground: "#5a3a2c" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current);
    fit.fit();
    setState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/instances/${inst.id}/terminal?cols=${term.cols}&rows=${term.rows}`);
    ws.binaryType = "arraybuffer";
    const decoder = new TextDecoder();
    ws.onopen = () => {
      setState("open");
      term.focus();
    };
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : decoder.decode(new Uint8Array(e.data), { stream: true }));
    ws.onclose = () => {
      setState("closed");
      term.write(`\r\n\x1b[2m${t("Session closed.")}\x1b[0m\r\n`);
    };
    const input = term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "i", d })));
    const resize = term.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "r", c: cols, r: rows })));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      input.dispose();
      resize.dispose();
      ws.close();
      term.dispose();
    };
  }, [inst.id, running, attempt]);

  if (!running) {
    return <div className="card card-pad"><p className="muted">{t("Start the container to open a console.")}</p></div>;
  }

  return (
    <div>
      <div className="term-bar">
        <span className="muted" style={{ fontSize: 13 }}>
          {state === "open" ? t("Connected as root.") : state === "connecting" ? t("Connecting…") : t("Disconnected.")}
        </span>
        {state === "closed" && <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>{t("Reconnect")}</Button>}
      </div>
      <div className="term-wrap">
        <div ref={box} className="term" />
      </div>
    </div>
  );
}
