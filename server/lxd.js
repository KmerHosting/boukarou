// Thin layer over the LXD/Incus CLI (for everything) and the local REST socket
// (for interactive terminals). All instances live in one dedicated project.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { config } from "./config.js";

let binary = null;

export function lxcBinary() {
  if (binary) return binary;
  const candidates = [config.lxcBinary, "/snap/bin/lxc", "/usr/bin/incus", "/usr/sbin/lxc", "/usr/bin/lxc"].filter(Boolean);
  binary = candidates.find((p) => fs.existsSync(p)) || "lxc";
  return binary;
}

export class LxdError extends Error {}

/** Run the CLI. `input` is written to stdin (used for secrets so they never hit argv). */
export function run(args, { timeout = 120_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(lxcBinary(), args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new LxdError(`Timed out after ${Math.round(timeout / 1000)}s: ${args.slice(0, 2).join(" ")}`));
    }, timeout);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 20e6) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new LxdError(e.code === "ENOENT" ? "LXD is not installed on this host." : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new LxdError((stderr || stdout).trim().replace(/^Error:\s*/, "").slice(-1500) || `exit ${code}`));
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

const P = () => ["--project", config.project];

// ---- runtime setup ---------------------------------------------------------

export async function runtimeInfo() {
  try {
    const { stdout } = await run(["query", "/1.0"], { timeout: 10_000 });
    const info = JSON.parse(stdout);
    return {
      ok: true,
      server: info.environment?.server || "lxd",
      version: info.environment?.server_version || "",
      kernel: info.environment?.kernel_version || "",
      storageDriver: await poolDriver().catch(() => ""),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

let cachedDriver = null;
export async function poolDriver() {
  if (cachedDriver) return cachedDriver;
  const { stdout } = await run(["query", `/1.0/storage-pools/${encodeURIComponent(config.pool)}`], { timeout: 10_000 });
  cachedDriver = JSON.parse(stdout).driver;
  return cachedDriver;
}

/** Disk quotas only work on drivers that support them. */
export async function supportsDiskQuota() {
  const d = await poolDriver().catch(() => "dir");
  return ["btrfs", "zfs", "lvm", "ceph"].includes(d);
}

export async function ensureRuntime() {
  // dedicated bridge so we never share DHCP space with anything else on the host
  const networks = JSON.parse((await run(["query", "/1.0/networks?recursion=1"], { timeout: 15_000 })).stdout);
  if (!networks.some((n) => n.name === config.network)) {
    await run(["network", "create", config.network, "ipv4.address=auto", "ipv4.nat=true", "ipv6.address=auto", "ipv6.nat=true"]);
  }
  const projects = JSON.parse((await run(["query", "/1.0/projects?recursion=1"], { timeout: 15_000 })).stdout);
  if (!projects.some((p) => p.name === config.project)) {
    await run([
      "project", "create", config.project,
      "-c", "features.images=false",
      "-c", "features.profiles=true",
      "-c", "features.storage.volumes=true",
      "-c", "features.networks=false",
    ]);
  }
  const profile = JSON.parse((await run(["query", `/1.0/profiles/default?project=${encodeURIComponent(config.project)}`])).stdout);
  const devices = profile.devices || {};
  const want = {
    eth0: { type: "nic", name: "eth0", network: config.network },
    root: { type: "disk", path: "/", pool: config.pool },
  };
  if (JSON.stringify(devices.eth0) !== JSON.stringify(want.eth0) || devices.root?.pool !== config.pool) {
    const body = JSON.stringify({ ...profile, devices: { ...devices, ...want } });
    await run(["query", "-X", "PUT", "-d", body, `/1.0/profiles/default?project=${encodeURIComponent(config.project)}`]);
  }
}

/** Let containers reach the bridge's DHCP/DNS when UFW is active (it drops them by default). */
export async function ensureFirewall() {
  if (!config.manageUfw) return;
  const { execFile } = await import("node:child_process");
  const ufw = (args) => new Promise((resolve) => execFile("ufw", args, { timeout: 30_000 }, (err, out) => resolve(err ? "" : String(out))));
  if (!/Status: active/.test(await ufw(["status"]))) return;
  const n = config.network;
  for (const [port, proto] of [["53", "udp"], ["53", "tcp"], ["67", "udp"], ["547", "udp"]])
    await ufw(["allow", "in", "on", n, "to", "any", "port", port, "proto", proto]);
  await ufw(["route", "allow", "in", "on", n]);
  await ufw(["route", "allow", "out", "on", n]);
}

/** Every IPv4 in use on our bridge, across all LXD projects (static leases and live addresses). */
export async function addressesOnNetwork() {
  const { stdout } = await run(["query", "/1.0/instances?recursion=2&all-projects=true"], { timeout: 30_000 });
  const out = new Set();
  for (const inst of JSON.parse(stdout)) {
    for (const dev of Object.values(inst.expanded_devices || {})) {
      if (dev.type === "nic" && dev.network === config.network && dev["ipv4.address"]) out.add(dev["ipv4.address"]);
    }
    const onBridge = Object.values(inst.expanded_devices || {}).some((d) => d.type === "nic" && d.network === config.network);
    if (onBridge) for (const net of Object.values(inst.state?.network || {}))
      for (const a of net.addresses || []) if (a.family === "inet" && a.scope === "global") out.add(a.address);
  }
  return [...out];
}

export async function networkInfo() {
  const { stdout } = await run(["query", `/1.0/networks/${encodeURIComponent(config.network)}`], { timeout: 10_000 });
  const n = JSON.parse(stdout);
  return { ipv4: n.config?.["ipv4.address"] || "", ipv6: n.config?.["ipv6.address"] || "" };
}

// ---- instances -------------------------------------------------------------

export async function listInstances() {
  const { stdout } = await run(["query", `/1.0/instances?recursion=2&project=${encodeURIComponent(config.project)}`], { timeout: 30_000 });
  return JSON.parse(stdout);
}

export async function getInstance(name) {
  try {
    const { stdout } = await run(["query", `/1.0/instances/${name}?recursion=1&project=${encodeURIComponent(config.project)}`], { timeout: 20_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export async function getState(name) {
  const { stdout } = await run(["query", `/1.0/instances/${name}/state?project=${encodeURIComponent(config.project)}`], { timeout: 20_000 });
  return JSON.parse(stdout);
}

export function mapStatus(s) {
  switch (String(s || "").toLowerCase()) {
    case "running": return "running";
    case "stopped": return "stopped";
    case "frozen": return "frozen";
    case "error": return "failed";
    default: return "unknown";
  }
}

export function addressesOf(state) {
  let ipv4 = null;
  let ipv6 = null;
  for (const [ifname, net] of Object.entries(state?.network || {})) {
    if (ifname === "lo") continue;
    for (const a of net.addresses || []) {
      if (a.scope !== "global") continue;
      if (a.family === "inet" && !ipv4) ipv4 = a.address;
      if (a.family === "inet6" && !ipv6) ipv6 = a.address;
    }
  }
  return { ipv4, ipv6 };
}

export const init = (image, name, cfg) => {
  const args = ["init", image, name, ...P()];
  for (const [k, v] of Object.entries(cfg)) args.push("-c", `${k}=${v}`);
  return run(args, { timeout: 15 * 60_000 }); // first use of an image downloads it
};
export const start = (name) => run(["start", name, ...P()], { timeout: 120_000 });
export const stop = (name) => run(["stop", name, ...P(), "--timeout", "30", "--force"], { timeout: 90_000 });
export const restart = (name) => run(["restart", name, ...P(), "--timeout", "30", "--force"], { timeout: 120_000 });
export const freeze = (name) => run(["pause", name, ...P()], { timeout: 60_000 });
export const unfreeze = (name) => run(["start", name, ...P()], { timeout: 60_000 });
export const remove = (name) => run(["delete", name, ...P(), "--force"], { timeout: 180_000 });
export const rebuild = (image, name) => run(["rebuild", image, name, ...P(), "--force"], { timeout: 15 * 60_000 });

export const setConfig = (name, pairs) =>
  run(["config", "set", name, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`), ...P()], { timeout: 60_000 });

export async function overrideDevice(name, device, pairs) {
  // `override` copies a profile device onto the instance; fails harmlessly if already local
  await run(["config", "device", "override", name, device, ...P()], { timeout: 30_000 }).catch(() => undefined);
  await run(["config", "device", "set", name, device, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`), ...P()], {
    timeout: 60_000,
  });
}
export const unsetDevice = (name, device, key) =>
  run(["config", "device", "unset", name, device, key, ...P()], { timeout: 30_000 });

export const addProxy = (name, device, listenPort, connectPort = 22) =>
  run([
    "config", "device", "add", name, device, "proxy",
    `listen=tcp:0.0.0.0:${listenPort}`, `connect=tcp:127.0.0.1:${connectPort}`, ...P(),
  ], { timeout: 30_000 });

export const exec = (name, script, { timeout = 240_000, input } = {}) =>
  run(["exec", name, ...P(), "--", "sh", "-c", script], { timeout, input });

// ---- snapshots -------------------------------------------------------------

export async function listSnapshots(name) {
  const { stdout } = await run(["query", `/1.0/instances/${name}/snapshots?recursion=1&project=${encodeURIComponent(config.project)}`], { timeout: 20_000 });
  return JSON.parse(stdout).map((s) => ({ name: s.name, createdAt: Date.parse(s.created_at), stateful: !!s.stateful, size: s.size ?? null }));
}
export const createSnapshot = (name, snap) => run(["snapshot", name, snap, ...P()], { timeout: 15 * 60_000 });
export const deleteSnapshot = (name, snap) => run(["delete", `${name}/${snap}`, ...P()], { timeout: 5 * 60_000 });
export const restoreSnapshot = (name, snap) => run(["restore", name, snap, ...P()], { timeout: 15 * 60_000 });

// ---- REST over the unix socket (interactive exec) --------------------------

export function socketRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: config.lxdSocket,
        path,
        method,
        headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            if (json.type === "error") reject(new LxdError(json.error || "LXD error"));
            else resolve(json);
          } catch {
            reject(new LxdError("Invalid response from LXD"));
          }
        });
      },
    );
    req.on("error", (e) => reject(new LxdError(e.message)));
    req.setTimeout(30_000, () => req.destroy(new Error("LXD socket timeout")));
    if (data) req.write(data);
    req.end();
  });
}

export function wsUrl(path) {
  return `ws+unix://${config.lxdSocket}:${path}`;
}
