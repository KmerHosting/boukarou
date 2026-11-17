import os from 'node:os'
import { join, normalize } from 'node:path'
import type { Server, ServerWebSocket, Subprocess } from 'bun'
import * as auth from './auth.ts'
import { ensureAdmin } from './bootstrap.ts'
import { config, version } from './config.ts'
import { allSettings, db, DEFAULT_SETTINGS, logEvent, now, setSetting, userById, type DomainRow, type InstanceRow, type UserRow } from './db.ts'
import * as domains from './domains.ts'
import { HttpError } from './errors.ts'
import { translate } from './i18n.ts'
import { availableImages, IMAGES } from './images.ts'
import * as inst from './instances.ts'
import * as lxd from './lxd.ts'
import { period, series, startCollector, trafficFor } from './metrics.ts'

// ---- request plumbing ------------------------------------------------------

interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  body: Record<string, unknown>
  ip: string
  token: string | null
  user: UserRow | null
  secure: boolean
  lang: string | null
  headers: Headers
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

interface Route {
  method: string
  parts: string[]
  handler: Handler
  guard: 'open' | 'user' | 'admin'
}
const routes: Route[] = []
const route = (guard: Route['guard']) => (method: string, path: string, handler: Handler) =>
  routes.push({ method, parts: path.split('/').filter(Boolean), handler, guard })
const open = route('open')
const user = route('user')
const admin = route('admin')

function matchRoute(method: string, path: string) {
  const parts = path.split('/').filter(Boolean)
  let methodMismatch = false
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      const p = r.parts[i]!
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]!)
      else if (p !== parts[i]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (r.method !== method) {
      methodMismatch = true
      continue
    }
    return { route: r, params }
  }
  return methodMismatch ? 'method' : null
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...extra } })
}

function clientIp(req: Request, server: Server<TerminalData>) {
  const remote = server.requestIP(req)?.address ?? ''
  // Behind the panel's own nginx (a domain), the real address comes in X-Forwarded-For.
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return remote
}

const LIMIT_SET = new Set<string>(auth.LIMIT_KEYS)

function loadInstance(ctx: Ctx) {
  const row = inst.getRow(ctx.params.id ?? '')
  if (!row || (row.user_id !== ctx.user!.id && ctx.user!.role !== 'admin')) throw new HttpError(404, 'Container not found.', 'not_found')
  return { row, owner: userById(row.user_id)! }
}

// ---- auth ------------------------------------------------------------------

const me = (u: UserRow | null) => ({ user: auth.publicUser(u), version })

open('GET', '/api/auth/me', (ctx) => me(ctx.user))

open('POST', '/api/auth/login', async (ctx) => {
  const username = String(ctx.body.username ?? '').trim().toLowerCase()
  const password = String(ctx.body.password ?? '')
  if (auth.isThrottled(`ip:${ctx.ip}`, `u:${username}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.', 'throttled')
  const u = db.query<UserRow, [string]>('SELECT * FROM users WHERE username = ?').get(username)
  const ok = await auth.verifyPassword(password, u?.password_hash ?? '$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  if (!u || !ok || u.disabled) {
    auth.recordFailure(`ip:${ctx.ip}`, `u:${username}`)
    if (u && ok && u.disabled) throw new HttpError(403, 'This account is disabled. Contact the administrator.', 'disabled')
    throw new HttpError(401, 'Wrong username or password.', 'bad_credentials')
  }
  if (u.totp_enabled) return { twoFactor: true, ticket: auth.issueTwoFactorTicket(u.id) }
  auth.clearFailures(`u:${username}`)
  const token = auth.createSession(u.id, ctx.ip, ctx.req.headers.get('user-agent') ?? '')
  ctx.headers.append('Set-Cookie', auth.sessionCookie(token, ctx.secure))
  logEvent({ userId: u.id, actorId: u.id, action: 'auth.login', message: ctx.ip })
  return me(u)
})

open('POST', '/api/auth/2fa', (ctx) => {
  if (auth.isThrottled(`ip:${ctx.ip}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.', 'throttled')
  const ticket = String(ctx.body.ticket ?? '')
  const userId = auth.consumeTwoFactorTicket(ticket, true)
  if (!userId) throw new HttpError(401, 'Your sign-in expired. Start again.', 'ticket_expired')
  const u = userById(userId)!
  if (!auth.verifyTotp(u.totp_secret, ctx.body.code)) {
    auth.recordFailure(`ip:${ctx.ip}`, `u:${u.username}`)
    throw new HttpError(401, 'That code is not valid.', 'bad_code')
  }
  auth.consumeTwoFactorTicket(ticket)
  const token = auth.createSession(u.id, ctx.ip, ctx.req.headers.get('user-agent') ?? '')
  ctx.headers.append('Set-Cookie', auth.sessionCookie(token, ctx.secure))
  logEvent({ userId: u.id, actorId: u.id, action: 'auth.login', message: `${ctx.ip} (2FA)` })
  return me(u)
})

open('POST', '/api/auth/logout', (ctx) => {
  auth.destroySession(ctx.token)
  ctx.headers.append('Set-Cookie', auth.sessionCookie(null, ctx.secure))
  return { ok: true }
})

// ---- account ---------------------------------------------------------------

user('POST', '/api/account/password', async (ctx) => {
  const u = ctx.user!
  if (u.role === 'admin') {
    throw new HttpError(403, 'The administrator password can only be changed on the server: sudo boukarou reset-admin-password', 'admin_cli_only')
  }
  if (!(await auth.verifyPassword(String(ctx.body.current ?? ''), u.password_hash))) throw new HttpError(401, 'Your current password is not correct.', 'bad_current')
  if (!auth.validPassword(ctx.body.password)) throw new HttpError(400, 'Use at least 10 characters.', 'weak_password')
  db.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(await auth.hashPassword(ctx.body.password), u.id)
  auth.destroyUserSessions(u.id, ctx.token)
  logEvent({ userId: u.id, actorId: u.id, action: 'account.password' })
  return { ok: true }
})

user('POST', '/api/account/2fa/setup', (ctx) => {
  const u = ctx.user!
  if (u.totp_enabled) throw new HttpError(409, 'Two-factor sign-in is already on.', 'already')
  const secret = auth.newTotpSecret()
  db.query('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, u.id)
  return { secret, uri: auth.totpUri(secret, u.username, `Boukarou (${os.hostname()})`) }
})

user('POST', '/api/account/2fa/enable', (ctx) => {
  const u = ctx.user!
  if (!u.totp_secret || !auth.verifyTotp(u.totp_secret, ctx.body.code)) {
    throw new HttpError(400, 'That code is not valid. Check the time on your phone.', 'bad_code')
  }
  db.query('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(u.id)
  logEvent({ userId: u.id, actorId: u.id, action: 'account.2fa_on' })
  return { ok: true }
})

user('POST', '/api/account/2fa/disable', async (ctx) => {
  const u = ctx.user!
  if (!(await auth.verifyPassword(String(ctx.body.password ?? ''), u.password_hash))) throw new HttpError(401, 'Your password is not correct.', 'bad_current')
  if (!auth.verifyTotp(u.totp_secret, ctx.body.code)) throw new HttpError(400, 'That code is not valid.', 'bad_code')
  db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(u.id)
  logEvent({ userId: u.id, actorId: u.id, action: 'account.2fa_off' })
  return { ok: true }
})

user('POST', '/api/account/sessions/revoke', (ctx) => {
  auth.destroyUserSessions(ctx.user!.id, ctx.token)
  return { ok: true }
})

// ---- containers ------------------------------------------------------------

user('GET', '/api/images', () => ({ images: availableImages() }))

const usageOf = (u: UserRow) => {
  const x = inst.usage(u.id)
  return { instances: x.instances, cpu: x.cpu, memoryMb: x.memory_mb, diskGb: x.disk_gb }
}

user('GET', '/api/overview', async (ctx) => {
  const rows = db.query<InstanceRow, [number]>('SELECT * FROM instances WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user!.id)
  return {
    instances: rows.map((r) => inst.publicInstance(r)),
    usage: usageOf(ctx.user!),
    limits: auth.publicUser(ctx.user)!.limits,
    diskQuotaEnforced: await lxd.supportsDiskQuota(),
    host: { cpus: os.cpus().length, memoryMb: Math.round(os.totalmem() / 1048576) },
  }
})

user('POST', '/api/instances', async (ctx) => {
  const row = await inst.createInstance(ctx.user!, ctx.body)
  return { instance: inst.publicInstance(row) }
})

user('GET', '/api/instances/:id', async (ctx) => {
  const { row, owner } = loadInstance(ctx)
  let live = null
  if (!['creating', 'deleting'].includes(row.status)) {
    const state = await lxd.getState(row.name).catch(() => null)
    if (state) {
      live = {
        status: lxd.mapStatus(state.status),
        memUsed: state.memory?.usage ?? 0,
        processes: state.processes ?? 0,
        pid: state.pid ?? 0,
        ...lxd.addressesOf(state),
      }
    }
  }
  return {
    instance: inst.publicInstance(row, { owner: { id: owner.id, username: owner.username } }),
    live,
    traffic: { ...trafficFor(row.id), quotaGb: owner.role === 'admin' ? null : owner.traffic_gb },
    limits: { maxSnapshots: owner.role === 'admin' ? null : owner.max_snapshots },
    diskQuotaEnforced: await lxd.supportsDiskQuota(),
  }
})

user('POST', '/api/instances/:id/actions', async (ctx) => {
  const { row } = loadInstance(ctx)
  await inst.powerAction(row, String(ctx.body.action ?? ''), ctx.user!)
  return { instance: inst.publicInstance(inst.getRow(row.id)!) }
})

user('POST', '/api/instances/:id/retry', (ctx) => {
  inst.retryProvisioning(loadInstance(ctx).row)
  return { ok: true }
})

user('POST', '/api/instances/:id/reinstall', (ctx) => {
  const { row } = loadInstance(ctx)
  if (String(ctx.body.confirm ?? '') !== row.name) throw new HttpError(400, 'Type the container name to confirm.', 'confirm')
  inst.reinstall(row, ctx.body, ctx.user!)
  return { ok: true }
})

user('POST', '/api/instances/:id/resize', async (ctx) => {
  const { row, owner } = loadInstance(ctx)
  await inst.resize(row, owner, ctx.body, ctx.user!)
  return { instance: inst.publicInstance(inst.getRow(row.id)!) }
})

user('POST', '/api/instances/:id/root-password', async (ctx) => ({ password: await inst.resetRootPassword(loadInstance(ctx).row, ctx.user!) }))

// The password generated when a container is built is handed out exactly once.
user('POST', '/api/instances/:id/initial-password', (ctx) => {
  const { row } = loadInstance(ctx)
  if (row.user_id !== ctx.user!.id) throw new HttpError(403, 'Only the owner can reveal this password.', 'forbidden')
  db.query('UPDATE instances SET root_password_once = NULL WHERE id = ?').run(row.id)
  return { password: row.root_password_once || null }
})

user('DELETE', '/api/instances/:id', async (ctx) => {
  const { row } = loadInstance(ctx)
  if (String(ctx.body.confirm ?? '') !== row.name) throw new HttpError(400, 'Type the container name to confirm.', 'confirm')
  if (['creating', 'reinstalling'].includes(row.status) && inst.busyOp(row.id)) throw new HttpError(409, 'Wait for the current operation to finish.', 'busy')
  await inst.deleteInstance(row, ctx.user!)
  return { ok: true }
})

const RANGES: Record<string, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 }
user('GET', '/api/instances/:id/metrics', (ctx) => {
  const { row } = loadInstance(ctx)
  const range = RANGES[ctx.url.searchParams.get('range') ?? ''] ? ctx.url.searchParams.get('range')! : '1h'
  return { range, points: series(row.id, RANGES[range]!) }
})

interface EventRow {
  id: number
  at: number
  level: string
  action: string
  message: string | null
  actor: string | null
  instance_id: string | null
  username?: string | null
}
const publicEvent = (e: EventRow) => ({
  id: e.id,
  at: e.at,
  level: e.level,
  action: e.action,
  message: e.message,
  actor: e.actor ?? null,
  instanceId: e.instance_id,
  user: e.username ?? null,
})

user('GET', '/api/instances/:id/events', (ctx) => {
  const { row } = loadInstance(ctx)
  const events = db
    .query<EventRow, [string]>(
      'SELECT e.*, a.username AS actor FROM events e LEFT JOIN users a ON a.id = e.actor_id WHERE e.instance_id = ? ORDER BY e.at DESC LIMIT 100',
    )
    .all(row.id)
  return { events: events.map(publicEvent) }
})

// snapshots
user('GET', '/api/instances/:id/snapshots', async (ctx) => ({ snapshots: await lxd.listSnapshots(loadInstance(ctx).row.name).catch(() => []) }))
user('POST', '/api/instances/:id/snapshots', async (ctx) => {
  const { row, owner } = loadInstance(ctx)
  await inst.createSnapshot(row, owner, ctx.body.name, ctx.user!)
  return { ok: true }
})
user('POST', '/api/instances/:id/snapshots/:snap/restore', async (ctx) => {
  await inst.restoreSnapshot(loadInstance(ctx).row, ctx.params.snap!, ctx.user!)
  return { ok: true }
})
user('DELETE', '/api/instances/:id/snapshots/:snap', async (ctx) => {
  await inst.deleteSnapshot(loadInstance(ctx).row, ctx.params.snap!, ctx.user!)
  return { ok: true }
})

// domains
user('GET', '/api/instances/:id/domains', async (ctx) => {
  const { row } = loadInstance(ctx)
  const avail = await domains.domainsAvailable()
  return { ...avail, reason: translate(avail.reason, ctx.lang), publicHost: allSettings().public_host || null, domains: domains.listDomains(row.id) }
})
user('POST', '/api/instances/:id/domains', async (ctx) => {
  const { row, owner } = loadInstance(ctx)
  await domains.addDomain(row, owner, ctx.body, ctx.user!)
  return { domains: domains.listDomains(row.id) }
})
user('DELETE', '/api/instances/:id/domains/:domainId', async (ctx) => {
  const { row } = loadInstance(ctx)
  const d = db.query<DomainRow, [string, string]>('SELECT * FROM domains WHERE id = ? AND instance_id = ?').get(ctx.params.domainId!, row.id)
  if (!d) throw new HttpError(404, 'Domain not found.', 'not_found')
  await domains.removeDomain(d, ctx.user!)
  return { ok: true }
})

// ---- admin -----------------------------------------------------------------

function limitsFromBody(body: Record<string, unknown>, base: Record<string, number | null>) {
  const out = { ...base }
  const limits = (body.limits ?? {}) as Record<string, unknown>
  for (const k of auth.LIMIT_KEYS) {
    if (!(k in limits)) continue
    const v = limits[k]
    if (v === null || v === '') out[k] = null
    else {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `Invalid value for ${k}.`, 'bad_limit')
      out[k] = n
    }
  }
  return out
}

function adminUser(u: UserRow) {
  const x = inst.usage(u.id)
  return {
    ...auth.publicUser(u)!,
    usage: {
      instances: x.instances,
      cpu: x.cpu,
      memoryMb: x.memory_mb,
      diskGb: x.disk_gb,
      domains: db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM domains WHERE user_id = ?').get(u.id)!.n,
    },
  }
}

admin('GET', '/api/admin/overview', async () => {
  const runtime = await lxd.runtimeInfo()
  let pool = null
  try {
    const r = await lxd.query<{ space?: { used?: number; total?: number } }>(`/1.0/storage-pools/${config.pool}/resources`, 15_000)
    pool = { used: r.space?.used ?? 0, total: r.space?.total ?? 0 }
  } catch {
    // No pool information: shown as unknown.
  }
  const counts = db
    .query<Record<string, number>, []>(
      `SELECT COUNT(*) AS total, SUM(status='running') AS running, SUM(status='stopped') AS stopped, SUM(status='failed') AS failed,
              COALESCE(SUM(cpu),0) AS cpu, COALESCE(SUM(memory_mb),0) AS memory_mb, COALESCE(SUM(disk_gb),0) AS disk_gb FROM instances`,
    )
    .get()!
  const events = db
    .query<EventRow, []>(
      `SELECT e.*, a.username AS actor, u.username AS username FROM events e
       LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users u ON u.id = e.user_id ORDER BY e.at DESC LIMIT 15`,
    )
    .all()
  const traffic = db.query<{ rx: number; tx: number }, [string]>('SELECT COALESCE(SUM(rx),0) AS rx, COALESCE(SUM(tx),0) AS tx FROM traffic WHERE period = ?').get(period())
  return {
    host: {
      hostname: os.hostname(),
      cpus: os.cpus().length,
      load: os.loadavg(),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      uptime: os.uptime(),
      platform: `${os.type()} ${os.release()}`,
    },
    runtime,
    pool,
    project: config.project,
    network: config.network,
    counts: { ...counts, users: db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM users').get()!.n },
    traffic,
    settings: { publicHost: allSettings().public_host },
    events: events.map(publicEvent),
    version,
  }
})

admin('GET', '/api/admin/users', () => ({
  users: db.query<UserRow, []>("SELECT * FROM users ORDER BY role = 'admin' DESC, username").all().map(adminUser),
}))

admin('POST', '/api/admin/users', async (ctx) => {
  const username = String(ctx.body.username ?? '').trim().toLowerCase()
  if (!auth.USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Usernames are 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter.', 'bad_username')
  }
  if (db.query('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken.', 'username_taken')
  let password = ctx.body.password ? String(ctx.body.password) : ''
  if (!password) password = auth.generatePassword(16)
  else if (!auth.validPassword(password)) throw new HttpError(400, 'Use at least 10 characters.', 'weak_password')
  const s = allSettings()
  const defaults = Object.fromEntries(auth.LIMIT_KEYS.map((k) => [k, s[`default_${k}`] === '' ? null : Number(s[`default_${k}`])]))
  const limits = limitsFromBody(ctx.body, defaults)
  const r = db
    .query(
      `INSERT INTO users(username, password_hash, role, must_change_password, ${auth.LIMIT_KEYS.join(',')}, note, created_at)
       VALUES(?,?, 'user', ?, ${auth.LIMIT_KEYS.map(() => '?').join(',')}, ?, ?)`,
    )
    .run(
      username,
      await auth.hashPassword(password),
      ctx.body.mustChange === false ? 0 : 1,
      ...auth.LIMIT_KEYS.map((k) => limits[k] ?? null),
      String(ctx.body.note ?? '').slice(0, 300),
      now(),
    )
  const id = Number(r.lastInsertRowid)
  logEvent({ userId: id, actorId: ctx.user!.id, action: 'user.create', message: username })
  return { user: adminUser(userById(id)!), password }
})

function targetUser(ctx: Ctx) {
  const u = userById(Number(ctx.params.uid))
  if (!u) throw new HttpError(404, 'User not found.', 'not_found')
  return u
}

admin('GET', '/api/admin/users/:uid', (ctx) => {
  const u = targetUser(ctx)
  const rows = db.query<InstanceRow, [number]>('SELECT * FROM instances WHERE user_id = ? ORDER BY created_at DESC').all(u.id)
  return { user: adminUser(u), instances: rows.map((r) => inst.publicInstance(r, { owner: { id: u.id, username: u.username } })) }
})

admin('PATCH', '/api/admin/users/:uid', (ctx) => {
  const u = targetUser(ctx)
  if (u.role === 'admin' && (ctx.body.disabled || ctx.body.limits)) {
    throw new HttpError(400, 'The administrator account is always enabled and unlimited.', 'admin_fixed')
  }
  const limits = limitsFromBody(ctx.body, Object.fromEntries(auth.LIMIT_KEYS.map((k) => [k, u[k]])))
  const disabled = ctx.body.disabled == null ? u.disabled : ctx.body.disabled ? 1 : 0
  const note = ctx.body.note == null ? u.note : String(ctx.body.note).slice(0, 300)
  db.query(`UPDATE users SET ${auth.LIMIT_KEYS.map((k) => `${k} = ?`).join(', ')}, disabled = ?, note = ? WHERE id = ?`).run(
    ...auth.LIMIT_KEYS.map((k) => limits[k] ?? null),
    disabled,
    note,
    u.id,
  )
  if (disabled && !u.disabled) auth.destroyUserSessions(u.id)
  logEvent({ userId: u.id, actorId: ctx.user!.id, action: 'user.update', message: u.username })
  return { user: adminUser(userById(u.id)!) }
})

admin('POST', '/api/admin/users/:uid/reset-password', async (ctx) => {
  const u = targetUser(ctx)
  if (u.role === 'admin') throw new HttpError(403, 'Reset the administrator password on the server: sudo boukarou reset-admin-password', 'admin_cli_only')
  const password = auth.generatePassword(16)
  db.query('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(await auth.hashPassword(password), u.id)
  auth.destroyUserSessions(u.id)
  logEvent({ userId: u.id, actorId: ctx.user!.id, action: 'user.reset_password', message: u.username })
  return { password }
})

admin('POST', '/api/admin/users/:uid/reset-2fa', (ctx) => {
  const u = targetUser(ctx)
  db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(u.id)
  logEvent({ userId: u.id, actorId: ctx.user!.id, action: 'user.reset_2fa', message: u.username })
  return { ok: true }
})

admin('DELETE', '/api/admin/users/:uid', async (ctx) => {
  const u = targetUser(ctx)
  if (u.role === 'admin') throw new HttpError(400, 'The administrator account cannot be deleted.', 'admin_fixed')
  if (String(ctx.body.confirm ?? '') !== u.username) throw new HttpError(400, 'Type the username to confirm.', 'confirm')
  const rows = db.query<InstanceRow, [number]>('SELECT * FROM instances WHERE user_id = ?').all(u.id)
  for (const row of rows) await inst.deleteInstance(row, ctx.user!)
  db.query('DELETE FROM users WHERE id = ?').run(u.id)
  logEvent({ actorId: ctx.user!.id, action: 'user.delete', message: `${u.username} (${rows.length} container(s) removed)` })
  return { ok: true }
})

admin('GET', '/api/admin/instances', () => {
  const rows = db
    .query<InstanceRow & { username: string }, []>('SELECT i.*, u.username FROM instances i JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC')
    .all()
  return { instances: rows.map((r) => inst.publicInstance(r, { owner: { id: r.user_id, username: r.username } })) }
})

admin('GET', '/api/admin/events', (ctx) => {
  const before = Number(ctx.url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER
  const rows = db
    .query<EventRow, [number]>(
      `SELECT e.*, a.username AS actor, u.username AS username FROM events e
       LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id < ? ORDER BY e.id DESC LIMIT 100`,
    )
    .all(before)
  return { events: rows.map(publicEvent) }
})

admin('GET', '/api/admin/settings', () => ({ settings: allSettings(), images: IMAGES }))

admin('PUT', '/api/admin/settings', (ctx) => {
  const next = { ...allSettings() }
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in ctx.body) next[k] = ctx.body[k] == null ? '' : String(ctx.body[k]).trim()
  const start = Number(next.ssh_port_start)
  const end = Number(next.ssh_port_end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1024 || end > 65535 || end < start) {
    throw new HttpError(400, 'The SSH port range must be within 1024–65535.', 'bad_ports')
  }
  for (const k of auth.LIMIT_KEYS) {
    const v = next[`default_${k}`]!
    if (v !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0)) throw new HttpError(400, `Invalid default for ${k}.`, 'bad_limit')
  }
  if (next.public_host && !/^[a-zA-Z0-9.:-]{2,253}$/.test(next.public_host)) throw new HttpError(400, 'Enter an IP address or host name.', 'bad_host')
  if (next.acme_email && !/^\S+@\S+\.\S+$/.test(next.acme_email)) throw new HttpError(400, 'Enter a valid email or leave it empty.', 'bad_email')
  try {
    const list = JSON.parse(next.disabled_images!)
    if (!Array.isArray(list)) throw new Error('not a list')
    next.disabled_images = JSON.stringify(list.filter((id) => IMAGES.some((i) => i.id === id)))
  } catch {
    throw new HttpError(400, 'Invalid image list.', 'bad_images')
  }
  for (const [k, v] of Object.entries(next)) setSetting(k, v)
  logEvent({ actorId: ctx.user!.id, action: 'settings.update' })
  return { settings: allSettings() }
})

open('GET', '/api/health', () => ({ ok: true, version }))

// ---- dispatch --------------------------------------------------------------

async function handleApi(req: Request, url: URL, server: Server<TerminalData>) {
  const ctx: Ctx = {
    req,
    url,
    params: {},
    body: {},
    ip: clientIp(req, server),
    token: auth.cookieToken(req.headers.get('cookie')),
    user: null,
    secure: url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https',
    lang: req.headers.get('x-lang'),
    headers: new Headers(),
  }
  const fail = (status: number, error: string, code: string) =>
    json({ error: translate(error, ctx.lang), code }, status, Object.fromEntries(ctx.headers))

  try {
    // Changes must come from the panel's own scripts: this blocks cross-site form posts.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('x-boukarou') !== '1') return fail(403, 'Missing request header.', 'csrf')
    ctx.user = auth.sessionUser(ctx.token)

    const found = matchRoute(req.method, url.pathname)
    if (found === 'method' || !found) return fail(404, 'Not found.', 'not_found')
    ctx.params = found.params

    const { guard } = found.route
    if (guard !== 'open') {
      if (!ctx.user) return fail(401, 'Please sign in.', 'auth')
      if (ctx.user.must_change_password && url.pathname !== '/api/account/password') {
        return fail(403, 'Choose a new password first.', 'must_change_password')
      }
      if (guard === 'admin' && ctx.user.role !== 'admin') return fail(404, 'Not found.', 'not_found')
    }

    if (!['GET', 'HEAD'].includes(req.method)) {
      const text = await req.text()
      if (text.length > 64 * 1024) return fail(413, 'Request too large.', 'too_large')
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text)
          ctx.body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        } catch {
          return fail(400, 'Invalid JSON.', 'bad_json')
        }
      }
    }

    const result = await found.route.handler(ctx)
    const status = req.method === 'POST' && /^\/api\/(instances|admin\/users)$|\/(snapshots|domains)$/.test(url.pathname) ? 201 : 200
    return json(result, status, Object.fromEntries(ctx.headers))
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, error.code)
    if (error instanceof lxd.LxdError) return fail(502, error.message, 'lxd')
    console.error(error)
    return fail(500, 'Something went wrong on the server.', 'server')
  }
}

// ---- browser console -------------------------------------------------------

interface TerminalData {
  userId: number
  instance: InstanceRow
  cols: number
  rows: number
  proc?: Subprocess
}
const openTerminals = new Map<number, number>()
const MAX_TERMINALS = 6

function upgradeTerminal(req: Request, url: URL, server: Server<TerminalData>, id: string): Response | undefined {
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host')) return new Response('Forbidden', { status: 403 })
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  }
  const u = auth.sessionUser(auth.cookieToken(req.headers.get('cookie')))
  if (!u || u.must_change_password) return new Response('Unauthorized', { status: 401 })
  const row = inst.getRow(id)
  if (!row || (row.user_id !== u.id && u.role !== 'admin')) return new Response('Not Found', { status: 404 })
  if ((openTerminals.get(u.id) ?? 0) >= MAX_TERMINALS) return new Response('Too Many Requests', { status: 429 })
  const cols = Math.min(500, Math.max(20, Number(url.searchParams.get('cols')) || 100))
  const rows = Math.min(300, Math.max(5, Number(url.searchParams.get('rows')) || 30))
  if (server.upgrade(req, { data: { userId: u.id, instance: row, cols, rows } })) return undefined
  return new Response('Upgrade failed', { status: 400 })
}

const terminal = {
  maxPayloadLength: 1024 * 1024,
  idleTimeout: 0,
  sendPings: true,
  open(ws: ServerWebSocket<TerminalData>) {
    const { instance, cols, rows, userId } = ws.data
    openTerminals.set(userId, (openTerminals.get(userId) ?? 0) + 1)
    logEvent({ userId: instance.user_id, actorId: userId, instanceId: instance.id, action: 'terminal.open', message: instance.name })
    // `lxc exec` in a pseudo-terminal: resizing the terminal resizes the shell inside the container.
    const proc = Bun.spawn(lxd.shellCommand(instance.name), {
      terminal: {
        cols,
        rows,
        data(_term, data) {
          if (ws.readyState === 1) ws.sendBinary(data)
        },
      },
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    ws.data.proc = proc
    proc.exited.then(() => ws.close())
  },
  message(ws: ServerWebSocket<TerminalData>, message: string | Buffer) {
    let parsed: { t?: string; d?: string; c?: number; r?: number }
    try {
      parsed = JSON.parse(String(message))
    } catch {
      return
    }
    const term = ws.data.proc?.terminal
    if (!term) return
    if (parsed.t === 'i' && typeof parsed.d === 'string') term.write(parsed.d)
    else if (parsed.t === 'r') {
      term.resize(Math.min(500, Math.max(20, Number(parsed.c) || ws.data.cols)), Math.min(300, Math.max(5, Number(parsed.r) || ws.data.rows)))
    }
  },
  close(ws: ServerWebSocket<TerminalData>) {
    openTerminals.set(ws.data.userId, Math.max(0, (openTerminals.get(ws.data.userId) ?? 1) - 1))
    ws.data.proc?.kill()
  },
}

// ---- static interface ------------------------------------------------------

async function serveStatic(url: URL) {
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(config.webDist, requested)
  const inside = file.startsWith(config.webDist)
  const target = inside && requested !== '/' && (await Bun.file(file).exists()) ? file : join(config.webDist, 'index.html')
  if (!(await Bun.file(target).exists())) return new Response('The interface has not been built. Run: bun run build', { status: 503 })
  const immutable = target.includes('/assets/')
  return new Response(Bun.file(target), {
    headers: { ...SECURITY_HEADERS, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
  })
}

// ---- start -----------------------------------------------------------------

ensureAdmin({ announce: true })
inst.onDelete(domains.removeInstanceDomains)

try {
  await lxd.ensureRuntime()
  await lxd.ensureFirewall()
} catch (error) {
  console.error(`LXD is not ready: ${(error as Error).message}. Containers will be unavailable until it is.`)
}
inst.recoverInterrupted()
startCollector()

const server = Bun.serve<TerminalData>({
  hostname: config.host,
  port: config.port,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url)
    const term = url.pathname.match(/^\/api\/instances\/([0-9a-f-]{36})\/terminal$/)
    if (term) return upgradeTerminal(req, url, srv, term[1]!)
    if (url.pathname.startsWith('/api/')) return handleApi(req, url, srv)
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Not Found', { status: 404 })
    return serveStatic(url)
  },
  websocket: terminal,
})

console.log(`Boukarou ${version} listening on http://${server.hostname}:${server.port} (project ${config.project})`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop()
    process.exit(0)
  })
}
