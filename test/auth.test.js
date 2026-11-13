import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.BOUKAROU_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "boukarou-test-"));
const auth = await import("../server/auth.js");
const { hashPasswordSync } = await import("../server/password-sync.js");
const { translate } = await import("../server/i18n.js");

test("password hash round-trip, sync and async formats match", async () => {
  const h = await auth.hashPassword("correct horse battery");
  assert.ok(await auth.verifyPassword("correct horse battery", h));
  assert.ok(!(await auth.verifyPassword("wrong", h)));
  assert.ok(await auth.verifyPassword("from-cli-123", hashPasswordSync("from-cli-123")));
  assert.ok(!(await auth.verifyPassword("x", "garbage")));
});

test("generated passwords avoid look-alike characters", () => {
  for (let i = 0; i < 50; i++) {
    const p = auth.generatePassword(20);
    assert.equal(p.length, 20);
    assert.doesNotMatch(p, /[0O1lI]/);
  }
});

test("TOTP accepts the current code and rejects others", () => {
  const secret = auth.newTotpSecret();
  // compute the expected code independently
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
  assert.ok(auth.verifyTotp(secret, code));
  assert.ok(!auth.verifyTotp(secret, code === "000000" ? "111111" : "000000"));
  assert.ok(!auth.verifyTotp(secret, "abc"));
});

test("usernames", () => {
  assert.match("alice", auth.USERNAME_RE);
  assert.match("dev.team-1", auth.USERNAME_RE);
  assert.doesNotMatch("Al", auth.USERNAME_RE);
  assert.doesNotMatch("1abc", auth.USERNAME_RE);
});

test("French error messages, including templated ones", () => {
  assert.equal(translate("Wrong username or password.", "fr"), "Nom d’utilisateur ou mot de passe incorrect.");
  assert.equal(translate("This exceeds your vCPU limit (2 used of 2).", "fr"), "Cela dépasse votre limite de vCPU (2 utilisés sur 2).");
  assert.equal(translate("Wrong username or password.", "en"), "Wrong username or password.");
});
