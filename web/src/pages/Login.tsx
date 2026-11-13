import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { post } from "../lib/api";
import { getLang, setLang, t } from "../lib/i18n";
import { useSession } from "../lib/session";
import type { User } from "../lib/types";
import { Button, Field, Logo } from "../components/ui";

export function Login() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const done = (user: User) => {
    setUser(user);
    const next = params.get("next");
    navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (ticket) {
        const r = await post<{ user: User }>("/api/auth/2fa", { ticket, code });
        done(r.user);
      } else {
        const r = await post<{ user?: User; twoFactor?: boolean; ticket?: string }>("/api/auth/login", { username, password });
        if (r.twoFactor && r.ticket) setTicket(r.ticket);
        else if (r.user) done(r.user);
      }
    } catch (err) {
      setError((err as Error).message);
      if ((err as { code?: string }).code === "ticket_expired") setTicket(null);
    } finally {
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
          {ticket ? (
            <>
              <h1>{t("Two-factor code")}</h1>
              <p>{t("Enter the 6-digit code from your authenticator app.")}</p>
              <Field label={t("Code")} htmlFor="code">
                <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <h1>{t("Sign in")}</h1>
              <p>{t("Use the account your administrator gave you.")}</p>
              <Field label={t("Username")} htmlFor="username">
                <input id="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Field label={t("Password")} htmlFor="password">
                <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" variant="primary" loading={busy} style={{ width: "100%", marginTop: 18, height: 38 }} disabled={ticket ? code.trim().length < 6 : !username || !password}>
            {ticket ? t("Verify") : t("Sign in")}
          </Button>
          {ticket && (
            <Button variant="ghost" style={{ width: "100%", marginTop: 6 }} onClick={() => { setTicket(null); setCode(""); setError(""); }}>
              {t("Back")}
            </Button>
          )}
        </form>
        <div className="auth-foot">
          <span>{t("Forgot your password? Ask your administrator.")}</span>
        </div>
        <div className="auth-foot">
          <button type="button" onClick={() => setLang(getLang() === "fr" ? "en" : "fr")}>{getLang() === "fr" ? "English" : "Français"}</button>
        </div>
      </div>
    </div>
  );
}
