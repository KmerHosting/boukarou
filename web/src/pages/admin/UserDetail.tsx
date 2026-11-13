import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { del, patch, post } from "../../lib/api";
import { t } from "../../lib/i18n";
import { ago, date } from "../../lib/format";
import type { AdminUser, Instance } from "../../lib/types";
import { Button, ConfirmModal, ErrorState, Field, Loading, SecretModal, useApi, useToast } from "../../components/ui";
import { LimitsEditor, fromDraft, toDraft, type LimitDraft } from "../../components/LimitsEditor";
import { InstanceTable } from "../Containers";

export function AdminUser() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const users = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const all = useApi<{ instances: Instance[] }>("/api/admin/instances");
  const user = users.data?.users.find((u) => String(u.id) === uid);
  const [limits, setLimits] = useState<LimitDraft | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (user) {
      setLimits(toDraft(user.limits));
      setNote(user.note);
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (users.loading && !users.data) return <Loading />;
  if (!users.data) return <ErrorState error={users.error} retry={users.reload} />;
  if (!user) return <ErrorState error={null} />;
  const isAdmin = user.role === "admin";
  const theirs = (all.data?.instances || []).filter((i) => i.userId === user.id);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      users.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <div className="crumbs"><Link to="/admin/users">{t("Users")}</Link> <span>/</span> <span className="mono">{user.username}</span></div>
      <div className="page-head">
        <div>
          <h1 className="mono" style={{ fontWeight: 500 }}>{user.username}</h1>
          <p>
            {isAdmin ? t("Administrator") : t("User")} · {t("created {d}", { d: date(user.createdAt) })} · {t("last sign-in {d}", { d: ago(user.lastLoginAt) })}
            {user.disabled && <> · <span className="tag tag-bad">{t("Disabled")}</span></>}
          </p>
        </div>
        {!isAdmin && (
          <div className="btn-group">
            <Button onClick={() => act(async () => setPassword((await post<{ password: string }>(`/api/admin/users/${user.id}/reset-password`)).password), t("Password reset"))}>{t("Reset password")}</Button>
            {user.totpEnabled && <Button onClick={() => act(() => post(`/api/admin/users/${user.id}/reset-2fa`), t("Two-factor sign-in removed"))}>{t("Reset 2FA")}</Button>}
            <Button onClick={() => act(() => patch(`/api/admin/users/${user.id}`, { disabled: !user.disabled }), user.disabled ? t("Account enabled") : t("Account disabled"))}>
              {user.disabled ? t("Enable") : t("Disable")}
            </Button>
          </div>
        )}
      </div>

      <div className="stack">
        {isAdmin ? (
          <div className="info-box">{t("The administrator has no limits. Its password is reset on the server with: sudo boukarou reset-admin-password")}</div>
        ) : (
          <section className="card">
            <div className="card-head">
              <div>
                <h2>{t("Limits")}</h2>
                <p>{t("Lowering a limit never touches existing containers; it only blocks new ones and growth.")}</p>
              </div>
            </div>
            <div className="card-body">
              {limits && <LimitsEditor value={limits} onChange={setLimits} />}
              <div style={{ marginTop: 16 }}>
                <Field label={t("Note (only you see it)")} htmlFor="u-note">
                  <input id="u-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <div style={{ marginTop: 16 }}>
                <Button variant="primary" loading={saving} onClick={async () => {
                  setSaving(true);
                  await act(() => patch(`/api/admin/users/${user.id}`, { limits: fromDraft(limits!), note }), t("Saved"));
                  setSaving(false);
                }}>{t("Save changes")}</Button>
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 style={{ margin: "8px 0 12px" }}>{t("Containers")} <span className="muted" style={{ fontWeight: 400 }}>· {theirs.length}</span></h2>
          {theirs.length ? <InstanceTable items={theirs} /> : <div className="card card-pad muted">{t("No containers.")}</div>}
        </section>

        {!isAdmin && (
          <section className="card danger-zone">
            <div className="card-head">
              <div>
                <h2>{t("Delete user")}</h2>
                <p>{t("Deletes the account and all of its containers, snapshots and domains.")}</p>
              </div>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>{t("Delete…")}</Button>
            </div>
          </section>
        )}
      </div>

      {password && (
        <SecretModal
          title={t("New temporary password")}
          description={t("Give it to {u}. They will choose their own at next sign-in. All their sessions were signed out.", { u: user.username })}
          secret={password}
          onClose={() => setPassword(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t("Delete {u}?", { u: user.username })}
          description={theirs.length ? t("This also deletes {n} container(s) for good.", { n: theirs.length }) : t("The account is removed for good.")}
          word={user.username}
          action={t("Delete user")}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await del(`/api/admin/users/${user.id}`, { confirm: user.username });
            toast(t("{u} deleted", { u: user.username }));
            navigate("/admin/users");
          }}
        />
      )}
    </>
  );
}

