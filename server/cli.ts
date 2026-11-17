// boukarou <command>: administration on the server itself.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { generatePassword, hashPasswordSync } from './auth.ts'
import { ensureAdmin, INITIAL_PASSWORD_FILE } from './bootstrap.ts'
import { config } from './config.ts'
import { db, getSetting, logEvent, setSetting, type UserRow } from './db.ts'

const [cmd, ...args] = process.argv.slice(2)
const line = (s = '') => process.stdout.write(`${s}\n`)

function askHidden(question: string) {
  process.stdout.write(question)
  Bun.spawnSync(['stty', '-echo'], { stdin: 'inherit' })
  const answer = prompt('') ?? ''
  Bun.spawnSync(['stty', 'echo'], { stdin: 'inherit' })
  line()
  return answer
}

const revokeSessions = (userId: number) => db.query('DELETE FROM sessions WHERE user_id = ?').run(userId)

switch (cmd) {
  case 'init': {
    const password = ensureAdmin()
    if (password) {
      line('Administrator created.')
      line('  username: admin')
      line(`  password: ${password}`)
    } else if (existsSync(INITIAL_PASSWORD_FILE)) {
      line('Administrator already exists.')
      line('  username: admin')
      line(`  password: ${readFileSync(INITIAL_PASSWORD_FILE, 'utf8').trim()}`)
    } else {
      line('Administrator already exists. Use `boukarou reset-admin-password` if you lost the password.')
    }
    break
  }
  case 'reset-admin-password': {
    const admin = db.query<UserRow, []>("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
    if (!admin) {
      ensureAdmin()
      line('No administrator existed; one was created. Run this command again to get a fresh password.')
      break
    }
    let password: string
    if (args.includes('--prompt')) {
      password = askHidden('New administrator password (10+ characters): ')
      if (password.length < 10) {
        line('Too short. Nothing changed.')
        process.exitCode = 1
        break
      }
    } else password = generatePassword(20)
    db.query('UPDATE users SET password_hash = ?, disabled = 0, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(
      hashPasswordSync(password),
      admin.id,
    )
    revokeSessions(admin.id)
    rmSync(INITIAL_PASSWORD_FILE, { force: true })
    logEvent({ userId: admin.id, action: 'admin.password_reset', message: 'from the command line' })
    line('Administrator password reset. Two-factor sign-in was turned off and all sessions were signed out.')
    line(`  username: ${admin.username}`)
    if (!args.includes('--prompt')) line(`  password: ${password}`)
    break
  }
  case 'reset-password': {
    const username = (args[0] || prompt('Username:') || '').trim().toLowerCase()
    const user = db.query<UserRow, [string]>('SELECT * FROM users WHERE username = ?').get(username)
    if (!user) {
      line('No such user.')
      process.exitCode = 1
      break
    }
    const password = generatePassword(16)
    db.query('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(
      hashPasswordSync(password),
      user.role === 'admin' ? 0 : 1,
      user.id,
    )
    revokeSessions(user.id)
    line(`New password for ${user.username}: ${password}`)
    if (user.role !== 'admin') line('They will be asked to choose their own at next sign-in.')
    break
  }
  case 'users': {
    for (const u of db.query<{ username: string; role: string; disabled: number }, []>('SELECT username, role, disabled FROM users ORDER BY id').all()) {
      line(`${u.username.padEnd(24)} ${u.role.padEnd(6)} ${u.disabled ? 'disabled' : ''}`)
    }
    break
  }
  case 'set-public-host': {
    const host = String(args[0] ?? '').trim()
    if (!/^[a-zA-Z0-9.:-]{2,253}$/.test(host)) {
      line('Usage: boukarou set-public-host <ip-or-hostname>')
      process.exitCode = 1
      break
    }
    setSetting('public_host', host)
    line(`Public address set to ${host}.`)
    break
  }
  case 'info': {
    line(`data directory : ${config.dataDir}`)
    line(`database       : ${config.dbFile}`)
    line(`LXD project    : ${config.project}`)
    line(`LXD network    : ${config.network}`)
    line(`storage pool   : ${config.pool}`)
    line(`listening on   : ${config.host}:${config.port}`)
    line(`public address : ${getSetting('public_host') || '(not set)'}`)
    break
  }
  default:
    line('Usage: boukarou <command>')
    line()
    line('  reset-admin-password [--prompt]  new administrator password (random, or typed with --prompt)')
    line('  reset-password <username>        new random password for a user')
    line('  users                            list accounts')
    line('  set-public-host <ip|host>        address shown in SSH commands and used for domains')
    line('  info                             paths and LXD settings')
    line('  doctor                           check the installation')
    line('  update                           pull the latest version and restart')
    line('  logs                             follow the service logs')
    line('  uninstall                        remove the panel (containers are kept)')
    process.exitCode = cmd ? 1 : 0
}
