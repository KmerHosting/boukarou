import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generatePassword, hashPasswordSync } from './auth.ts'
import { config } from './config.ts'
import { db, logEvent, now } from './db.ts'

export const INITIAL_PASSWORD_FILE = join(config.dataDir, 'initial-admin-password')

/** The first start creates the single administrator with a random password. */
export function ensureAdmin({ announce = false } = {}) {
  if (db.query("SELECT 1 FROM users WHERE role = 'admin'").get()) return null
  const password = generatePassword(20)
  db.query("INSERT INTO users(username, password_hash, role, created_at) VALUES('admin', ?, 'admin', ?)").run(hashPasswordSync(password), now())
  logEvent({ action: 'admin.created', message: 'admin' })
  writeFileSync(INITIAL_PASSWORD_FILE, `${password}\n`, { mode: 0o600 })
  // On a terminal (development) the password is printed. Under systemd it would land in
  // the journal, so the installer reads the file instead.
  if (announce && process.stdout.isTTY) {
    console.log('Administrator account created')
    console.log('  username: admin')
    console.log(`  password: ${password}`)
    console.log(`  (also saved to ${INITIAL_PASSWORD_FILE})`)
  } else if (announce) {
    console.log(`Administrator account "admin" created. Password saved to ${INITIAL_PASSWORD_FILE}`)
  }
  return password
}
