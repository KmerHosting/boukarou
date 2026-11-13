import { useState } from "react";
import { useNavigate } from "react-router";
import { post } from "../../lib/api";
import { t } from "../../lib/i18n";
import { ago, memory } from "../../lib/format";
import type { AdminUser, Limits } from "../../lib/types";
import { Button, ErrorState, Field, Modal, SecretModal, useApi } from "../../components/ui";
import { LimitsEditor, fromDraft, toDraft, type LimitDraft } from "../../components/LimitsEditor";
import { UserPlusIcon } from "../../components/icons";
import { Skel, TablePageSkeleton } from "../../components/Skeleton";

const usageCell = (used: number, max: number | null, fmt: (n: number) => string = String) => (
  <span className="mono nowrap">{fmt(used)} <span className="faint">/ {max == null ? "∞" : fmt(max)}</span></span>
);

export function AdminUsers() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  if (loading && !data) return <TablePageSkeleton cols={6} />;
  if (!data) return <ErrorState error={error} retry={reload} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Users")}</h1>
          <p>{t("Everyone who can sign in, and the limits you give them. Everything is free; limits only protect your server.")}</p>
        </div>
        <Button variant="primary" icon={<UserPlusIcon size={16} />} onClick={() => setCreating(true)}>{t("New user")}</Button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Username")}</th>
              <th>{t("Containers")}</th>
              <th className="hide-sm">{t("vCPU")}</th>
              <th className="hide-sm">{t("Memory")}</th>
              <th className="hide-sm">{t("Disk")}</th>
              <th className="hide-sm">{t("Last sign-in")}</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => navigate(`/admin/users/${u.id}`)}>
                <td>
                  <span className="mono" style={{ fontWeight: 500 }}>{u.username}</span>{" "}
                  {u.role === "admin" && <span className="tag tag-accent">{t("Admin")}</span>}{" "}
                  {u.disabled && <span className="tag tag-bad">{t("Disabled")}</span>}{" "}
                  {u.mustChangePassword && <span className="tag">{t("Temporary password")}</span>}{" "}
                  {u.totpEnabled && <span className="tag tag-ok">2FA</span>}
                </td>
                <td>{usageCell(u.usage.instances, u.limits.max_instances)}</td>
                <td className="hide-sm">{usageCell(u.usage.cpu, u.limits.max_cpu)}</td>
                <td className="hide-sm">{usageCell(u.usage.memoryMb, u.limits.max_memory_mb, memory)}</td>
                <td className="hide-sm">{usageCell(u.usage.diskGb, u.limits.max_disk_gb, (n) => `${n} GB`)}</td>
                <td className="hide-sm muted">{ago(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(username, password) => {
            setCreating(false);
            setCreated({ username, password });
            reload();
          }}
        />
      )}
      {created && (
        <SecretModal
          title={t("{u} can sign in", { u: created.username })}
          description={t("Give them this temporary password. They will choose their own at first sign-in. It is not shown again.")}
          secret={created.password}
          onClose={() => setCreated(null)}
        />
      )}
    </>
  );
}

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (u: string, p: string) => void }) {
  const defaults = useApi<{ settings: Record<string, string> }>("/api/admin/settings");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [limits, setLimits] = useState<LimitDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const s = defaults.data?.settings;
  const draft =
    limits ??
    (s
      ? toDraft(Object.fromEntries(
          ["max_instances", "max_cpu", "max_memory_mb", "max_disk_gb", "max_snapshots", "traffic_gb", "max_domains"].map((k) => [k, s[`default_${k}`] === "" ? null : Number(s[`default_${k}`])]),
        ) as Partial<Limits>)
      : null);

  return (
    <Modal
      wide
      title={t("New user")}
      description={t("Limits start from the defaults in Settings. Leave a field on Unlimited to allow any amount.")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" icon={<UserPlusIcon size={16} />} loading={busy} disabled={!username || !draft} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await post<{ user: AdminUser; password: string }>("/api/admin/users", { username, password: password || undefined, note, limits: fromDraft(draft!) });
              onCreated(r.user.username, r.password);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}>{t("Create user")}</Button>
        </>
      }
    >
      <div className="grid grid-2">
        <Field label={t("Username")} hint={t("Lowercase, 3–32 characters.")} htmlFor="nu-name">
          <input id="nu-name" className="input mono" autoFocus autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
        </Field>
        <Field label={t("Temporary password")} hint={t("Leave empty to generate one.")} htmlFor="nu-pw">
          <input id="nu-pw" className="input mono" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label={t("Note (only you see it)")} htmlFor="nu-note">
          <input id="nu-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <h3 style={{ margin: "20px 0 12px" }}>{t("Limits")}</h3>
      {draft ? <LimitsEditor value={draft} onChange={setLimits} /> : <div style={{ display: "grid", gap: 12 }}><Skel h={36} r={6} /><Skel h={36} r={6} /><Skel h={36} r={6} /></div>}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
