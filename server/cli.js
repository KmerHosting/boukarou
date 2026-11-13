#!/usr/bin/env node
// boukarou <command> — server-side administration.
import fs from "node:fs";
import readline from "node:readline/promises";
import { config } from "./config.js";
import { db, getSetting, logEvent, setSetting } from "./db.js";
import { generatePassword } from "./auth.js";
import { hashPasswordSync } from "./password-sync.js";
import { ensureAdmin, INITIAL_PASSWORD_FILE } from "./bootstrap.js";

const [cmd, ...args] = process.argv.slice(2);

function line(s = "") {
  process.stdout.write(`${s}\n`);
}

async function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
  }
  const answer = await rl.question(question);
  rl.close();
  if (hidden) line();
  return answer;
}

function revokeSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

switch (cmd) {
  case "init": {
    const pw = ensureAdmin();
    if (pw) {
      line("Administrator created.");
      line("  username: admin");
      line(`  password: ${pw}`);
    } else if (fs.existsSync(INITIAL_PASSWORD_FILE)) {
      line("Administrator already exists.");
      line("  username: admin");
      line(`  password: ${fs.readFileSync(INITIAL_PASSWORD_FILE, "utf8").trim()}`);
    } else {
      line("Administrator already exists. Use `boukarou reset-admin-password` if you lost the password.");
    }
    break;
  }
  case "reset-admin-password": {
    const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (!admin) {
      ensureAdmin();
      line("No administrator existed; one was created. Run this command again to get a fresh password.");
      break;
    }
    let password;
    if (args.includes("--prompt")) {
      password = await ask("New administrator password (10+ characters): ", { hidden: true });
      if (password.length < 10) {
        line("Too short. Nothing changed.");
        process.exitCode = 1;
        break;
      }
    } else password = generatePassword(20);
    db.prepare("UPDATE users SET password_hash = ?, disabled = 0, totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(
      hashPasswordSync(password),
      admin.id,
    );
    revokeSessions(admin.id);
    fs.rmSync(INITIAL_PASSWORD_FILE, { force: true });
    logEvent({ userId: admin.id, action: "admin.password_reset", message: "from the command line" });
    line("Administrator password reset. Two-factor sign-in was turned off and all sessions were signed out.");
    line(`  username: ${admin.username}`);
    if (!args.includes("--prompt")) line(`  password: ${password}`);
    break;
  }
  case "reset-password": {
    const username = (args[0] || (await ask("Username: "))).trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) {
      line("No such user.");
      process.exitCode = 1;
      break;
    }
    const password = generatePassword(16);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(
      hashPasswordSync(password),
      user.role === "admin" ? 0 : 1,
      user.id,
    );
    revokeSessions(user.id);
    line(`New password for ${user.username}: ${password}`);
    if (user.role !== "admin") line("They will be asked to choose their own at next sign-in.");
    break;
  }
  case "users": {
    for (const u of db.prepare("SELECT username, role, disabled FROM users ORDER BY id").all())
      line(`${u.username.padEnd(24)} ${u.role.padEnd(6)} ${u.disabled ? "disabled" : ""}`);
    break;
  }
  case "set-public-host": {
    const host = String(args[0] || "").trim();
    if (!/^[a-zA-Z0-9.:-]{2,253}$/.test(host)) {
      line("Usage: boukarou set-public-host <ip-or-hostname>");
      process.exitCode = 1;
      break;
    }
    setSetting("public_host", host);
    line(`Public address set to ${host}.`);
    break;
  }
  case "info": {
    line(`data directory : ${config.dataDir}`);
    line(`database       : ${config.dbFile}`);
    line(`LXD project    : ${config.project}`);
    line(`LXD network    : ${config.network}`);
    line(`storage pool   : ${config.pool}`);
    line(`listening on   : ${config.host}:${config.port}`);
    line(`public address : ${getSetting("public_host") || "(not set)"}`);
    break;
  }
  default:
    line("Usage: boukarou <command>");
    line("");
    line("  reset-admin-password [--prompt]  new administrator password (random, or typed with --prompt)");
    line("  reset-password <username>        new random password for a user");
    line("  users                            list accounts");
    line("  set-public-host <ip|host>        address shown in SSH commands and used for domains");
    line("  info                             paths and LXD settings");
    line("  doctor                           check the installation");
    line("  update                           pull the latest version and restart");
    line("  logs                             follow the service logs");
    line("  uninstall                        remove the panel (containers are kept)");
    process.exitCode = cmd ? 1 : 0;
}
