import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const env = process.env
export const root = resolve(import.meta.dir, '..')
const dev = env.NODE_ENV !== 'production'

function firstSocket(paths: string[]) {
  return paths.find((path) => {
    try {
      return statSync(path).isSocket()
    } catch {
      return false
    }
  })
}

export const config = {
  dev,
  port: Number(env.PORT || 1974),
  host: env.HOST || '0.0.0.0',
  dataDir: resolve(env.BOUKAROU_DATA_DIR || (dev ? join(root, 'data') : '/var/lib/boukarou')),
  lxcBinary: env.BOUKAROU_LXC_BINARY || '',
  lxdSocket:
    env.BOUKAROU_LXD_SOCKET ||
    firstSocket(['/var/snap/lxd/common/lxd/unix.socket', '/var/lib/lxd/unix.socket', '/var/lib/incus/unix.socket']) ||
    '/var/snap/lxd/common/lxd/unix.socket',
  project: env.BOUKAROU_PROJECT || 'boukarou',
  network: env.BOUKAROU_NETWORK || 'boukaroubr0',
  pool: env.BOUKAROU_POOL || 'default',
  manageUfw: env.BOUKAROU_MANAGE_UFW !== 'false',
  nginxSitesAvailable: env.BOUKAROU_NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available',
  nginxSitesEnabled: env.BOUKAROU_NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled',
  // Names that must never be attached to a container, such as the panel's own domain.
  reservedDomains: (env.BOUKAROU_RESERVED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  webDist: resolve(env.BOUKAROU_WEB_DIST || join(root, 'web', 'dist')),
  acmeRoot: '',
  dbFile: '',
}

config.acmeRoot = join(config.dataDir, 'acme')
config.dbFile = join(config.dataDir, 'panel.db')
if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

export const version: string = (await Bun.file(join(root, 'package.json')).json()).version
