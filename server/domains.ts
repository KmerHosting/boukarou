// Custom domains: an nginx reverse proxy on the host, with a Let's Encrypt certificate (webroot).
import { randomBytes } from 'node:crypto'
import { resolve4 } from 'node:dns/promises'
import { access, mkdir, readdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { config } from './config.ts'
import { db, getSetting, logEvent, now, type DomainRow, type InstanceRow, type UserRow } from './db.ts'
import { HttpError } from './errors.ts'

const PREFIX = 'boukarou-domain-'

async function command(bin: string, args: string[], timeout = 120_000) {
  const proc = Bun.spawn([bin, ...args], { stdout: 'pipe', stderr: 'pipe', timeout })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error((stderr || stdout || `exit ${code}`).trim().slice(-1500))
  return stdout
}

const exists = (p: string) => access(p).then(() => true, () => false)

async function binaries() {
  const nginx = (await exists('/usr/sbin/nginx')) ? '/usr/sbin/nginx' : null
  let certbot: string | null = null
  for (const c of ['/snap/bin/certbot', '/usr/bin/certbot']) {
    if (await exists(c)) {
      certbot = c
      break
    }
  }
  return { nginx, certbot }
}

export async function domainsAvailable() {
  const { nginx, certbot } = await binaries()
  if (!nginx || !certbot) return { available: false, reason: 'nginx and certbot are not installed on the host.' }
  if (!getSetting('public_host')) return { available: false, reason: "The administrator has not set the server's public address yet." }
  return { available: true, reason: null }
}

export function normalizeDomain(value: unknown) {
  const ascii = domainToASCII(String(value ?? '').trim().toLowerCase().replace(/\.$/, ''))
  if (!ascii || ascii.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(ascii)) {
    throw new HttpError(400, 'Enter a valid domain name, for example app.example.com.', 'bad_domain')
  }
  return ascii
}

async function publicIpv4() {
  const host = getSetting('public_host')
  if (isIP(host) === 4) return host
  const ips = await resolve4(host).catch(() => [] as string[])
  if (!ips.length) throw new HttpError(503, "The server's public IPv4 address is not known.", 'no_public_ip')
  return ips[0]!
}

const paths = (id: string) => ({
  available: `${config.nginxSitesAvailable}/${PREFIX}${id}.conf`,
  enabled: `${config.nginxSitesEnabled}/${PREFIX}${id}.conf`,
  cert: `${PREFIX}${id}`,
})

function location(ip: string, port: number) {
  const proto = port === 443 ? 'https' : 'http'
  return `  location / {
    proxy_pass ${proto}://${ip}:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_request_buffering off;
    proxy_buffering off;${proto === 'https' ? '\n    proxy_ssl_server_name on;\n    proxy_ssl_verify off;' : ''}
  }`
}

const acme = () => `  location ^~ /.well-known/acme-challenge/ {
    root ${config.acmeRoot};
    default_type text/plain;
  }`

const httpConf = (domain: string, ip: string, port: number) => `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
  client_max_body_size 0;
${acme()}
${location(ip, port)}
}
`

const tlsConf = (domain: string, ip: string, port: number, cert: string) => `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
${acme()}
  location / { return 301 https://$host$request_uri; }
}
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name ${domain};
  client_max_body_size 0;
  ssl_certificate /etc/letsencrypt/live/${cert}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${cert}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
${location(ip, port)}
}
`

async function write(path: string, content: string) {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, content, { mode: 0o644 })
  await rename(tmp, path)
}

async function reload(nginx: string) {
  await command(nginx, ['-t'], 30_000)
  await command('systemctl', ['reload', 'nginx'], 30_000)
}

/** Refuses a name that another nginx site on the host already serves. */
async function assertNameFree(domain: string, ownFile: string) {
  for (const file of await readdir(config.nginxSitesEnabled).catch(() => [] as string[])) {
    const full = `${config.nginxSitesEnabled}/${file}`
    if (full === ownFile) continue
    const content = await readFile(full, 'utf8').catch(() => '')
    for (const m of content.matchAll(/\bserver_name\s+([^;]+);/g)) {
      if (m[1]!.split(/\s+/).includes(domain)) throw new HttpError(409, `${domain} is already served by this host.`, 'domain_taken')
    }
  }
}

// nginx changes happen one at a time.
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>) {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export const publicDomain = (d: DomainRow) => ({
  id: d.id,
  domain: d.domain,
  targetPort: d.target_port,
  status: d.status,
  error: d.error,
  createdAt: d.created_at,
})

export const listDomains = (instanceId: string) =>
  db.query<DomainRow, [string]>('SELECT * FROM domains WHERE instance_id = ? ORDER BY created_at').all(instanceId).map(publicDomain)

export async function addDomain(instance: InstanceRow, owner: UserRow, body: { domain?: unknown; targetPort?: unknown }, actor: UserRow) {
  const avail = await domainsAvailable()
  if (!avail.available) throw new HttpError(503, avail.reason!, 'domains_unavailable')
  const name = normalizeDomain(body.domain)
  if (config.reservedDomains.includes(name)) throw new HttpError(409, `${name} is reserved.`, 'domain_reserved')
  const port = Number(body.targetPort || 80)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be between 1 and 65535.', 'bad_port')
  if (!instance.ipv4) throw new HttpError(409, 'The container has no private address yet.', 'no_ip')
  if (owner.role !== 'admin' && owner.max_domains != null) {
    const count = db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM domains WHERE user_id = ?').get(owner.id)!.n
    if (count >= owner.max_domains) throw new HttpError(403, `Your account allows ${owner.max_domains} domain(s).`, 'quota')
  }
  if (db.query('SELECT 1 FROM domains WHERE domain = ?').get(name)) throw new HttpError(409, `${name} is already attached.`, 'domain_taken')
  const ip = await publicIpv4()
  const resolved = await resolve4(name).catch(() => [] as string[])
  if (!resolved.includes(ip)) {
    throw new HttpError(400, `Create an A record for ${name} pointing to ${ip}, wait for it to propagate, then try again.`, 'dns')
  }

  const id = randomBytes(8).toString('hex')
  db.query("INSERT INTO domains(id, instance_id, user_id, domain, target_port, status, created_at) VALUES(?,?,?,?,?,'provisioning',?)").run(
    id,
    instance.id,
    instance.user_id,
    name,
    port,
    now(),
  )
  logEvent({ userId: instance.user_id, actorId: actor.id, instanceId: instance.id, action: 'domain.add', message: name })

  void serial(async () => {
    const p = paths(id)
    const { nginx, certbot } = await binaries()
    try {
      await mkdir(`${config.acmeRoot}/.well-known/acme-challenge`, { recursive: true })
      await assertNameFree(name, p.enabled)
      await write(p.available, httpConf(name, instance.ipv4!, port))
      await symlink(p.available, p.enabled).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e
      })
      await reload(nginx!)
      const email = getSetting('acme_email')
      await command(
        certbot!,
        [
          'certonly', '--webroot', '--webroot-path', config.acmeRoot, '-d', name, '--cert-name', p.cert,
          '--non-interactive', '--agree-tos', ...(email ? ['--email', email] : ['--register-unsafely-without-email']),
          '--keep-until-expiring', '--deploy-hook', 'systemctl reload nginx',
        ],
        240_000,
      )
      await write(p.available, tlsConf(name, instance.ipv4!, port, p.cert))
      await reload(nginx!)
      db.query("UPDATE domains SET status='active', error=NULL WHERE id=?").run(id)
      logEvent({ userId: instance.user_id, instanceId: instance.id, action: 'domain.active', message: name })
    } catch (error) {
      const message = (error as Error).message
      await unlink(p.enabled).catch(() => undefined)
      await unlink(p.available).catch(() => undefined)
      if (nginx) await reload(nginx).catch(() => undefined)
      db.query("UPDATE domains SET status='failed', error=? WHERE id=?").run(message.slice(0, 1000), id)
      logEvent({ userId: instance.user_id, instanceId: instance.id, level: 'error', action: 'domain.failed', message: `${name}: ${message.slice(0, 300)}` })
    }
  })
  return id
}

export async function removeDomain(domain: DomainRow, actor: UserRow | null) {
  db.query("UPDATE domains SET status='deleting' WHERE id=?").run(domain.id)
  await serial(async () => {
    const p = paths(domain.id)
    const { nginx, certbot } = await binaries()
    await unlink(p.enabled).catch(() => undefined)
    await unlink(p.available).catch(() => undefined)
    if (nginx) await reload(nginx).catch(() => undefined)
    if (certbot) await command(certbot, ['delete', '--cert-name', p.cert, '--non-interactive'], 60_000).catch(() => undefined)
  })
  db.query('DELETE FROM domains WHERE id=?').run(domain.id)
  logEvent({ userId: domain.user_id, actorId: actor?.id ?? null, instanceId: domain.instance_id, action: 'domain.remove', message: domain.domain })
}

export async function removeInstanceDomains(instanceId: string) {
  for (const d of db.query<DomainRow, [string]>('SELECT * FROM domains WHERE instance_id = ?').all(instanceId)) await removeDomain(d, null)
}
