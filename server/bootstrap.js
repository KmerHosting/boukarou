import fs from "node:fs";
import path from "node:path";
import { hashPasswordSync } from "./password-sync.js";
import { generatePassword } from "./auth.js";
import { config } from "./config.js";
import { db, logEvent, now } from "./db.js";

export const INITIAL_PASSWORD_FILE = path.join(config.dataDir, "initial-admin-password");

/** The first run creates the single administrator with a random password. */
export function ensureAdmin({ announce = false } = {}) {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return null;
  const password = generatePassword(20);
  db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES('admin', ?, 'admin', ?)").run(
    hashPasswordSync(password),
    now(),
  );
  logEvent({ action: "admin.created", message: "admin" });
  fs.writeFileSync(INITIAL_PASSWORD_FILE, `${password}\n`, { mode: 0o600 });
  // Only print the password on an interactive terminal (dev). Under systemd it
  // would end up in the journal; the installer reads the file instead.
  if (announce && process.stdout.isTTY) {
    console.log("──────────────────────────────────────────────");
    console.log(" Administrator account created");
    console.log("   username: admin");
    console.log(`   password: ${password}`);
    console.log(` (also saved to ${INITIAL_PASSWORD_FILE})`);
    console.log("──────────────────────────────────────────────");
  } else if (announce) {
    console.log(`Administrator account "admin" created. Password saved to ${INITIAL_PASSWORD_FILE}`);
  }
  return password;
}
