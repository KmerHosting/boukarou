import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { del, post } from "../lib/api";
import { t } from "../lib/i18n";
import { ago, memory } from "../lib/format";
import { useSession } from "../lib/session";
import type { Instance } from "../lib/types";
import { Button, ConfirmModal, ErrorState, Loading, OsTile, SecretModal, StatusBadge, useApi, useToast } from "../components/ui";
import { OverviewTab } from "./container/Overview";
import { ConsoleTab } from "./container/Console";
import { SnapshotsTab } from "./container/Snapshots";
import { DomainsTab } from "./container/Domains";
import { ResizeTab } from "./container/Resize";
import { SettingsTab } from "./container/Settings";
import { ActivityTab } from "./container/Activity";
import { ActivityIcon, ConsoleIcon, DomainIcon, FreezeIcon, OverviewIcon, ReinstallIcon, ResizeIcon, RestartIcon, RetryIcon, SettingsIcon, SnapshotIcon, StartIcon, StopIcon, SunIcon, TrashIcon } from "../components/icons";

export type Detail = {
  instance: Instance;
  live: { status: string; memUsed: number; processes: number; ipv4: string | null; ipv6: string | null } | null;
  traffic: { period: string; rx: number; tx: number; quotaGb: number | null };
  limits: { maxSnapshots: number | null };
  diskQuotaEnforced: boolean;
};

const STEPS = [
  ["queued", "Waiting in queue"],
  ["image", "Downloading and unpacking the image"],
  ["configure", "Applying resources and network"],
  ["start", "Booting"],
  ["network", "Waiting for the network"],
  ["ssh", "Installing and configuring SSH"],
  ["credentials", "Setting the root password"],
];

const transitional = (i?: Instance) => !!i && (["creating", "reinstalling", "deleting"].includes(i.status) || !!i.busy);

export function ContainerPage() {
  const { id, tab = "overview" } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/instances/${id}`, {
    poll: (d) => (transitional(d?.instance) ? 2500 : 10000),
  });
  const [password, setPassword] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const asked = useRef(false);

  const inst = data?.instance;
  const mine = inst && user && inst.userId === user.id;

  // Reveal the generated root password exactly once.
  useEffect(() => {
    if (!inst || !mine || !inst.passwordPending || inst.status !== "running" || asked.current) return;
    asked.current = true;
    post<{ password: string | null }>(`/api/instances/${inst.id}/initial-password`)
      .then((r) => r.password && setPassword(r.password))
      .catch(() => undefined);
  }, [inst, mine]);
  useEffect(() => {
    if (inst?.status === "reinstalling") asked.current = false;
  }, [inst?.status]);

  if (loading && !data) return <Loading />;
  if (!data || !inst) return <ErrorState error={error} retry={reload} />;

  async function action(name: string) {
    setPending(name);
    try {
      await post(`/api/instances/${id}/actions`, { action: name });
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending(null);
    }
  }

  const status = inst.status;
  const busy = transitional(inst) || !!pending;
  const ready = !["creating", "deleting"].includes(status);
  const tabs = [
    ["overview", t("Overview"), <OverviewIcon key="i" size={16} />],
    ["console", t("Console"), <ConsoleIcon key="i" size={16} />],
    ["snapshots", t("Snapshots"), <SnapshotIcon key="i" size={16} />],
    ["domains", t("Domains"), <DomainIcon key="i" size={16} />],
    ["resize", t("Resize"), <ResizeIcon key="i" size={16} />],
    ["settings", t("Settings"), <SettingsIcon key="i" size={16} />],
    ["activity", t("Activity"), <ActivityIcon key="i" size={16} />],
  ] as const;

  return (
    <>
      <div className="crumbs">
        <Link to={user?.role === "admin" && !mine ? "/admin/containers" : "/"}>{t("Containers")}</Link> <span>/</span> <span className="mono">{inst.name}</span>
      </div>
      <div className="inst-head">
        <OsTile family={inst.image.family} large />
        <div>
          <h1>{inst.name}</h1>
          <div className="meta">
            <StatusBadge status={status} busy={inst.busy} />
            <span>{inst.image.name} {inst.image.version}</span>
            <span className="mono">{inst.cpu} vCPU · {memory(inst.memoryMb)} · {inst.diskGb} GB</span>
            {inst.owner && !mine && <span>{t("Owner")}: <Link to={`/admin/users/${inst.owner.id}`} className="mono">{inst.owner.username}</Link></span>}
            {inst.trafficBlocked && <span className="tag tag-bad">{t("Traffic limited")}</span>}
          </div>
        </div>
        {ready && status !== "failed" && (
          <div className="actions btn-group">
            {status === "stopped" && <Button variant="primary" icon={<StartIcon size={16} weight="fill" />} loading={pending === "start"} disabled={busy} onClick={() => action("start")}>{t("Start")}</Button>}
            {status === "frozen" && <Button variant="primary" icon={<SunIcon size={16} />} loading={pending === "unfreeze"} disabled={busy} onClick={() => action("unfreeze")}>{t("Unfreeze")}</Button>}
            {status === "running" && (
              <>
                <Button icon={<ConsoleIcon size={16} />} onClick={() => navigate(`/c/${inst.id}/console`)}>{t("Console")}</Button>
                <Button icon={<RestartIcon size={16} />} loading={pending === "restart"} disabled={busy} onClick={() => action("restart")}>{t("Restart")}</Button>
                <Button icon={<FreezeIcon size={16} />} loading={pending === "freeze"} disabled={busy} onClick={() => action("freeze")} title={t("Pause every process without shutting down")}>{t("Freeze")}</Button>
              </>
            )}
            {(status === "running" || status === "frozen") && (
              <Button icon={<StopIcon size={16} weight="fill" />} loading={pending === "stop"} disabled={busy} onClick={() => action("stop")}>{t("Stop")}</Button>
            )}
          </div>
        )}
      </div>

      {(status === "creating" || status === "reinstalling") && <Progress inst={inst} />}

      {status === "failed" && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 8 }}>{t("Something went wrong")}</h2>
          <div className="error-box mono" style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{inst.error || t("Unknown error")}</div>
          <div className="btn-group" style={{ marginTop: 14 }}>
            <Button variant="primary" icon={<RetryIcon size={16} />} disabled={!!inst.busy} onClick={async () => {
              try {
                await post(`/api/instances/${inst.id}/retry`);
                reload();
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}>{t("Try again")}</Button>
            <Button icon={<ReinstallIcon size={16} />} onClick={() => navigate(`/c/${inst.id}/settings`)}>{t("Reinstall")}</Button>
            <Button variant="danger" icon={<TrashIcon size={16} />} onClick={() => setConfirmDelete(true)}>{t("Delete")}</Button>
          </div>
        </div>
      )}

      {status === "deleting" && <div className="info-box" style={{ marginBottom: 20 }}>{t("Deleting this container…")}</div>}

      {ready && status !== "creating" && (
        <>
          <nav className="tabs" aria-label={t("Container sections")}>
            {tabs.map(([key, label, icon]) => (
              <NavLink key={key} to={key === "overview" ? `/c/${inst.id}` : `/c/${inst.id}/${key}`} end className={() => (tab === key ? "active" : "")}>
                {icon}
                {label}
              </NavLink>
            ))}
          </nav>
          {tab === "overview" && <OverviewTab d={data} />}
          {tab === "console" && <ConsoleTab inst={inst} />}
          {tab === "snapshots" && <SnapshotsTab d={data} reload={reload} />}
          {tab === "domains" && <DomainsTab inst={inst} />}
          {tab === "resize" && <ResizeTab d={data} reload={reload} />}
          {tab === "settings" && <SettingsTab d={data} reload={reload} onPassword={setPassword} />}
          {tab === "activity" && <ActivityTab inst={inst} />}
        </>
      )}

      <p className="faint" style={{ fontSize: 12, marginTop: 24 }}>{t("Created {t}", { t: ago(inst.createdAt) })}</p>

      {password && (
        <SecretModal
          title={t("Root password")}
          description={t("This password is shown only once. Save it in your password manager now.")}
          secret={password}
          onClose={() => setPassword(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t("Delete {n}?", { n: inst.name })}
          description={t("The container, its snapshots and its domains are removed for good.")}
          word={inst.name}
          action={t("Delete container")}
          icon={<TrashIcon size={16} />}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await del(`/api/instances/${inst.id}`, { confirm: inst.name });
            toast(t("{n} deleted", { n: inst.name }));
            navigate("/");
          }}
        />
      )}
    </>
  );
}

function Progress({ inst }: { inst: Instance }) {
  const steps = inst.status === "reinstalling" ? STEPS.filter(([k]) => k !== "queued" && k !== "configure") : STEPS;
  const idx = Math.max(0, steps.findIndex(([k]) => k === inst.progress));
  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h2>{inst.status === "reinstalling" ? t("Reinstalling {n}", { n: inst.name }) : t("Creating {n}", { n: inst.name })}</h2>
      <p className="muted" style={{ marginTop: 4 }}>{t("You can leave this page. The container keeps building in the background.")}</p>
      <div className="steps">
        {steps.map(([key, label], i) => (
          <div key={key} className={`step${i < idx ? " done" : i === idx ? " now" : ""}`}>
            <span className="dot">{i < idx && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2 4.2 7.4 8 3" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>}</span>
            {t(label)}
          </div>
        ))}
      </div>
    </div>
  );
}
