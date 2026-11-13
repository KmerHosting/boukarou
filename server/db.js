import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  -- NULL means unlimited
  max_instances INTEGER,
  max_cpu INTEGER,
  max_memory_mb INTEGER,
  max_disk_gb INTEGER,
  max_snapshots INTEGER,
  traffic_gb INTEGER,
  max_domains INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL UNIQUE,     -- also the LXD instance name
  image TEXT NOT NULL,
  cpu INTEGER NOT NULL,
  memory_mb INTEGER NOT NULL,
  disk_gb INTEGER NOT NULL,
  status TEXT NOT NULL,          -- creating|running|stopped|frozen|failed|reinstalling|deleting|unknown
  progress TEXT,
  error TEXT,
  ssh_port INTEGER UNIQUE,
  ipv4 TEXT,
  ipv6 TEXT,
  ssh_public_key TEXT,
  root_password_once TEXT,       -- shown once to the owner, then cleared
  traffic_blocked INTEGER NOT NULL DEFAULT 0,
  last_cpu_ns INTEGER,
  last_rx INTEGER,
  last_tx INTEGER,
  last_sample_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  cpu_pct REAL NOT NULL,
  mem_used INTEGER NOT NULL,
  mem_total INTEGER NOT NULL,
  disk_used INTEGER NOT NULL,
  rx_bps INTEGER NOT NULL,
  tx_bps INTEGER NOT NULL,
  processes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS metrics_instance_at ON metrics(instance_id, at);

CREATE TABLE IF NOT EXISTS traffic (
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  period TEXT NOT NULL,          -- YYYY-MM (UTC)
  rx INTEGER NOT NULL DEFAULT 0,
  tx INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (instance_id, period)
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  domain TEXT NOT NULL UNIQUE,
  target_port INTEGER NOT NULL,
  status TEXT NOT NULL,          -- provisioning|active|failed|deleting
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id INTEGER,
  actor_id INTEGER,
  instance_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  action TEXT NOT NULL,
  message TEXT
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_instance ON events(instance_id, at);
`);

export const now = () => Date.now();

export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ---- settings --------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  public_host: "",
  ssh_port_start: "2200",
  ssh_port_end: "2999",
  acme_email: "",
  // limits applied when the admin creates a user (empty = unlimited)
  default_max_instances: "",
  default_max_cpu: "",
  default_max_memory_mb: "",
  default_max_disk_gb: "",
  default_max_snapshots: "",
  default_traffic_gb: "",
  default_max_domains: "",
  disabled_images: "[]",
};

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : DEFAULT_SETTINGS[key] ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) out[row.key] = row.value;
  return out;
}

// ---- events ----------------------------------------------------------------

export function logEvent({ userId = null, actorId = null, instanceId = null, level = "info", action, message = null }) {
  db.prepare(
    "INSERT INTO events(at, user_id, actor_id, instance_id, level, action, message) VALUES(?,?,?,?,?,?,?)",
  ).run(now(), userId, actorId, instanceId, level, action, message);
}
