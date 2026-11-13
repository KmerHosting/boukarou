import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { api, onAuthError } from "./lib/api";
import { SessionCtx } from "./lib/session";
import { useLang } from "./lib/i18n";
import type { User } from "./lib/types";
import { Loading } from "./components/ui";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { ForcePassword } from "./pages/ForcePassword";
import { Containers } from "./pages/Containers";
import { NewContainer } from "./pages/NewContainer";
import { ContainerPage } from "./pages/Container";
import { Account } from "./pages/Account";
import { AdminOverview } from "./pages/admin/Overview";
import { AdminUsers } from "./pages/admin/Users";
import { AdminUser } from "./pages/admin/UserDetail";
import { AdminContainers } from "./pages/admin/Containers";
import { AdminActivity } from "./pages/admin/Activity";
import { AdminSettings } from "./pages/admin/Settings";

export function App() {
  useLang(); // re-render everything on language change
  const [user, setUser] = useState<User | null>(null);
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const location = useLocation();

  const refresh = useCallback(async () => {
    const me = await api<{ user: User | null; version: string }>("/api/auth/me").catch(() => ({ user: null, version: "" }));
    setUser(me.user);
    setVersion(me.version);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onAuthError((e) => {
        if (e.status === 401) setUser(null);
        else if (e.code === "must_change_password") refresh();
      }),
    [refresh],
  );

  if (!ready) return <Loading />;

  const session = { user, version, refresh, setUser };
  const next = encodeURIComponent(location.pathname + location.search);

  if (!user) {
    return (
      <SessionCtx.Provider value={session}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to={location.pathname === "/" ? "/login" : `/login?next=${next}`} replace />} />
        </Routes>
      </SessionCtx.Provider>
    );
  }

  if (user.mustChangePassword) {
    return (
      <SessionCtx.Provider value={session}>
        <ForcePassword />
      </SessionCtx.Provider>
    );
  }

  const isAdmin = user.role === "admin";
  return (
    <SessionCtx.Provider value={session}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Shell area="app" />}>
          <Route index element={<Containers />} />
          <Route path="new" element={<NewContainer />} />
          <Route path="c/:id/:tab?" element={<ContainerPage />} />
          <Route path="account" element={<Account />} />
        </Route>
        {isAdmin ? (
          <Route path="admin" element={<Shell area="admin" />}>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:uid" element={<AdminUser />} />
            <Route path="containers" element={<AdminContainers />} />
            <Route path="activity" element={<AdminActivity />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        ) : (
          <Route path="admin/*" element={<Navigate to="/" replace />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionCtx.Provider>
  );
}
