import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { allSettings, db, DEFAULT_SETTINGS, logEvent, now, setSetting } from "./db.js";
import * as auth from "./auth.js";
import { IMAGES, availableImages } from "./images.js";
import * as inst from "./instances.js";
import * as lxd from "./lxd.js";
import { series, trafficFor, period } from "./metrics.js";
import * as domains from "./domains.js";
import { translate } from "./i18n.js";

const { HttpError } = inst;
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "64kb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  next();
});

// ---- auth plumbing ---------------------------------------------------------

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use("/api", (req, res, next) => {
  // Mutating calls must come from our own JS (blocks cross-site form posts).
  if (!["GET", "HEAD"].includes(req.method) && req.get("x-boukarou") !== "1")
    return res.status(403).json({ error: "Missing request header.", code: "csrf" });
  req.token = auth.cookieToken(req);
  req.user = auth.sessionUser(req.token);
  res.setHeader("Cache-Control", "no-store");
  // translate every JSON error for French clients
  const lang = req.get("x-lang");
  if (lang === "fr") {
    const json = res.json.bind(res);
    res.json = (body) => json(body && typeof body.error === "string" ? { ...body, error: translate(body.error, lang) } : body);
  }
  next();
});

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in.", code: "auth" });
  if (req.user.must_change_password && !req.originalUrl.startsWith("/api/account/password") && !req.originalUrl.startsWith("/api/auth/"))
    return res.status(403).json({ error: "Choose a new password first.", code: "must_change_password" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(404).json({ error: "Not found.", code: "not_found" });
  next();
}

function loadInstance(req, res, next) {
  const row = inst.getRow(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin"))
    return res.status(404).json({ error: "Container not found.", code: "not_found" });
  req.instance = row;
  req.owner = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  next();
}

// ---- auth ------------------------------------------------------------------

function meResponse(user) {
  return { user: auth.publicUser(user), version: pkg.version };
}

app.get("/api/auth/me", (req, res) => res.json(req.user ? meResponse(req.user) : { user: null, version: pkg.version }));

app.post("/api/auth/login", h(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const ip = auth.clientIp(req);
  if (auth.isThrottled(`ip:${ip}`, `u:${username}`))
    throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.", "throttled");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  const ok = user ? await auth.verifyPassword(password, user.password_hash) : await auth.verifyPassword(password, "scrypt$AAAA$AAAA").catch(() => false);
  if (!user || !ok || user.disabled) {
    auth.recordFailure(`ip:${ip}`, `u:${username}`);
    if (user && ok && user.disabled) throw new HttpError(403, "This account is disabled. Contact the administrator.", "disabled");
    throw new HttpError(401, "Wrong username or password.", "bad_credentials");
  }
  if (user.totp_enabled) return res.json({ twoFactor: true, ticket: auth.issueTwoFactorTicket(user.id) });
  auth.clearFailures(`u:${username}`);
  auth.setSessionCookie(req, res, auth.createSession(user.id, req));
  logEvent({ userId: user.id, actorId: user.id, action: "auth.login", message: ip });
  res.json(meResponse(user));
}));

app.post("/api/auth/2fa", h(async (req, res) => {
  const ip = auth.clientIp(req);
  if (auth.isThrottled(`ip:${ip}`)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.", "throttled");
  const userId = auth.consumeTwoFactorTicket(String(req.body?.ticket || ""), { keep: true });
  if (!userId) throw new HttpError(401, "Your sign-in expired. Start again.", "ticket_expired");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!auth.verifyTotp(user.totp_secret, req.body?.code)) {
    auth.recordFailure(`ip:${ip}`, `u:${user.username}`);
    throw new HttpError(401, "That code is not valid.", "bad_code");
  }
  auth.consumeTwoFactorTicket(String(req.body.ticket));
  auth.setSessionCookie(req, res, auth.createSession(user.id, req));
  logEvent({ userId: user.id, actorId: user.id, action: "auth.login", message: `${ip} (2FA)` });
  res.json(meResponse(user));
}));

app.post("/api/auth/logout", (req, res) => {
  auth.destroySession(req.token);
  res.clearCookie(auth.SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ---- account ---------------------------------------------------------------

app.post("/api/account/password", requireUser, h(async (req, res) => {
  if (req.user.role === "admin")
    throw new HttpError(403, "The administrator password can only be changed on the server: sudo boukarou reset-admin-password", "admin_cli_only");
  const { current, password } = req.body || {};
  if (!(await auth.verifyPassword(String(current || ""), req.user.password_hash)))
    throw new HttpError(401, "Your current password is not correct.", "bad_current");
  if (!auth.validPassword(password)) throw new HttpError(400, "Use at least 10 characters.", "weak_password");
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await auth.hashPassword(password), req.user.id);
  auth.destroyUserSessions(req.user.id, req.token);
  logEvent({ userId: req.user.id, actorId: req.user.id, action: "account.password" });
  res.json({ ok: true });
}));

app.post("/api/account/2fa/setup", requireUser, (req, res) => {
  if (req.user.totp_enabled) throw new HttpError(409, "Two-factor sign-in is already on.", "already");
  const secret = auth.newTotpSecret();
  db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, req.user.id);
  res.json({ secret, uri: auth.totpUri(secret, req.user.username, `Boukarou (${os.hostname()})`) });
});
app.post("/api/account/2fa/enable", requireUser, (req, res) => {
  if (!req.user.totp_secret || !auth.verifyTotp(req.user.totp_secret, req.body?.code))
    throw new HttpError(400, "That code is not valid. Check the time on your phone.", "bad_code");
  db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(req.user.id);
  logEvent({ userId: req.user.id, actorId: req.user.id, action: "account.2fa_on" });
  res.json({ ok: true });
});
app.post("/api/account/2fa/disable", requireUser, h(async (req, res) => {
  if (!(await auth.verifyPassword(String(req.body?.password || ""), req.user.password_hash)))
    throw new HttpError(401, "Your password is not correct.", "bad_current");
  if (!auth.verifyTotp(req.user.totp_secret, req.body?.code)) throw new HttpError(400, "That code is not valid.", "bad_code");
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(req.user.id);
  logEvent({ userId: req.user.id, actorId: req.user.id, action: "account.2fa_off" });
  res.json({ ok: true });
}));
app.post("/api/account/sessions/revoke", requireUser, (req, res) => {
  auth.destroyUserSessions(req.user.id, req.token);
  res.json({ ok: true });
});

// ---- containers ------------------------------------------------------------

app.get("/api/images", requireUser, (req, res) => res.json({ images: availableImages() }));

function usageOf(user) {
  const u = inst.usage(user.id);
  return { instances: u.instances, cpu: u.cpu, memoryMb: u.memory_mb, diskGb: u.disk_gb };
}

app.get("/api/overview", requireUser, h(async (req, res) => {
  const rows = db.prepare("SELECT * FROM instances WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json({
    instances: rows.map((r) => inst.publicInstance(r)),
    usage: usageOf(req.user),
    limits: auth.publicUser(req.user).limits,
    diskQuotaEnforced: await lxd.supportsDiskQuota(),
    host: { cpus: os.cpus().length, memoryMb: Math.round(os.totalmem() / 1048576) },
  });
}));

app.post("/api/instances", requireUser, h(async (req, res) => {
  const row = await inst.createInstance(req.user, req.body || {});
  res.status(201).json({ instance: inst.publicInstance(row) });
}));

app.get("/api/instances/:id", requireUser, loadInstance, h(async (req, res) => {
  const row = req.instance;
  let live = null;
  if (!["creating", "deleting"].includes(row.status)) {
    const state = await lxd.getState(row.name).catch(() => null);
    if (state) {
      live = {
        status: lxd.mapStatus(state.status),
        memUsed: state.memory?.usage || 0,
        processes: state.processes || 0,
        pid: state.pid || 0,
        ...lxd.addressesOf(state),
      };
    }
  }
  const owner = req.owner;
  res.json({
    instance: inst.publicInstance(row, { owner: { id: owner.id, username: owner.username } }),
    live,
    traffic: { ...trafficFor(row.id), quotaGb: owner.role === "admin" ? null : owner.traffic_gb },
    limits: { maxSnapshots: owner.role === "admin" ? null : owner.max_snapshots },
    diskQuotaEnforced: await lxd.supportsDiskQuota(),
  });
}));

app.post("/api/instances/:id/actions", requireUser, loadInstance, h(async (req, res) => {
  await inst.powerAction(req.instance, String(req.body?.action || ""), req.user);
  res.json({ instance: inst.publicInstance(inst.getRow(req.instance.id)) });
}));

app.post("/api/instances/:id/retry", requireUser, loadInstance, (req, res) => {
  inst.retryProvisioning(req.instance);
  res.json({ ok: true });
});

app.post("/api/instances/:id/reinstall", requireUser, loadInstance, (req, res) => {
  if (String(req.body?.confirm || "") !== req.instance.name)
    throw new HttpError(400, "Type the container name to confirm.", "confirm");
  inst.reinstall(req.instance, req.body || {}, req.user);
  res.json({ ok: true });
});

app.post("/api/instances/:id/resize", requireUser, loadInstance, h(async (req, res) => {
  await inst.resize(req.instance, req.owner, req.body || {}, req.user);
  res.json({ instance: inst.publicInstance(inst.getRow(req.instance.id)) });
}));

app.post("/api/instances/:id/root-password", requireUser, loadInstance, h(async (req, res) => {
  res.json({ password: await inst.resetRootPassword(req.instance, req.user) });
}));

// The password generated at creation/reinstall is handed out exactly once.
app.post("/api/instances/:id/initial-password", requireUser, loadInstance, (req, res) => {
  if (req.instance.user_id !== req.user.id) throw new HttpError(403, "Only the owner can reveal this password.", "forbidden");
  const pw = req.instance.root_password_once;
  db.prepare("UPDATE instances SET root_password_once = NULL WHERE id = ?").run(req.instance.id);
  res.json({ password: pw || null });
});

app.delete("/api/instances/:id", requireUser, loadInstance, h(async (req, res) => {
  if (String(req.body?.confirm || "") !== req.instance.name)
    throw new HttpError(400, "Type the container name to confirm.", "confirm");
  if (["creating", "reinstalling"].includes(req.instance.status) && inst.busyOp(req.instance.id))
    throw new HttpError(409, "Wait for the current operation to finish.", "busy");
  await inst.deleteInstance(req.instance, req.user);
  res.json({ ok: true });
}));

const RANGES = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3 };
app.get("/api/instances/:id/metrics", requireUser, loadInstance, (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : "1h";
  res.json({ range, points: series(req.instance.id, RANGES[range]) });
});

app.get("/api/instances/:id/events", requireUser, loadInstance, (req, res) => {
  const events = db
    .prepare(
      `SELECT e.*, a.username AS actor FROM events e LEFT JOIN users a ON a.id = e.actor_id
       WHERE e.instance_id = ? ORDER BY e.at DESC LIMIT 100`,
    )
    .all(req.instance.id);
  res.json({ events: events.map(publicEvent) });
});

// snapshots
app.get("/api/instances/:id/snapshots", requireUser, loadInstance, h(async (req, res) => {
  res.json({ snapshots: await lxd.listSnapshots(req.instance.name).catch(() => []) });
}));
app.post("/api/instances/:id/snapshots", requireUser, loadInstance, h(async (req, res) => {
  await inst.createSnapshot(req.instance, req.owner, req.body?.name, req.user);
  res.status(201).json({ ok: true });
}));
app.post("/api/instances/:id/snapshots/:snap/restore", requireUser, loadInstance, h(async (req, res) => {
  await inst.restoreSnapshot(req.instance, req.params.snap, req.user);
  res.json({ ok: true });
}));
app.delete("/api/instances/:id/snapshots/:snap", requireUser, loadInstance, h(async (req, res) => {
  await inst.deleteSnapshot(req.instance, req.params.snap, req.user);
  res.json({ ok: true });
}));

// domains
app.get("/api/instances/:id/domains", requireUser, loadInstance, h(async (req, res) => {
  const avail = await domains.domainsAvailable();
  res.json({ ...avail, reason: translate(avail.reason, req.get("x-lang")), publicHost: allSettings().public_host || null, domains: domains.listDomains(req.instance.id) });
}));
app.post("/api/instances/:id/domains", requireUser, loadInstance, h(async (req, res) => {
  await domains.addDomain(req.instance, req.owner, req.body || {}, req.user);
  res.status(201).json({ domains: domains.listDomains(req.instance.id) });
}));
app.delete("/api/instances/:id/domains/:domainId", requireUser, loadInstance, h(async (req, res) => {
  const d = db.prepare("SELECT * FROM domains WHERE id = ? AND instance_id = ?").get(req.params.domainId, req.instance.id);
  if (!d) throw new HttpError(404, "Domain not found.", "not_found");
  await domains.removeDomain(d, req.user);
  res.json({ ok: true });
}));

function publicEvent(e) {
  return { id: e.id, at: e.at, level: e.level, action: e.action, message: e.message, actor: e.actor || null, instanceId: e.instance_id, user: e.username || null };
}

// ---- admin -----------------------------------------------------------------

const admin = express.Router();
admin.use(requireUser, requireAdmin);

function limitsFromBody(body, base = {}) {
  const out = { ...base };
  for (const k of auth.LIMIT_KEYS) {
    if (!(k in (body.limits || {}))) continue;
    const v = body.limits[k];
    if (v === null || v === "") out[k] = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `Invalid value for ${k}.`, "bad_limit");
      out[k] = n;
    }
  }
  return out;
}

function adminUser(u) {
  const usage = inst.usage(u.id);
  return {
    ...auth.publicUser(u),
    usage: {
      instances: usage.instances, cpu: usage.cpu, memoryMb: usage.memory_mb, diskGb: usage.disk_gb,
      domains: db.prepare("SELECT COUNT(*) AS n FROM domains WHERE user_id = ?").get(u.id).n,
    },
  };
}

admin.get("/overview", h(async (req, res) => {
  const runtime = await lxd.runtimeInfo();
  let pool = null;
  try {
    const r = JSON.parse((await lxd.run(["query", `/1.0/storage-pools/${config.pool}/resources`], { timeout: 15_000 })).stdout);
    pool = { used: r.space?.used || 0, total: r.space?.total || 0 };
  } catch {}
  const counts = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status='running') AS running, SUM(status='stopped') AS stopped, SUM(status='failed') AS failed,
            COALESCE(SUM(cpu),0) AS cpu, COALESCE(SUM(memory_mb),0) AS memory_mb, COALESCE(SUM(disk_gb),0) AS disk_gb
     FROM instances`,
  ).get();
  const events = db
    .prepare(
      `SELECT e.*, a.username AS actor, u.username AS username FROM events e
       LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.at DESC LIMIT 15`,
    )
    .all();
  const traffic = db.prepare("SELECT COALESCE(SUM(rx),0) AS rx, COALESCE(SUM(tx),0) AS tx FROM traffic WHERE period = ?").get(period());
  res.json({
    host: {
      hostname: os.hostname(), cpus: os.cpus().length, load: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(),
      uptime: os.uptime(), platform: `${os.type()} ${os.release()}`,
    },
    runtime, pool, project: config.project, network: config.network,
    counts: { ...counts, users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n },
    traffic,
    settings: { publicHost: allSettings().public_host },
    events: events.map(publicEvent),
    version: pkg.version,
  });
}));

admin.get("/users", (req, res) => {
  res.json({ users: db.prepare("SELECT * FROM users ORDER BY role = 'admin' DESC, username").all().map(adminUser) });
});

admin.post("/users", h(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  if (!auth.USERNAME_RE.test(username))
    throw new HttpError(400, "Usernames are 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter.", "bad_username");
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "That username is taken.", "username_taken");
  let password = req.body?.password ? String(req.body.password) : "";
  const generated = !password;
  if (generated) password = auth.generatePassword(16);
  else if (!auth.validPassword(password)) throw new HttpError(400, "Use at least 10 characters.", "weak_password");
  const s = allSettings();
  const defaults = {};
  for (const k of auth.LIMIT_KEYS) defaults[k] = s[`default_${k}`] === "" ? null : Number(s[`default_${k}`]);
  const limits = limitsFromBody(req.body || {}, defaults);
  const r = db
    .prepare(
      `INSERT INTO users(username, password_hash, role, must_change_password, ${auth.LIMIT_KEYS.join(",")}, note, created_at)
       VALUES(?,?, 'user', ?, ${auth.LIMIT_KEYS.map(() => "?").join(",")}, ?, ?)`,
    )
    .run(username, await auth.hashPassword(password), req.body?.mustChange === false ? 0 : 1, ...auth.LIMIT_KEYS.map((k) => limits[k]), String(req.body?.note || "").slice(0, 300), now());
  logEvent({ userId: Number(r.lastInsertRowid), actorId: req.user.id, action: "user.create", message: username });
  res.status(201).json({ user: adminUser(db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid)), password });
}));

function targetUser(req) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.uid));
  if (!u) throw new HttpError(404, "User not found.", "not_found");
  return u;
}

admin.patch("/users/:uid", (req, res) => {
  const u = targetUser(req);
  const body = req.body || {};
  if (u.role === "admin" && (body.disabled || body.limits))
    throw new HttpError(400, "The administrator account is always enabled and unlimited.", "admin_fixed");
  const limits = limitsFromBody(body, Object.fromEntries(auth.LIMIT_KEYS.map((k) => [k, u[k]])));
  const disabled = body.disabled == null ? u.disabled : body.disabled ? 1 : 0;
  const note = body.note == null ? u.note : String(body.note).slice(0, 300);
  db.prepare(`UPDATE users SET ${auth.LIMIT_KEYS.map((k) => `${k} = ?`).join(", ")}, disabled = ?, note = ? WHERE id = ?`).run(
    ...auth.LIMIT_KEYS.map((k) => limits[k]), disabled, note, u.id,
  );
  if (disabled && !u.disabled) auth.destroyUserSessions(u.id);
  logEvent({ userId: u.id, actorId: req.user.id, action: "user.update", message: u.username });
  res.json({ user: adminUser(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)) });
});

admin.post("/users/:uid/reset-password", h(async (req, res) => {
  const u = targetUser(req);
  if (u.role === "admin") throw new HttpError(403, "Reset the administrator password on the server: sudo boukarou reset-admin-password", "admin_cli_only");
  const password = auth.generatePassword(16);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(await auth.hashPassword(password), u.id);
  auth.destroyUserSessions(u.id);
  logEvent({ userId: u.id, actorId: req.user.id, action: "user.reset_password", message: u.username });
  res.json({ password });
}));

admin.post("/users/:uid/reset-2fa", (req, res) => {
  const u = targetUser(req);
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(u.id);
  logEvent({ userId: u.id, actorId: req.user.id, action: "user.reset_2fa", message: u.username });
  res.json({ ok: true });
});

admin.delete("/users/:uid", h(async (req, res) => {
  const u = targetUser(req);
  if (u.role === "admin") throw new HttpError(400, "The administrator account cannot be deleted.", "admin_fixed");
  if (String(req.body?.confirm || "") !== u.username) throw new HttpError(400, "Type the username to confirm.", "confirm");
  const rows = db.prepare("SELECT * FROM instances WHERE user_id = ?").all(u.id);
  for (const row of rows) await inst.deleteInstance(row, req.user);
  db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  logEvent({ actorId: req.user.id, action: "user.delete", message: `${u.username} (${rows.length} container(s) removed)` });
  res.json({ ok: true });
}));

admin.get("/instances", (req, res) => {
  const rows = db.prepare("SELECT i.*, u.username FROM instances i JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC").all();
  res.json({ instances: rows.map((r) => inst.publicInstance(r, { owner: { id: r.user_id, username: r.username } })) });
});

admin.get("/events", (req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = db
    .prepare(
      `SELECT e.*, a.username AS actor, u.username AS username FROM events e
       LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id < ? ORDER BY e.id DESC LIMIT 100`,
    )
    .all(before);
  res.json({ events: rows.map(publicEvent) });
});

admin.get("/settings", (req, res) => {
  res.json({ settings: allSettings(), images: IMAGES });
});

admin.put("/settings", (req, res) => {
  const body = req.body || {};
  const next = { ...allSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) next[k] = body[k] == null ? "" : String(body[k]).trim();
  const start = Number(next.ssh_port_start);
  const end = Number(next.ssh_port_end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1024 || end > 65535 || end < start)
    throw new HttpError(400, "The SSH port range must be within 1024–65535.", "bad_ports");
  for (const k of auth.LIMIT_KEYS) {
    const v = next[`default_${k}`];
    if (v !== "" && (!Number.isInteger(Number(v)) || Number(v) < 0)) throw new HttpError(400, `Invalid default for ${k}.`, "bad_limit");
  }
  if (next.public_host && !/^[a-zA-Z0-9.:-]{2,253}$/.test(next.public_host)) throw new HttpError(400, "Enter an IP address or host name.", "bad_host");
  if (next.acme_email && !/^\S+@\S+\.\S+$/.test(next.acme_email)) throw new HttpError(400, "Enter a valid email or leave it empty.", "bad_email");
  try {
    const list = JSON.parse(next.disabled_images);
    if (!Array.isArray(list)) throw new Error();
    next.disabled_images = JSON.stringify(list.filter((id) => IMAGES.some((i) => i.id === id)));
  } catch {
    throw new HttpError(400, "Invalid image list.", "bad_images");
  }
  for (const [k, v] of Object.entries(next)) setSetting(k, v);
  logEvent({ actorId: req.user.id, action: "settings.update" });
  res.json({ settings: allSettings() });
});

app.use("/api/admin", admin);

app.get("/api/health", h(async (req, res) => {
  res.json({ ok: true, version: pkg.version });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found.", code: "not_found" }));

// ---- errors ----------------------------------------------------------------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof lxd.LxdError) return res.status(502).json({ error: err.message, code: "lxd" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON.", code: "bad_json" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server.", code: "server" });
});

// ---- static SPA ------------------------------------------------------------

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: "1y", immutable: true, setHeaders: noCacheHtml }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.webDist, "index.html"));
  });
}
function noCacheHtml(res, file) {
  if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
}
