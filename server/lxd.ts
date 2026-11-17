// A thin layer over the LXD (or Incus) command line. Every container lives in one
// dedicated project, on one dedicated bridge.
import { existsSync } from 'node:fs'
import { config } from './config.ts'

export class LxdError extends Error {}

let binary: string | null = null
export function lxcBinary() {
  if (binary) return binary
  const candidates = [config.lxcBinary, '/snap/bin/lxc', '/usr/bin/incus', '/usr/sbin/lxc', '/usr/bin/lxc'].filter(Boolean)
  binary = candidates.find((p) => existsSync(p)) ?? 'lxc'
  return binary
}

/**
 * Runs the CLI with an argument list (never through a shell). `input` goes to stdin,
 * which keeps secrets such as passwords out of the process list.
 */
export async function run(args: string[], { timeout = 120_000, input }: { timeout?: number; input?: string } = {}) {
  let proc
  try {
    proc = Bun.spawn([lxcBinary(), ...args], {
      stdin: input == null ? 'ignore' : new TextEncoder().encode(input),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout,
      env: { ...process.env, LC_ALL: 'C' },
    })
  } catch (error) {
    throw new LxdError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'LXD is not installed on this host.' : String(error))
  }
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (proc.signalCode === 'SIGTERM' || proc.signalCode === 'SIGKILL') {
    throw new LxdError(`Timed out after ${Math.round(timeout / 1000)}s: ${args.slice(0, 2).join(' ')}`)
  }
  if (code !== 0) {
    throw new LxdError((stderr || stdout).trim().replace(/^Error:\s*/, '').slice(-1500) || `exit ${code}`)
  }
  return { stdout, stderr }
}

const P = () => ['--project', config.project]
const q = encodeURIComponent

export async function query<T>(path: string, timeout = 20_000): Promise<T> {
  return JSON.parse((await run(['query', path], { timeout })).stdout) as T
}

// ---- runtime setup ---------------------------------------------------------

export async function runtimeInfo() {
  try {
    const info = await query<{ environment?: { server?: string; server_version?: string; kernel_version?: string } }>('/1.0', 10_000)
    return {
      ok: true,
      server: info.environment?.server || 'lxd',
      version: info.environment?.server_version || '',
      kernel: info.environment?.kernel_version || '',
      storageDriver: await poolDriver().catch(() => ''),
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

let cachedDriver: string | null = null
export async function poolDriver() {
  cachedDriver ??= (await query<{ driver: string }>(`/1.0/storage-pools/${q(config.pool)}`, 10_000)).driver
  return cachedDriver
}

/** Disk sizes are only enforced by some storage drivers. */
export async function supportsDiskQuota() {
  const driver = await poolDriver().catch(() => 'dir')
  return ['btrfs', 'zfs', 'lvm', 'ceph'].includes(driver)
}

export async function ensureRuntime() {
  // A dedicated bridge, so containers never share address space with anything else on the host.
  const networks = await query<{ name: string }[]>('/1.0/networks?recursion=1', 15_000)
  if (!networks.some((n) => n.name === config.network)) {
    await run(['network', 'create', config.network, 'ipv4.address=auto', 'ipv4.nat=true', 'ipv6.address=auto', 'ipv6.nat=true'])
  }
  const projects = await query<{ name: string }[]>('/1.0/projects?recursion=1', 15_000)
  if (!projects.some((p) => p.name === config.project)) {
    await run([
      'project', 'create', config.project,
      '-c', 'features.images=false',
      '-c', 'features.profiles=true',
      '-c', 'features.storage.volumes=true',
      '-c', 'features.networks=false',
    ])
  }
  const profile = await query<{ devices?: Record<string, Record<string, string>> } & Record<string, unknown>>(
    `/1.0/profiles/default?project=${q(config.project)}`,
  )
  const devices = profile.devices ?? {}
  const eth0 = { type: 'nic', name: 'eth0', network: config.network }
  if (JSON.stringify(devices.eth0) !== JSON.stringify(eth0) || devices.root?.pool !== config.pool) {
    const body = JSON.stringify({ ...profile, devices: { ...devices, eth0, root: { type: 'disk', path: '/', pool: config.pool } } })
    await run(['query', '-X', 'PUT', '-d', body, `/1.0/profiles/default?project=${q(config.project)}`])
  }
}

async function ufw(args: string[]) {
  const proc = Bun.spawn(['ufw', ...args], { stdout: 'pipe', stderr: 'ignore', timeout: 30_000 })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]).catch(() => ['', 1] as const)
  return code === 0 ? out : ''
}

export const ufwActive = async () => config.manageUfw && Bun.which('ufw') !== null && /Status: active/.test(await ufw(['status']))

/** Opens or closes a firewall rule when UFW is active and managing it is allowed. */
export async function ufwRule(args: string[]) {
  if (await ufwActive()) await ufw(args)
}

/** UFW drops DHCP and DNS on new bridges; let containers reach them. */
export async function ensureFirewall() {
  if (!(await ufwActive())) return
  const n = config.network
  for (const [port, proto] of [['53', 'udp'], ['53', 'tcp'], ['67', 'udp'], ['547', 'udp']] as const) {
    await ufw(['allow', 'in', 'on', n, 'to', 'any', 'port', port, 'proto', proto])
  }
  await ufw(['route', 'allow', 'in', 'on', n])
  await ufw(['route', 'allow', 'out', 'on', n])
}

interface LxdInstance {
  name: string
  status: string
  expanded_devices?: Record<string, Record<string, string>>
  state?: LxdState
}

export interface LxdState {
  status?: string
  pid?: number
  processes?: number
  cpu?: { usage?: number }
  memory?: { usage?: number; total?: number }
  disk?: { root?: { usage?: number } }
  network?: Record<string, { addresses?: { family: string; scope: string; address: string }[]; counters?: { bytes_received?: number; bytes_sent?: number } }>
}

/** Every IPv4 used on our bridge across all projects: pinned addresses and live leases. */
export async function addressesOnNetwork() {
  const all = await query<LxdInstance[]>('/1.0/instances?recursion=2&all-projects=true', 30_000)
  const out = new Set<string>()
  for (const inst of all) {
    const nics = Object.values(inst.expanded_devices ?? {}).filter((d) => d.type === 'nic' && d.network === config.network)
    for (const nic of nics) if (nic['ipv4.address']) out.add(nic['ipv4.address'])
    if (!nics.length) continue
    for (const net of Object.values(inst.state?.network ?? {})) {
      for (const a of net.addresses ?? []) if (a.family === 'inet' && a.scope === 'global') out.add(a.address)
    }
  }
  return [...out]
}

export async function networkInfo() {
  const n = await query<{ config?: Record<string, string> }>(`/1.0/networks/${q(config.network)}`, 10_000)
  return { ipv4: n.config?.['ipv4.address'] ?? '', ipv6: n.config?.['ipv6.address'] ?? '' }
}

// ---- instances -------------------------------------------------------------

export const listInstances = () => query<LxdInstance[]>(`/1.0/instances?recursion=2&project=${q(config.project)}`, 30_000)

export async function getInstance(name: string) {
  try {
    return await query<LxdInstance>(`/1.0/instances/${q(name)}?recursion=1&project=${q(config.project)}`)
  } catch {
    return null
  }
}

export const getState = (name: string) => query<LxdState>(`/1.0/instances/${q(name)}/state?project=${q(config.project)}`)

export function mapStatus(status: string | undefined) {
  switch (String(status ?? '').toLowerCase()) {
    case 'running':
      return 'running'
    case 'stopped':
      return 'stopped'
    case 'frozen':
      return 'frozen'
    case 'error':
      return 'failed'
    default:
      return 'unknown'
  }
}

export function addressesOf(state: LxdState | null | undefined) {
  let ipv4: string | null = null
  let ipv6: string | null = null
  for (const [ifname, net] of Object.entries(state?.network ?? {})) {
    if (ifname === 'lo') continue
    for (const a of net.addresses ?? []) {
      if (a.scope !== 'global') continue
      if (a.family === 'inet' && !ipv4) ipv4 = a.address
      if (a.family === 'inet6' && !ipv6) ipv6 = a.address
    }
  }
  return { ipv4, ipv6 }
}

export function init(image: string, name: string, settings: Record<string, string | number>) {
  const args = ['init', image, name, ...P()]
  for (const [k, v] of Object.entries(settings)) args.push('-c', `${k}=${v}`)
  return run(args, { timeout: 15 * 60_000 }) // the first use of an image downloads it
}
export const start = (name: string) => run(['start', name, ...P()], { timeout: 120_000 })
export const stop = (name: string) => run(['stop', name, ...P(), '--timeout', '30', '--force'], { timeout: 90_000 })
export const restart = (name: string) => run(['restart', name, ...P(), '--timeout', '30', '--force'], { timeout: 120_000 })
export const freeze = (name: string) => run(['pause', name, ...P()], { timeout: 60_000 })
export const unfreeze = (name: string) => run(['start', name, ...P()], { timeout: 60_000 })
export const remove = (name: string) => run(['delete', name, ...P(), '--force'], { timeout: 180_000 })
export const rebuild = (image: string, name: string) => run(['rebuild', image, name, ...P(), '--force'], { timeout: 15 * 60_000 })

export const setConfig = (name: string, pairs: Record<string, string | number>) =>
  run(['config', 'set', name, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`), ...P()], { timeout: 60_000 })

export async function overrideDevice(name: string, device: string, pairs: Record<string, string | number>) {
  // "override" copies a profile device onto the instance; it fails harmlessly when it is already local.
  await run(['config', 'device', 'override', name, device, ...P()], { timeout: 30_000 }).catch(() => undefined)
  await run(['config', 'device', 'set', name, device, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`), ...P()], { timeout: 60_000 })
}
export const unsetDevice = (name: string, device: string, key: string) =>
  run(['config', 'device', 'unset', name, device, key, ...P()], { timeout: 30_000 })

export const addProxy = (name: string, device: string, listenPort: number, connectPort = 22) =>
  run(['config', 'device', 'add', name, device, 'proxy', `listen=tcp:0.0.0.0:${listenPort}`, `connect=tcp:127.0.0.1:${connectPort}`, ...P()], {
    timeout: 30_000,
  })

export const exec = (name: string, script: string, { timeout = 240_000, input }: { timeout?: number; input?: string } = {}) =>
  run(['exec', name, ...P(), '--', 'sh', '-c', script], { timeout, input })

/** The command that opens an interactive root shell in a container, for the browser console. */
export const shellCommand = (name: string) => [
  lxcBinary(), 'exec', name, ...P(), '--force-interactive', '--cwd', '/root',
  '--env', 'TERM=xterm-256color', '--env', 'HOME=/root', '--env', 'USER=root', '--env', 'LANG=C.UTF-8',
  '--', '/bin/sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi',
]

// ---- snapshots -------------------------------------------------------------

export async function listSnapshots(name: string) {
  const list = await query<{ name: string; created_at: string; stateful: boolean; size?: number }[]>(
    `/1.0/instances/${q(name)}/snapshots?recursion=1&project=${q(config.project)}`,
  )
  return list.map((s) => ({ name: s.name, createdAt: Date.parse(s.created_at), stateful: !!s.stateful, size: s.size ?? null }))
}
export const createSnapshot = (name: string, snap: string) => run(['snapshot', name, snap, ...P()], { timeout: 15 * 60_000 })
export const deleteSnapshot = (name: string, snap: string) => run(['delete', `${name}/${snap}`, ...P()], { timeout: 5 * 60_000 })
export const restoreSnapshot = (name: string, snap: string) => run(['restore', name, snap, ...P()], { timeout: 15 * 60_000 })
