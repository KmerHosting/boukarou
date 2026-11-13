import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { post } from "../lib/api";
import { getLang, setLang, t } from "../lib/i18n";
import { setTheme, useTheme } from "../lib/theme";
import { useSession } from "../lib/session";
import { Logo } from "./ui";

export function Shell({ area }: { area: "app" | "admin" }) {
  const { user, version, setUser } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const admin = area === "admin";
  const links = admin
    ? [
        { to: "/admin", label: t("Overview"), end: true },
        { to: "/admin/users", label: t("Users") },
        { to: "/admin/containers", label: t("Containers") },
        { to: "/admin/activity", label: t("Activity") },
        { to: "/admin/settings", label: t("Settings") },
      ]
    : [
        { to: "/", label: t("Containers"), end: true },
        { to: "/account", label: t("Account") },
      ];

  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const themeLabel = theme === "light" ? t("Light") : theme === "dark" ? t("Dark") : t("System");

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to={admin ? "/admin" : "/"} className="brand">
            <Logo />
            <span className="full">Boukarou</span>
            {admin && <small>{t("Admin")}</small>}
          </Link>
          <nav className="nav" aria-label={t("Main")}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => {
                const containerDetail = !admin && l.to === "/" && /^\/(c\/|new)/.test(location.pathname);
                return isActive || containerDetail ? "active" : "";
              }}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            {user?.role === "admin" && (
              <Link className="chip-link hide-sm" to={admin ? "/" : "/admin"}>
                {admin ? t("My containers") : t("Admin console")}
              </Link>
            )}
            <div className="menu" ref={menuRef}>
              <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
                <span className="mono">{user?.username}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
              {open && (
                <div className="menu-pop" role="menu">
                  <div className="who">
                    <b>{user?.username}</b>
                    <span>{user?.role === "admin" ? t("Administrator") : t("User")}</span>
                  </div>
                  {user?.role === "admin" && (
                    <Link to={admin ? "/" : "/admin"} role="menuitem">{admin ? t("My containers") : t("Admin console")}</Link>
                  )}
                  <Link to="/account" role="menuitem">{t("Account & security")}</Link>
                  <button role="menuitem" onClick={() => setTheme(nextTheme)}>
                    {t("Theme")} <span className="muted">{themeLabel}</span>
                  </button>
                  <button role="menuitem" onClick={() => setLang(getLang() === "fr" ? "en" : "fr")}>
                    {t("Language")} <span className="muted">{getLang() === "fr" ? "Français" : "English"}</span>
                  </button>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={async () => {
                      await post("/api/auth/logout").catch(() => undefined);
                      setUser(null);
                      navigate("/login");
                    }}
                  >
                    {t("Sign out")}
                  </button>
                  <div className="faint" style={{ fontSize: 11.5, padding: "6px 10px 2px" }}>Boukarou {version}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
