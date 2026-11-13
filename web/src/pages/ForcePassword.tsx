import { FormEvent, useState } from "react";
import { post } from "../lib/api";
import { t } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Field, Logo } from "../components/ui";

export function ForcePassword() {
  const { user, refresh, setUser } = useSession();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("The two passwords do not match."));
    setBusy(true);
    setError("");
    try {
      await post("/api/account/password", { current, password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="brand">
          <Logo size={28} />
          <span>Boukarou</span>
        </div>
        <form className="card auth-card" onSubmit={submit}>
          <h1>{t("Choose your password")}</h1>
          <p>{t("Hi {u}. Replace the temporary password you were given with your own.", { u: user?.username || "" })}</p>
          <Field label={t("Temporary password")} htmlFor="cur">
            <input id="cur" className="input" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label={t("New password")} hint={t("At least 10 characters.")} htmlFor="new">
            <input id="new" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("Repeat new password")} htmlFor="rep">
            <input id="rep" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" variant="primary" loading={busy} style={{ width: "100%", marginTop: 18, height: 38 }} disabled={!current || password.length < 10}>
            {t("Save and continue")}
          </Button>
          <Button variant="ghost" style={{ width: "100%", marginTop: 6 }} onClick={async () => { await post("/api/auth/logout").catch(() => {}); setUser(null); }}>
            {t("Sign out")}
          </Button>
        </form>
      </div>
    </div>
  );
}
