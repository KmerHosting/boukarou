import crypto from "node:crypto";

// Synchronous twin of auth.hashPassword (same format), for CLI and first boot.
export function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
