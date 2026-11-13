import fs from "node:fs";
import path from "node:path";

const env = process.env;
const dev = env.NODE_ENV !== "production";

function firstExisting(paths) {
  return paths.find((p) => {
    try {
      return fs.statSync(p).isSocket();
    } catch {
      return false;
    }
  });
}

export const config = {
  dev,
  port: Number(env.PORT || 1974),
  host: env.HOST || "0.0.0.0",
  dataDir: path.resolve(env.BOUKAROU_DATA_DIR || (dev ? "data" : "/var/lib/boukarou")),
  // LXD / Incus
  lxcBinary: env.BOUKAROU_LXC_BINARY || "",
  lxdSocket:
    env.BOUKAROU_LXD_SOCKET ||
    firstExisting([
      "/var/snap/lxd/common/lxd/unix.socket",
      "/var/lib/lxd/unix.socket",
      "/var/lib/incus/unix.socket",
    ]) ||
    "/var/snap/lxd/common/lxd/unix.socket",
  project: env.BOUKAROU_PROJECT || "boukarou",
  network: env.BOUKAROU_NETWORK || "boukaroubr0",
  pool: env.BOUKAROU_POOL || "default",
  // Host integration
  manageUfw: env.BOUKAROU_MANAGE_UFW !== "false",
  nginxSitesAvailable: env.BOUKAROU_NGINX_SITES_AVAILABLE || "/etc/nginx/sites-available",
  nginxSitesEnabled: env.BOUKAROU_NGINX_SITES_ENABLED || "/etc/nginx/sites-enabled",
  // Names that must never be attached to a container (the panel's own domain…)
  reservedDomains: (env.BOUKAROU_RESERVED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  webDist: path.resolve(env.BOUKAROU_WEB_DIST || "dist"),
};

config.acmeRoot = path.join(config.dataDir, "acme");
config.dbFile = path.join(config.dataDir, "panel.db");
