import crypto from "node:crypto";
import { execFile } from "node:child_process";
import net from "node:net";
import { config } from "./config.js";
import { db, getSetting, logEvent, now } from "./db.js";
import { generatePassword } from "./auth.js";
import { imageById } from "./images.js";
import * as lxd from "./lxd.js";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

// ---- locking & queue -------------------------------------------------------

const busy = new Map(); // instanceId -> operation label

export function lockInstance(id, op) {
  if (busy.has(id)) throw new HttpError(409, `Another operation is running (${busy.get(id)}). Try again in a moment.`, "busy");
  busy.set(id, op);
  return () => busy.delete(id);
}
export const busyOp = (id) => busy.get(id) || null;

const queue = [];
let running = 0;
const CONCURRENCY = 2;
function enqueue(job) {
  queue.push(job);
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running++;
    Promise.resolve()
      .then(job)
      .catch((e) => console.error("job failed", e))
      .finally(() => {
        running--;
        pump();
      });
  }
}

// ---- helpers ---------------------------------------------------------------

export const getRow = (id) => db.prepare("SELECT * FROM instances WHERE id = ?").get(id);

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE instances SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    now(),
    id,
  );
}

function shellQuote(v) {
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

function ufw(args) {
  if (!config.manageUfw) return Promise.resolve();
  return new Promise((resolve) => {
    execFile("ufw", ["status"], { timeout: 10_000 }, (err, out) => {
      if (err || !/Status: active/.test(out)) return resolve();
      execFile("ufw", args, { timeout: 30_000 }, () => resolve());
    });
  });
}

export function usage(userId, exceptId = null) {
  return db
    .prepare(
      `SELECT COUNT(*) AS instances, COALESCE(SUM(cpu),0) AS cpu, COALESCE(SUM(memory_mb),0) AS memory_mb,
              COALESCE(SUM(disk_gb),0) AS disk_gb
       FROM instances WHERE user_id = ? AND id IS NOT ?`,
    )
    .get(userId, exceptId);
}

/** Throw if the request would exceed the user's limits (admins are unlimited). */
export function assertQuota(user, { cpu, memory_mb, disk_gb, newInstance, exceptId }) {
  if (user.role === "admin") return;
  const u = usage(user.id, exceptId);
  const check = (limit, used, add, label) => {
    if (limit != null && used + add > limit)
      throw new HttpError(403, `This exceeds your ${label} limit (${used} used of ${limit}).`, "quota");
  };
  if (newInstance) check(user.max_instances, u.instances, 1, "instance");
  check(user.max_cpu, u.cpu, cpu, "vCPU");
  check(user.max_memory_mb, u.memory_mb, memory_mb, "memory (MB)");
  check(user.max_disk_gb, u.disk_gb, disk_gb, "disk (GB)");
}

/** True when nothing on the host is listening on this TCP port. */
function hostPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "0.0.0.0", exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** First port in the range that is neither assigned to a container nor used by another program. */
async function pickPort() {
  const start = Number(getSetting("ssh_port_start")) || 2200;
  const end = Number(getSetting("ssh_port_end")) || 2999;
  const used = new Set(db.prepare("SELECT ssh_port FROM instances WHERE ssh_port IS NOT NULL").all().map((r) => r.ssh_port));
  for (let p = start; p <= end; p++) if (!used.has(p) && (await hostPortFree(p))) return p;
  throw new HttpError(503, "No SSH port is left in the configured range. Ask the administrator to widen it.", "no_port");
}

async function allocateIpv4() {
  const { ipv4 } = await lxd.networkInfo();
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(ipv4);
  if (!m || Number(m[5]) < 16 || Number(m[5]) > 24) return null; // unusual network: fall back to plain DHCP
  const prefix = `${m[1]}.${m[2]}.${m[3]}.`;
  const used = new Set(db.prepare("SELECT ipv4 FROM instances WHERE ipv4 IS NOT NULL").all().map((r) => r.ipv4));
  used.add(ipv4.split("/")[0]);
  // Addresses already pinned or leased on this bridge by any LXD project (another panel, manual containers…)
  for (const ip of await lxd.addressesOnNetwork().catch(() => [])) used.add(ip);
  for (let i = 20; i < 250; i++) if (!used.has(prefix + i)) return prefix + i;
  return null;
}

async function waitForIpv4(name, timeoutMs = 90_000) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const state = await lxd.getState(name).catch(() => null);
    const a = lxd.addressesOf(state);
    if (a.ipv4) return a;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("The container did not get a network address in time.");
}

// Prepares root SSH login with a password on every supported distribution.
const SSH_BOOTSTRAP = `
set -eu
export DEBIAN_FRONTEND=noninteractive
try() { n=0; until "$@"; do n=$((n+1)); [ $n -ge 5 ] && return 1; sleep 3; done; }
if command -v apt-get >/dev/null 2>&1; then
  try apt-get update -q
  try apt-get install -y -q openssh-server sudo
elif command -v dnf >/dev/null 2>&1; then
  try dnf install -y -q openssh-server sudo
elif command -v yum >/dev/null 2>&1; then
  try yum install -y -q openssh-server sudo
elif command -v apk >/dev/null 2>&1; then
  try apk add --no-cache openssh sudo
elif command -v pacman >/dev/null 2>&1; then
  try pacman -Sy --noconfirm openssh sudo
elif command -v zypper >/dev/null 2>&1; then
  try zypper --non-interactive install openssh sudo
elif command -v emerge >/dev/null 2>&1; then
  emerge --quiet-build=y net-misc/openssh app-admin/sudo || true
fi
mkdir -p /etc/ssh/sshd_config.d /run/sshd /root/.ssh
chmod 700 /root/.ssh
for f in /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf; do
  [ -f "$f" ] || continue
  case "$f" in */00-boukarou.conf) continue;; esac
  sed -i -E 's/^[[:space:]]*(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|PermitEmptyPasswords)[[:space:]]+/# boukarou: &/' "$f"
done
if ! grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null; then
  printf 'Include /etc/ssh/sshd_config.d/*.conf\\n' | cat - /etc/ssh/sshd_config > /tmp/sshd_config && mv /tmp/sshd_config /etc/ssh/sshd_config
fi
cat > /etc/ssh/sshd_config.d/00-boukarou.conf <<'EOF'
PermitRootLogin yes
PasswordAuthentication yes
KbdInteractiveAuthentication no
PermitEmptyPasswords no
EOF
ssh-keygen -A >/dev/null 2>&1 || true
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true
  systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true
elif command -v rc-service >/dev/null 2>&1; then
  rc-update add sshd default >/dev/null 2>&1 || true
  rc-service sshd restart >/dev/null 2>&1 || true
else
  /usr/sbin/sshd >/dev/null 2>&1 || true
fi
`;

async function setRootPassword(name, password) {
  await lxd.exec(name, "chpasswd", { input: `root:${password}\n`, timeout: 60_000 });
  await lxd.exec(name, "passwd -u root >/dev/null 2>&1 || true; command -v bash >/dev/null 2>&1 && (usermod -s /bin/bash root 2>/dev/null || true); true", { timeout: 30_000 });
}

async function addSshKey(name, key) {
  if (!key) return;
  await lxd.exec(
    name,
    `mkdir -p /root/.ssh && chmod 700 /root/.ssh && printf '%s\\n' ${shellQuote(key)} >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys`,
    { timeout: 30_000 },
  );
}

/** Bring a freshly booted (or rebuilt) container to a reachable state. */
async function bootstrap(row, step) {
  step("network");
  const addr = await waitForIpv4(row.name);
  update(row.id, { ipv4: addr.ipv4, ipv6: addr.ipv6 });
  step("ssh");
  await lxd.exec(row.name, SSH_BOOTSTRAP, { timeout: 10 * 60_000 });
  step("credentials");
  const password = generatePassword(18);
  await setRootPassword(row.name, password);
  await addSshKey(row.name, row.ssh_public_key);
  return password;
}

export const SSH_KEY_RE = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/=]+( [^\r\n]{0,200})?$/;

// ---- create ----------------------------------------------------------------

export async function createInstance(user, { name, imageId, cpu, memoryMb, diskGb, sshKey }) {
  name = String(name || "").trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new HttpError(400, "Use 3–32 lowercase letters, digits or hyphens, starting with a letter.", "bad_name");
  const image = imageById(imageId);
  if (!image) throw new HttpError(400, "Choose an operating system.", "bad_image");
  const values = { cpu: Number(cpu), memory_mb: Number(memoryMb), disk_gb: Number(diskGb) };
  if (!Number.isInteger(values.cpu) || values.cpu < 1 || values.cpu > 256) throw new HttpError(400, "vCPU must be a whole number from 1.", "bad_cpu");
  if (!Number.isInteger(values.memory_mb) || values.memory_mb < 128) throw new HttpError(400, "Memory must be at least 128 MB.", "bad_memory");
  if (!Number.isInteger(values.disk_gb) || values.disk_gb < 1) throw new HttpError(400, "Disk must be at least 1 GB.", "bad_disk");
  const key = String(sshKey || "").trim();
  if (key && !SSH_KEY_RE.test(key)) throw new HttpError(400, "That SSH public key is not valid.", "bad_key");

  const id = crypto.randomUUID();
  const port = await pickPort();
  // quota + uniqueness + port in one transaction
  db.exec("BEGIN IMMEDIATE");
  try {
    assertQuota(user, { ...values, newInstance: true });
    if (db.prepare("SELECT 1 FROM instances WHERE name = ?").get(name)) throw new HttpError(409, "That name is already taken.", "name_taken");
    if (db.prepare("SELECT 1 FROM instances WHERE ssh_port = ?").get(port)) throw new HttpError(409, "Another container was created at the same moment. Try again.", "busy");
    db.prepare(
      `INSERT INTO instances(id,user_id,name,image,cpu,memory_mb,disk_gb,status,progress,ssh_port,ssh_public_key,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,'creating','queued',?,?,?,?)`,
    ).run(id, user.id, name, image.id, values.cpu, values.memory_mb, values.disk_gb, port, key || null, now(), now());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (await lxd.getInstance(name)) {
    db.prepare("DELETE FROM instances WHERE id = ?").run(id);
    throw new HttpError(409, "A container with that name already exists on this host.", "name_taken");
  }
  logEvent({ userId: user.id, actorId: user.id, instanceId: id, action: "instance.create", message: `${name} (${image.name} ${image.version})` });
  enqueue(() => provision(id));
  return getRow(id);
}

async function provision(id) {
  const unlock = (() => {
    try {
      return lockInstance(id, "create");
    } catch {
      return () => {};
    }
  })();
  let row = getRow(id);
  const step = (p) => update(id, { progress: p });
  try {
    const image = imageById(row.image);
    step("image");
    const existing = await lxd.getInstance(row.name);
    if (existing) await lxd.remove(row.name); // leftover from an earlier failed attempt
    await lxd.init(image.alias, row.name, {
      "limits.cpu": row.cpu,
      "limits.memory": `${row.memory_mb}MiB`,
      "security.nesting": "true",
      "user.boukarou.id": row.id,
    });
    step("configure");
    if (await lxd.supportsDiskQuota()) await lxd.overrideDevice(row.name, "root", { size: `${row.disk_gb}GiB` });
    const ip = await allocateIpv4();
    if (ip) {
      await lxd.overrideDevice(row.name, "eth0", { "ipv4.address": ip });
      update(id, { ipv4: ip });
    }
    await lxd.addProxy(row.name, `ssh${row.ssh_port}`, row.ssh_port);
    step("start");
    await lxd.start(row.name);
    row = getRow(id);
    const password = await bootstrap(row, step);
    await ufw(["allow", `${row.ssh_port}/tcp`]);
    update(id, { status: "running", progress: null, error: null, root_password_once: password });
    logEvent({ userId: row.user_id, instanceId: id, action: "instance.ready", message: row.name });
  } catch (error) {
    update(id, { status: "failed", progress: null, error: error.message.slice(0, 1500) });
    logEvent({ userId: row.user_id, instanceId: id, level: "error", action: "instance.failed", message: error.message.slice(0, 500) });
  } finally {
    unlock();
  }
}

export function retryProvisioning(row) {
  if (row.status !== "failed") throw new HttpError(409, "Only a failed container can be retried.", "bad_state");
  update(row.id, { status: "creating", progress: "queued", error: null });
  enqueue(() => provision(row.id));
}

// ---- power actions ---------------------------------------------------------

const ACTIONS = {
  start: { from: ["stopped"], run: lxd.start, to: "running" },
  stop: { from: ["running", "frozen"], run: lxd.stop, to: "stopped" },
  restart: { from: ["running"], run: lxd.restart, to: "running" },
  freeze: { from: ["running"], run: lxd.freeze, to: "frozen" },
  unfreeze: { from: ["frozen"], run: lxd.unfreeze, to: "running" },
};

export async function powerAction(row, action, actor) {
  const def = ACTIONS[action];
  if (!def) throw new HttpError(404, "Unknown action.", "bad_action");
  const live = await lxd.getInstance(row.name);
  const status = live ? lxd.mapStatus(live.status) : row.status;
  if (!def.from.includes(status)) throw new HttpError(409, `The container is ${status}.`, "bad_state");
  const unlock = lockInstance(row.id, action);
  try {
    await def.run(row.name);
    if (row.status !== "failed") update(row.id, { status: def.to });
    logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: `instance.${action}`, message: row.name });
  } finally {
    unlock();
  }
}

// ---- reinstall -------------------------------------------------------------

export function reinstall(row, { imageId, sshKey }, actor) {
  const image = imageById(imageId || row.image);
  if (!image) throw new HttpError(400, "Choose an operating system.", "bad_image");
  if (["creating", "deleting", "reinstalling"].includes(row.status)) throw new HttpError(409, "The container is busy.", "busy");
  const key = sshKey == null ? row.ssh_public_key : String(sshKey).trim() || null;
  if (key && !SSH_KEY_RE.test(key)) throw new HttpError(400, "That SSH public key is not valid.", "bad_key");
  const unlock = lockInstance(row.id, "reinstall");
  update(row.id, { status: "reinstalling", progress: "image", image: image.id, ssh_public_key: key, error: null });
  logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "instance.reinstall", message: `${image.name} ${image.version}` });
  enqueue(async () => {
    const step = (p) => update(row.id, { progress: p });
    try {
      await lxd.stop(row.name).catch(() => undefined);
      await lxd.rebuild(image.alias, row.name);
      step("start");
      await lxd.start(row.name);
      const password = await bootstrap(getRow(row.id), step);
      update(row.id, { status: "running", progress: null, root_password_once: password });
    } catch (error) {
      update(row.id, { status: "failed", progress: null, error: error.message.slice(0, 1500) });
      logEvent({ userId: row.user_id, instanceId: row.id, level: "error", action: "instance.failed", message: error.message.slice(0, 500) });
    } finally {
      unlock();
    }
  });
}

// ---- resize ----------------------------------------------------------------

export async function resize(row, owner, { cpu, memoryMb, diskGb }, actor) {
  const values = {
    cpu: cpu == null ? row.cpu : Number(cpu),
    memory_mb: memoryMb == null ? row.memory_mb : Number(memoryMb),
    disk_gb: diskGb == null ? row.disk_gb : Number(diskGb),
  };
  if (!Number.isInteger(values.cpu) || values.cpu < 1) throw new HttpError(400, "vCPU must be a whole number from 1.", "bad_cpu");
  if (!Number.isInteger(values.memory_mb) || values.memory_mb < 128) throw new HttpError(400, "Memory must be at least 128 MB.", "bad_memory");
  if (!Number.isInteger(values.disk_gb) || values.disk_gb < 1) throw new HttpError(400, "Disk must be at least 1 GB.", "bad_disk");
  if (values.disk_gb < row.disk_gb) throw new HttpError(400, "Disk can only grow. Shrinking could destroy data.", "disk_shrink");
  assertQuota(owner, { ...values, newInstance: false, exceptId: row.id });
  const unlock = lockInstance(row.id, "resize");
  try {
    await lxd.setConfig(row.name, { "limits.cpu": values.cpu, "limits.memory": `${values.memory_mb}MiB` });
    if (values.disk_gb !== row.disk_gb && (await lxd.supportsDiskQuota()))
      await lxd.overrideDevice(row.name, "root", { size: `${values.disk_gb}GiB` });
    update(row.id, values);
    logEvent({
      userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "instance.resize",
      message: `${values.cpu} vCPU | ${values.memory_mb} MB | ${values.disk_gb} GB`,
    });
  } finally {
    unlock();
  }
}

// ---- root password ---------------------------------------------------------

export async function resetRootPassword(row, actor) {
  const live = await lxd.getInstance(row.name);
  if (!live || lxd.mapStatus(live.status) !== "running") throw new HttpError(409, "Start the container first.", "bad_state");
  const unlock = lockInstance(row.id, "password");
  try {
    const password = generatePassword(18);
    await setRootPassword(row.name, password);
    logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "instance.root_password", message: row.name });
    return password;
  } finally {
    unlock();
  }
}

// ---- snapshots -------------------------------------------------------------

export const SNAP_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export async function createSnapshot(row, owner, name, actor) {
  const snap = String(name || "").trim() || `snap-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
  if (!SNAP_RE.test(snap)) throw new HttpError(400, "Snapshot names use letters, digits, dots, dashes or underscores.", "bad_snapshot");
  const existing = await lxd.listSnapshots(row.name);
  if (owner.role !== "admin" && owner.max_snapshots != null && existing.length >= owner.max_snapshots)
    throw new HttpError(403, `You can keep ${owner.max_snapshots} snapshot(s) per container. Delete one first.`, "quota");
  if (existing.some((s) => s.name === snap)) throw new HttpError(409, "A snapshot with that name already exists.", "snapshot_exists");
  const unlock = lockInstance(row.id, "snapshot");
  try {
    await lxd.createSnapshot(row.name, snap);
    logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "snapshot.create", message: snap });
  } finally {
    unlock();
  }
}

export async function restoreSnapshot(row, snap, actor) {
  if (!SNAP_RE.test(snap)) throw new HttpError(400, "Invalid snapshot.", "bad_snapshot");
  const unlock = lockInstance(row.id, "restore");
  try {
    await lxd.restoreSnapshot(row.name, snap);
    const live = await lxd.getInstance(row.name);
    if (live) update(row.id, { status: lxd.mapStatus(live.status) });
    logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "snapshot.restore", message: snap });
  } finally {
    unlock();
  }
}

export async function deleteSnapshot(row, snap, actor) {
  if (!SNAP_RE.test(snap)) throw new HttpError(400, "Invalid snapshot.", "bad_snapshot");
  const unlock = lockInstance(row.id, "snapshot");
  try {
    await lxd.deleteSnapshot(row.name, snap);
    logEvent({ userId: row.user_id, actorId: actor.id, instanceId: row.id, action: "snapshot.delete", message: snap });
  } finally {
    unlock();
  }
}

// ---- traffic limiting ------------------------------------------------------

export async function setTrafficBlocked(row, blocked) {
  if (blocked) await lxd.overrideDevice(row.name, "eth0", { "limits.ingress": "1kbit", "limits.egress": "1kbit" });
  else {
    await lxd.unsetDevice(row.name, "eth0", "limits.ingress").catch(() => undefined);
    await lxd.unsetDevice(row.name, "eth0", "limits.egress").catch(() => undefined);
  }
  update(row.id, { traffic_blocked: blocked ? 1 : 0 });
}

// ---- delete ----------------------------------------------------------------

let removeDomainsHook = async () => {};
export function onDelete(fn) {
  removeDomainsHook = fn;
}

export async function deleteInstance(row, actor) {
  const unlock = lockInstance(row.id, "delete");
  update(row.id, { status: "deleting", progress: null });
  try {
    await removeDomainsHook(row.id);
    if (await lxd.getInstance(row.name)) await lxd.remove(row.name);
    if (row.ssh_port) await ufw(["delete", "allow", `${row.ssh_port}/tcp`]);
    db.prepare("DELETE FROM instances WHERE id = ?").run(row.id);
    logEvent({ userId: row.user_id, actorId: actor?.id ?? null, instanceId: row.id, action: "instance.delete", message: row.name });
  } catch (error) {
    update(row.id, { status: "failed", error: `Delete failed: ${error.message}`.slice(0, 1500) });
    throw error;
  } finally {
    unlock();
  }
}

// ---- startup recovery ------------------------------------------------------

export function recoverInterrupted() {
  const rows = db.prepare("SELECT * FROM instances WHERE status IN ('creating','reinstalling','deleting')").all();
  for (const row of rows) {
    if (row.status === "deleting") {
      enqueue(() => deleteInstance(row, null).catch(() => undefined));
    } else if (row.status === "creating") {
      update(row.id, { status: "creating", progress: "queued" });
      enqueue(() => provision(row.id));
    } else {
      update(row.id, { status: "failed", progress: null, error: "The panel restarted during the reinstall. Run it again." });
    }
  }
}

// ---- public shape ----------------------------------------------------------

export function publicInstance(row, extra = {}) {
  const image = imageById(row.image);
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    image: image ? { id: image.id, family: image.family, name: image.name, version: image.version } : { id: row.image, family: "linux", name: row.image, version: "" },
    cpu: row.cpu,
    memoryMb: row.memory_mb,
    diskGb: row.disk_gb,
    status: row.status,
    progress: row.progress,
    error: row.error,
    busy: busyOp(row.id),
    sshPort: row.ssh_port,
    sshHost: getSetting("public_host") || null,
    ipv4: row.ipv4,
    ipv6: row.ipv6,
    hasSshKey: !!row.ssh_public_key,
    trafficBlocked: !!row.traffic_blocked,
    passwordPending: !!row.root_password_once,
    createdAt: row.created_at,
    ...extra,
  };
}
