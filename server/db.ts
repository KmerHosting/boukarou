import { Database } from 'bun:sqlite'
import { config } from './config.ts'

export const db = new Database(config.dbFile, { create: true, strict: true })
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

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
  id TEXT PRIMARY KEY,
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
  name TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL,
  cpu INTEGER NOT NULL,
  memory_mb INTEGER NOT NULL,
  disk_gb INTEGER NOT NULL,
  status TEXT NOT NULL,
  progress TEXT,
  error TEXT,
  ssh_port INTEGER UNIQUE,
  ipv4 TEXT,
  ipv6 TEXT,
  ssh_public_key TEXT,
  root_password_once TEXT,
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
  period TEXT NOT NULL,
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
  status TEXT NOT NULL,
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
`)

export const now = () => Date.now()

export interface UserRow {
  id: number
  username: string
  password_hash: string
  role: 'admin' | 'user'
  disabled: number
  must_change_password: number
  totp_secret: string | null
  totp_enabled: number
  max_instances: number | null
  max_cpu: number | null
  max_memory_mb: number | null
  max_disk_gb: number | null
  max_snapshots: number | null
  traffic_gb: number | null
  max_domains: number | null
  note: string | null
  created_at: number
  last_login_at: number | null
}

export interface InstanceRow {
  id: string
  user_id: number
  name: string
  image: string
  cpu: number
  memory_mb: number
  disk_gb: number
  status: string
  progress: string | null
  error: string | null
  ssh_port: number | null
  ipv4: string | null
  ipv6: string | null
  ssh_public_key: string | null
  root_password_once: string | null
  traffic_blocked: number
  last_cpu_ns: number | null
  last_rx: number | null
  last_tx: number | null
  last_sample_at: number | null
  created_at: number
  updated_at: number
}

export interface DomainRow {
  id: string
  instance_id: string
  user_id: number
  domain: string
  target_port: number
  status: string
  error: string | null
  created_at: number
}

/** Runs the function in one immediate transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ---- settings --------------------------------------------------------------

export const DEFAULT_SETTINGS: Record<string, string> = {
  public_host: '',
  ssh_port_start: '2200',
  ssh_port_end: '2999',
  acme_email: '',
  // Limits given to a new user; empty means unlimited.
  default_max_instances: '',
  default_max_cpu: '',
  default_max_memory_mb: '',
  default_max_disk_gb: '',
  default_max_snapshots: '',
  default_traffic_gb: '',
  default_max_domains: '',
  disabled_images: '[]',
}

export function getSetting(key: string): string {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '')
}

export function setSetting(key: string, value: string) {
  db.query('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value),
  )
}

export function allSettings(): Record<string, string> {
  const out = { ...DEFAULT_SETTINGS }
  for (const row of db.query<{ key: string; value: string }, []>('SELECT key, value FROM settings').all()) out[row.key] = row.value
  return out
}

// ---- events ----------------------------------------------------------------

export function logEvent(event: {
  userId?: number | null
  actorId?: number | null
  instanceId?: string | null
  level?: 'info' | 'warning' | 'error'
  action: string
  message?: string | null
}) {
  db.query('INSERT INTO events(at, user_id, actor_id, instance_id, level, action, message) VALUES(?,?,?,?,?,?,?)').run(
    now(),
    event.userId ?? null,
    event.actorId ?? null,
    event.instanceId ?? null,
    event.level ?? 'info',
    event.action,
    event.message ?? null,
  )
}

export const userById = (id: number) => db.query<UserRow, [number]>('SELECT * FROM users WHERE id = ?').get(id)
