import { FormEvent, useState } from "react";
import QRCode from "qrcode";
import { post } from "../lib/api";
import { getLang, setLang, t } from "../lib/i18n";
import { setTheme, useTheme } from "../lib/theme";
import { useSession } from "../lib/session";
import { date } from "../lib/format";
import { Button, Field, Modal, useToast } from "../components/ui";
import { PasswordIcon, SaveIcon, ShieldCheckIcon, ShieldSlashIcon, SignOutIcon, TranslateIcon } from "../components/icons";

export function Account() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const theme = useTheme();
  if (!user) return null;
  const isAdmin = user.role === "admin";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Account & security")}</h1>
          <p>
            <span className="mono">{user.username}</span> · {isAdmin ? t("Administrator") : t("User")} · {t("Member since {d}", { d: date(user.createdAt) })}
          </p>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 760 }}>
        {isAdmin ? (
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="h-icon"><PasswordIcon size={18} />{t("Password")}</h2>
                <p>{t("For safety, the administrator password can only be changed on the server.")}</p>
              </div>
            </div>
            <div className="card-body">
              <div className="copy-line"><span>sudo boukarou reset-admin-password</span></div>
              <p className="hint" style={{ marginTop: 10 }}>{t("Add --prompt to type your own password instead of getting a random one.")}</p>
            </div>
          </section>
        ) : (
          <PasswordCard />
        )}

        <TwoFactorCard enabled={user.totpEnabled} onChange={refresh} />

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="h-icon"><SignOutIcon size={18} />{t("Sessions")}</h2>
              <p>{t("Sign out every other browser where your account is signed in.")}</p>
            </div>
            <Button icon={<SignOutIcon size={16} />} onClick={async () => {
              await post("/api/account/sessions/revoke");
              toast(t("Other sessions signed out"));
            }}>{t("Sign out others")}</Button>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2 className="h-icon"><TranslateIcon size={18} />{t("Preferences")}</h2></div>
          <div className="card-body grid grid-2">
            <Field label={t("Language")} htmlFor="lang">
              <select id="lang" className="select" value={getLang()} onChange={(e) => setLang(e.target.value as "en" | "fr")}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </Field>
            <Field label={t("Theme")} htmlFor="theme">
              <select id="theme" className="select" value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}>
                <option value="system">{t("System")}</option>
                <option value="light">{t("Light")}</option>
                <option value="dark">{t("Dark")}</option>
              </select>
            </Field>
          </div>
        </section>
      </div>
    </>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("The two passwords do not match."));
    setBusy(true);
    setError("");
    try {
      await post("/api/account/password", { current, password });
      setCurrent("");
      setPassword("");
      setConfirm("");
      toast(t("Password changed. Other sessions were signed out."));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head"><h2 className="h-icon"><PasswordIcon size={18} />{t("Password")}</h2></div>
      <form className="card-body" onSubmit={submit}>
        <div className="grid grid-3">
          <Field label={t("Current password")} htmlFor="pw-cur">
            <input id="pw-cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label={t("New password")} htmlFor="pw-new">
            <input id="pw-new" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("Repeat new password")} htmlFor="pw-rep">
            <input id="pw-rep" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>{t("At least 10 characters.")}</p>
        {error && <p className="form-error">{error}</p>}
        <div style={{ marginTop: 14 }}>
          <Button type="submit" variant="primary" icon={<SaveIcon size={16} />} loading={busy} disabled={!current || password.length < 10}>{t("Change password")}</Button>
        </div>
      </form>
    </section>
  );
}

function TwoFactorCard({ enabled, onChange }: { enabled: boolean; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [disable, setDisable] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    try {
      const r = await post<{ secret: string; uri: string }>("/api/account/2fa/setup");
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 200 }) });
      setCode("");
      setError("");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="h-icon">
            <ShieldCheckIcon size={18} />
            {t("Two-factor sign-in")} {enabled ? <span className="tag tag-ok">{t("On")}</span> : <span className="tag">{t("Off")}</span>}
          </h2>
          <p>{t("Ask for a code from an authenticator app (Aegis, Google Authenticator, 1Password…) after your password.")}</p>
        </div>
        {enabled ? (
          <Button variant="danger" icon={<ShieldSlashIcon size={16} />} onClick={() => { setDisable(true); setCode(""); setPassword(""); setError(""); }}>{t("Turn off")}</Button>
        ) : (
          <Button icon={<ShieldCheckIcon size={16} />} loading={busy} onClick={start}>{t("Turn on")}</Button>
        )}
      </div>

      {setup && (
        <Modal
          title={t("Set up two-factor sign-in")}
          description={t("Scan the code with your authenticator app, then enter the 6-digit code it shows.")}
          onClose={() => setSetup(null)}
          footer={
            <>
              <Button onClick={() => setSetup(null)}>{t("Cancel")}</Button>
              <Button variant="primary" loading={busy} disabled={code.trim().length < 6} onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await post("/api/account/2fa/enable", { code });
                  setSetup(null);
                  await onChange();
                  toast(t("Two-factor sign-in is on"));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>{t("Turn on")}</Button>
            </>
          }
        >
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <img src={setup.qr} width={160} height={160} alt={t("QR code")} style={{ borderRadius: 6, background: "#fff", padding: 6 }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <p className="hint">{t("Can't scan? Enter this key:")}</p>
              <p className="mono" style={{ wordBreak: "break-all", margin: "4px 0 14px" }}>{setup.secret}</p>
              <Field label={t("Code")} htmlFor="totp">
                <input id="totp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}

      {disable && (
        <Modal
          title={t("Turn off two-factor sign-in?")}
          description={t("Confirm with your password and a current code.")}
          onClose={() => setDisable(false)}
          footer={
            <>
              <Button onClick={() => setDisable(false)}>{t("Cancel")}</Button>
              <Button variant="danger-solid" loading={busy} disabled={!password || code.trim().length < 6} onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await post("/api/account/2fa/disable", { password, code });
                  setDisable(false);
                  await onChange();
                  toast(t("Two-factor sign-in is off"));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>{t("Turn off")}</Button>
            </>
          }
        >
          <Field label={t("Password")} htmlFor="d-pw">
            <input id="d-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("Code")} htmlFor="d-code">
            <input id="d-code" className="input mono" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
