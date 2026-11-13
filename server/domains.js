// Custom domains: nginx reverse proxy on the host + Let's Encrypt (webroot).
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { config } from "./config.js";
import { db, getSetting, logEvent, now } from "./db.js";
import { HttpError } from "./instances.js";

const PREFIX = "boukarou-domain-";

function command(bin, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(-1500)));
      else resolve(stdout);
    });
  });
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function binaries() {
  const nginx = (await exists("/usr/sbin/nginx")) ? "/usr/sbin/nginx" : null;
  let certbot = null;
  for (const c of ["/snap/bin/certbot", "/usr/bin/certbot"]) if (await exists(c)) { certbot = c; break; }
  return { nginx, certbot };
}

export async function domainsAvailable() {
  const { nginx, certbot } = await binaries();
  const host = getSetting("public_host");
  if (!nginx || !certbot) return { available: false, reason: "nginx and certbot are not installed on the host." };
  if (!host) return { available: false, reason: "The administrator has not set the server's public address yet." };
  return { available: true, reason: null };
}

export function normalizeDomain(value) {
  const ascii = domainToASCII(String(value || "").trim().toLowerCase().replace(/\.$/, ""));
  if (!ascii || ascii.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(ascii))
    throw new HttpError(400, "Enter a valid domain name, for example app.example.com.", "bad_domain");
  return ascii;
}

async function publicIpv4() {
  const host = getSetting("public_host");
  if (isIP(host) === 4) return host;
  const ips = await resolve4(host).catch(() => []);
  if (!ips.length) throw new HttpError(503, "The server's public IPv4 address is not known.", "no_public_ip");
  return ips[0];
}

const paths = (id) => ({
  available: `${config.nginxSitesAvailable}/${PREFIX}${id}.conf`,
  enabled: `${config.nginxSitesEnabled}/${PREFIX}${id}.conf`,
  cert: `${PREFIX}${id}`,
});

function location(ip, port) {
  const proto = port === 443 ? "https" : "http";
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
    proxy_buffering off;${proto === "https" ? "\n    proxy_ssl_server_name on;\n    proxy_ssl_verify off;" : ""}
  }`;
}
const acme = `  location ^~ /.well-known/acme-challenge/ {
    root ${config.acmeRoot};
    default_type text/plain;
  }`;

function httpConf(domain, ip, port) {
  return `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
  client_max_body_size 0;
${acme}
${location(ip, port)}
}
`;
}
function tlsConf(domain, ip, port, cert) {
  return `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
${acme}
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
`;
}

async function write(path, content) {
  const tmp = `${path}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, { mode: 0o644 });
  await fs.rename(tmp, path);
}
async function reload(nginx) {
  await command(nginx, ["-t"], 30_000);
  await command("systemctl", ["reload", "nginx"], 30_000);
}

async function assertNameFree(domain, ownFile) {
  const files = await fs.readdir(config.nginxSitesEnabled).catch(() => []);
  for (const f of files) {
    if (`${config.nginxSitesEnabled}/${f}` === ownFile) continue;
    const content = await fs.readFile(`${config.nginxSitesEnabled}/${f}`, "utf8").catch(() => "");
    for (const m of content.matchAll(/\bserver_name\s+([^;]+);/g))
      if (m[1].split(/\s+/).includes(domain)) throw new HttpError(409, `${domain} is already served by this host.`, "domain_taken");
  }
}

let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
};

export const listDomains = (instanceId) =>
  db.prepare("SELECT * FROM domains WHERE instance_id = ? ORDER BY created_at").all(instanceId).map(publicDomain);

export const publicDomain = (d) => ({
  id: d.id, domain: d.domain, targetPort: d.target_port, status: d.status, error: d.error, createdAt: d.created_at,
});

export async function addDomain(instance, owner, { domain, targetPort }, actor) {
  const avail = await domainsAvailable();
  if (!avail.available) throw new HttpError(503, avail.reason, "domains_unavailable");
  const name = normalizeDomain(domain);
  if (config.reservedDomains.includes(name)) throw new HttpError(409, `${name} is reserved.`, "domain_reserved");
  const port = Number(targetPort || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, "Port must be between 1 and 65535.", "bad_port");
  if (!instance.ipv4) throw new HttpError(409, "The container has no private address yet.", "no_ip");
  if (owner.role !== "admin" && owner.max_domains != null) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM domains WHERE user_id = ?").get(owner.id).n;
    if (count >= owner.max_domains) throw new HttpError(403, `Your account allows ${owner.max_domains} domain(s).`, "quota");
  }
  if (db.prepare("SELECT 1 FROM domains WHERE domain = ?").get(name)) throw new HttpError(409, `${name} is already attached.`, "domain_taken");
  const ip = await publicIpv4();
  const resolved = await resolve4(name).catch(() => []);
  if (!resolved.includes(ip))
    throw new HttpError(400, `Create an A record for ${name} pointing to ${ip}, wait for it to propagate, then try again.`, "dns");

  const id = crypto.randomBytes(8).toString("hex");
  db.prepare(
    "INSERT INTO domains(id, instance_id, user_id, domain, target_port, status, created_at) VALUES(?,?,?,?,?,'provisioning',?)",
  ).run(id, instance.id, instance.user_id, name, port, now());
  logEvent({ userId: instance.user_id, actorId: actor.id, instanceId: instance.id, action: "domain.add", message: name });

  serial(async () => {
    const p = paths(id);
    const { nginx, certbot } = await binaries();
    try {
      await fs.mkdir(`${config.acmeRoot}/.well-known/acme-challenge`, { recursive: true });
      await assertNameFree(name, p.enabled);
      await write(p.available, httpConf(name, instance.ipv4, port));
      await fs.symlink(p.available, p.enabled).catch((e) => { if (e.code !== "EEXIST") throw e; });
      await reload(nginx);
      const email = getSetting("acme_email");
      await command(certbot, [
        "certonly", "--webroot", "--webroot-path", config.acmeRoot, "-d", name, "--cert-name", p.cert,
        "--non-interactive", "--agree-tos", ...(email ? ["--email", email] : ["--register-unsafely-without-email"]),
        "--keep-until-expiring", "--deploy-hook", "systemctl reload nginx",
      ], 240_000);
      await write(p.available, tlsConf(name, instance.ipv4, port, p.cert));
      await reload(nginx);
      db.prepare("UPDATE domains SET status='active', error=NULL WHERE id=?").run(id);
      logEvent({ userId: instance.user_id, instanceId: instance.id, action: "domain.active", message: name });
    } catch (error) {
      await fs.unlink(p.enabled).catch(() => undefined);
      await fs.unlink(p.available).catch(() => undefined);
      await reload(nginx).catch(() => undefined);
      db.prepare("UPDATE domains SET status='failed', error=? WHERE id=?").run(error.message.slice(0, 1000), id);
      logEvent({ userId: instance.user_id, instanceId: instance.id, level: "error", action: "domain.failed", message: `${name}: ${error.message.slice(0, 300)}` });
    }
  });
  return id;
}

export async function removeDomain(domainRow, actor) {
  db.prepare("UPDATE domains SET status='deleting' WHERE id=?").run(domainRow.id);
  await serial(async () => {
    const p = paths(domainRow.id);
    const { nginx, certbot } = await binaries();
    await fs.unlink(p.enabled).catch(() => undefined);
    await fs.unlink(p.available).catch(() => undefined);
    if (nginx) await reload(nginx).catch(() => undefined);
    if (certbot) await command(certbot, ["delete", "--cert-name", p.cert, "--non-interactive"], 60_000).catch(() => undefined);
  });
  db.prepare("DELETE FROM domains WHERE id=?").run(domainRow.id);
  logEvent({ userId: domainRow.user_id, actorId: actor?.id ?? null, instanceId: domainRow.instance_id, action: "domain.remove", message: domainRow.domain });
}

export async function removeInstanceDomains(instanceId) {
  for (const d of db.prepare("SELECT * FROM domains WHERE instance_id = ?").all(instanceId)) await removeDomain(d, null);
}
