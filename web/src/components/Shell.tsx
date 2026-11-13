import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { post } from "../lib/api";
import { getLang, setLang, t } from "../lib/i18n";
import { setTheme, useTheme } from "../lib/theme";
import { useSession } from "../lib/session";
import { Logo } from "./ui";
import { AccountIcon, ActivityIcon, CaretIcon, ContainerIcon, MoonIcon, OverviewIcon, SettingsIcon, ShieldCheckIcon, SignOutIcon, SunIcon, SystemThemeIcon, TranslateIcon, UsersIcon } from "./icons";

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
        { to: "/admin", label: t("Overview"), end: true, icon: <OverviewIcon size={17} /> },
        { to: "/admin/users", label: t("Users"), icon: <UsersIcon size={17} /> },
        { to: "/admin/containers", label: t("Containers"), icon: <ContainerIcon size={17} /> },
        { to: "/admin/activity", label: t("Activity"), icon: <ActivityIcon size={17} /> },
        { to: "/admin/settings", label: t("Settings"), icon: <SettingsIcon size={17} /> },
      ]
    : [
        { to: "/", label: t("Containers"), end: true, icon: <ContainerIcon size={17} /> },
        { to: "/account", label: t("Account"), icon: <AccountIcon size={17} /> },
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
                {l.icon}
                <span className="nav-label">{l.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            {user?.role === "admin" && (
              <Link className="chip-link hide-sm" to={admin ? "/" : "/admin"}>
                {admin ? <ContainerIcon size={15} /> : <ShieldCheckIcon size={15} />}
                {admin ? t("My containers") : t("Admin console")}
              </Link>
            )}
            <div className="menu" ref={menuRef}>
              <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
                <span className="mono">{user?.username}</span>
                <CaretIcon size={13} />
              </button>
              {open && (
                <div className="menu-pop" role="menu">
                  <div className="who">
                    <b>{user?.username}</b>
                    <span>{user?.role === "admin" ? t("Administrator") : t("User")}</span>
                  </div>
                  {user?.role === "admin" && (
                    <Link to={admin ? "/" : "/admin"} role="menuitem"><span className="mi">{admin ? <ContainerIcon size={16} /> : <ShieldCheckIcon size={16} />}{admin ? t("My containers") : t("Admin console")}</span></Link>
                  )}
                  <Link to="/account" role="menuitem"><span className="mi"><AccountIcon size={16} />{t("Account & security")}</span></Link>
                  <button role="menuitem" onClick={() => setTheme(nextTheme)}>
                    <span className="mi">{theme === "dark" ? <MoonIcon size={16} /> : theme === "light" ? <SunIcon size={16} /> : <SystemThemeIcon size={16} />}{t("Theme")}</span> <span className="muted">{themeLabel}</span>
                  </button>
                  <button role="menuitem" onClick={() => setLang(getLang() === "fr" ? "en" : "fr")}>
                    <span className="mi"><TranslateIcon size={16} />{t("Language")}</span> <span className="muted">{getLang() === "fr" ? "Français" : "English"}</span>
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
                    <span className="mi"><SignOutIcon size={16} />{t("Sign out")}</span>
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
