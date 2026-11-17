import { config } from './config.ts'
import { db, logEvent, now, type InstanceRow } from './db.ts'
import { busyOp, setTrafficBlocked } from './instances.ts'
import * as lxd from './lxd.ts'

const INTERVAL = 60_000
const RETENTION = 7 * 24 * 3600_000
const DISK_EVERY = 15 * 60_000
const diskCache = new Map<string, { at: number; bytes: number }>()

/** The traffic period, a calendar month in UTC: "2026-11". */
export const period = (t = Date.now()) => new Date(t).toISOString().slice(0, 7)

async function du(path: string) {
  const proc = Bun.spawn(['du', '-sx', '--block-size=1', path], { stdout: 'pipe', stderr: 'ignore', timeout: 120_000 })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return code === 0 ? Number(out.split(/\s+/)[0]) || 0 : null
}

async function diskUsed(name: string, state: lxd.LxdState) {
  const reported = state.disk?.root?.usage
  if (reported) return reported
  const cached = diskCache.get(name)
  if (cached && now() - cached.at < DISK_EVERY) return cached.bytes
  const base = config.lxdSocket.includes('/snap/') ? '/var/snap/lxd/common/lxd' : config.lxdSocket.includes('incus') ? '/var/lib/incus' : '/var/lib/lxd'
  const bytes = await du(`${base}/storage-pools/${config.pool}/containers/${config.project}_${name}/rootfs`)
  if (bytes != null) diskCache.set(name, { at: now(), bytes })
  return bytes ?? cached?.bytes ?? 0
}

let collecting = false

/** Samples every container once: status, CPU, memory, disk, network and monthly traffic. */
export async function collect() {
  if (collecting) return
  collecting = true
  try {
    const live = await lxd.listInstances().catch(() => null)
    if (!live) return
    const byName = new Map(live.map((i) => [i.name, i]))
    const rows = db
      .query<InstanceRow & { owner_traffic_gb: number | null; owner_role: string }, []>(
        'SELECT i.*, u.traffic_gb AS owner_traffic_gb, u.role AS owner_role FROM instances i JOIN users u ON u.id = i.user_id',
      )
      .all()
    const t = now()
    const p = period(t)
    for (const row of rows) {
      const inst = byName.get(row.name)
      if (!inst) {
        if (['running', 'stopped', 'frozen'].includes(row.status) && !busyOp(row.id)) {
          db.query("UPDATE instances SET status='unknown', updated_at=? WHERE id=?").run(t, row.id)
        }
        continue
      }
      const state = inst.state ?? {}
      const status = lxd.mapStatus(inst.status)
      const settled = !['creating', 'reinstalling', 'deleting'].includes(row.status) && !busyOp(row.id)
      const { ipv4, ipv6 } = lxd.addressesOf(state)
      if (settled) {
        // A failed container stays failed until it is retried or reinstalled.
        db.query('UPDATE instances SET status=?, ipv4=COALESCE(?, ipv4), ipv6=COALESCE(?, ipv6), updated_at=? WHERE id=?').run(
          row.status === 'failed' ? 'failed' : status,
          ipv4,
          ipv6,
          t,
          row.id,
        )
      }
      if (row.status === 'creating' || row.status === 'deleting') continue

      const cpuNs = Number(state.cpu?.usage ?? 0)
      let rx = 0
      let tx = 0
      for (const [ifname, net] of Object.entries(state.network ?? {})) {
        if (ifname === 'lo') continue
        rx += Number(net.counters?.bytes_received ?? 0)
        tx += Number(net.counters?.bytes_sent ?? 0)
      }
      const elapsed = row.last_sample_at ? Math.max(1, (t - row.last_sample_at) / 1000) : 0
      const delta = (cur: number, prev: number | null) => (prev == null ? 0 : cur >= prev ? cur - prev : cur) // counters reset on reboot
      const cpuPct =
        elapsed && row.last_cpu_ns != null ? Math.min(100, (delta(cpuNs, row.last_cpu_ns) / 1e9 / elapsed / Math.max(1, row.cpu)) * 100) : 0
      const dRx = delta(rx, row.last_rx)
      const dTx = delta(tx, row.last_tx)
      const disk = await diskUsed(row.name, state)

      if (status === 'running' || row.last_sample_at) {
        db.query(
          'INSERT INTO metrics(instance_id, at, cpu_pct, mem_used, mem_total, disk_used, rx_bps, tx_bps, processes) VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(
          row.id,
          t,
          Math.round(cpuPct * 10) / 10,
          Number(state.memory?.usage ?? 0),
          Number(state.memory?.total ?? 0) || row.memory_mb * 1048576,
          disk,
          elapsed ? Math.round(dRx / elapsed) : 0,
          elapsed ? Math.round(dTx / elapsed) : 0,
          Number(state.processes ?? 0),
        )
      }
      db.query('UPDATE instances SET last_cpu_ns=?, last_rx=?, last_tx=?, last_sample_at=? WHERE id=?').run(cpuNs, rx, tx, t, row.id)

      if (dRx || dTx) {
        db.query(
          `INSERT INTO traffic(instance_id, period, rx, tx) VALUES(?,?,?,?)
           ON CONFLICT(instance_id, period) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx`,
        ).run(row.id, p, dRx, dTx)
      }

      // Monthly traffic quota per container, set by the administrator on the owner.
      const quota = row.owner_role === 'admin' ? null : row.owner_traffic_gb
      const used = db.query<{ used: number }, [string, string]>('SELECT rx + tx AS used FROM traffic WHERE instance_id=? AND period=?').get(row.id, p)?.used ?? 0
      const shouldBlock = quota != null && used >= quota * 1e9
      if (shouldBlock !== !!row.traffic_blocked && !busyOp(row.id)) {
        try {
          await setTrafficBlocked(row, shouldBlock)
          logEvent({
            userId: row.user_id,
            instanceId: row.id,
            level: shouldBlock ? 'warning' : 'info',
            action: shouldBlock ? 'traffic.blocked' : 'traffic.restored',
            message: shouldBlock ? `Monthly traffic quota of ${quota} GB reached` : 'Network restored',
          })
        } catch (e) {
          console.error('traffic limit update failed', row.name, (e as Error).message)
        }
      }
    }
    db.query('DELETE FROM metrics WHERE at < ?').run(t - RETENTION)
    db.query('DELETE FROM events WHERE at < ?').run(t - 180 * 24 * 3600_000)
  } finally {
    collecting = false
  }
}

export function startCollector() {
  setTimeout(() => collect().catch((e) => console.error('metrics', e)), 5_000)
  setInterval(() => collect().catch((e) => console.error('metrics', e)), INTERVAL)
}

interface MetricRow {
  at: number
  cpu_pct: number
  mem_used: number
  mem_total: number
  disk_used: number
  rx_bps: number
  tx_bps: number
  processes: number
}

/** Readings for a chart, averaged down to about `points` values. */
export function series(instanceId: string, rangeMs: number, points = 120) {
  const since = now() - rangeMs
  const rows = db.query<MetricRow, [string, number]>('SELECT * FROM metrics WHERE instance_id = ? AND at >= ? ORDER BY at').all(instanceId, since)
  if (rows.length <= points) return rows.map(shape)
  const bucket = rangeMs / points
  const out: MetricRow[] = []
  let current: { b: number; items: MetricRow[] } | null = null
  for (const r of rows) {
    const b = Math.floor((r.at - since) / bucket)
    if (!current || current.b !== b) {
      if (current) out.push(average(current.items))
      current = { b, items: [] }
    }
    current.items.push(r)
  }
  if (current) out.push(average(current.items))
  return out.map(shape)
}

function average(items: MetricRow[]): MetricRow {
  const n = items.length
  const sum = (k: keyof MetricRow) => items.reduce((s, r) => s + r[k], 0)
  const last = items[n - 1]!
  return {
    at: last.at,
    cpu_pct: sum('cpu_pct') / n,
    mem_used: sum('mem_used') / n,
    mem_total: last.mem_total,
    disk_used: last.disk_used,
    rx_bps: sum('rx_bps') / n,
    tx_bps: sum('tx_bps') / n,
    processes: last.processes,
  }
}

const shape = (r: MetricRow) => ({
  at: r.at,
  cpu: Math.round(r.cpu_pct * 10) / 10,
  memUsed: Math.round(r.mem_used),
  memTotal: r.mem_total,
  diskUsed: r.disk_used,
  rx: Math.round(r.rx_bps),
  tx: Math.round(r.tx_bps),
  processes: r.processes,
})

export function trafficFor(instanceId: string) {
  const row = db.query<{ rx: number; tx: number }, [string, string]>('SELECT rx, tx FROM traffic WHERE instance_id=? AND period=?').get(instanceId, period())
  return { period: period(), rx: row?.rx ?? 0, tx: row?.tx ?? 0 }
}
