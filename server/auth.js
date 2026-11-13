import crypto from "node:crypto";
import { promisify } from "node:util";
import { db, now } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "boukarou_session";
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const SESSION_IDLE = 24 * 3600 * 1000;

// ---- passwords -------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(String(password), Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Easy to read aloud and type: no 0/O, 1/l/I.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generatePassword(length = 20) {
  const bytes = crypto.randomBytes(length * 2);
  let out = "";
  for (const b of bytes) {
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
    if (out.length === length) break;
  }
  return out;
}

export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
export const validPassword = (p) => typeof p === "string" && p.length >= 10 && p.length <= 200;

// ---- sessions --------------------------------------------------------------

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const t = now();
  db.prepare(
    "INSERT INTO sessions(id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES(?,?,?,?,?,?,?)",
  ).run(sha(token), userId, t, t + SESSION_TTL, t, clientIp(req), String(req.headers["user-agent"] || "").slice(0, 300));
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(t, userId);
  return token;
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha(token));
}

export function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(userId, sha(exceptToken));
  else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function sessionUser(token) {
  if (!token) return null;
  const id = sha(token);
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id);
  if (!row) return null;
  const t = now();
  if (row.expires_at < t || row.last_seen_at + SESSION_IDLE < t || row.disabled) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  if (t - row.last_seen_at > 60_000) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(t, id);
  return row;
}

export function cookieToken(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?").run(now(), now() - SESSION_IDLE);
}, 3600_000).unref();

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "";
}

// ---- brute-force protection ------------------------------------------------

const attempts = new Map();
const WINDOW = 15 * 60_000;
const LIMIT = 10;

export function isThrottled(...keys) {
  const t = now();
  return keys.some((k) => {
    const a = attempts.get(k);
    if (!a) return false;
    if (t - a.start > WINDOW) {
      attempts.delete(k);
      return false;
    }
    return a.count >= LIMIT;
  });
}
export function recordFailure(...keys) {
  const t = now();
  for (const k of keys) {
    const a = attempts.get(k);
    if (!a || t - a.start > WINDOW) attempts.set(k, { start: t, count: 1 });
    else a.count++;
  }
}
export function clearFailures(...keys) {
  for (const k of keys) attempts.delete(k);
}
setInterval(() => {
  const t = now();
  for (const [k, a] of attempts) if (t - a.start > WINDOW) attempts.delete(k);
}, 60_000).unref();

// ---- TOTP (RFC 6238) -------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}
export function verifyTotp(secret, code) {
  const clean = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  const key = b32decode(secret);
  const step = Math.floor(Date.now() / 30_000);
  for (const d of [-1, 0, 1]) {
    const expected = hotp(key, step + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}
export function totpUri(secret, username, issuer) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// Short-lived ticket between "password OK" and "TOTP OK".
const tickets = new Map();
export function issueTwoFactorTicket(userId) {
  const t = crypto.randomBytes(24).toString("base64url");
  tickets.set(t, { userId, exp: now() + 5 * 60_000 });
  return t;
}
export function consumeTwoFactorTicket(t, { keep = false } = {}) {
  const v = tickets.get(t);
  if (!v || v.exp < now()) {
    tickets.delete(t);
    return null;
  }
  if (!keep) tickets.delete(t);
  return v.userId;
}

// ---- public user shape -----------------------------------------------------

export const LIMIT_KEYS = [
  "max_instances",
  "max_cpu",
  "max_memory_mb",
  "max_disk_gb",
  "max_snapshots",
  "traffic_gb",
  "max_domains",
];

export function publicUser(u) {
  if (!u) return null;
  const limits = {};
  for (const k of LIMIT_KEYS) limits[k] = u.role === "admin" ? null : u[k];
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: !!u.disabled,
    mustChangePassword: !!u.must_change_password,
    totpEnabled: !!u.totp_enabled,
    limits,
    note: u.note || "",
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}
