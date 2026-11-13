import { Link } from "react-router";
import { t } from "../../lib/i18n";
import { bytes, duration, memory } from "../../lib/format";
import type { EventItem } from "../../lib/types";
import { ErrorState, Loading, Meter, useApi } from "../../components/ui";
import { EventRow } from "../../components/Events";
import { ActivityIcon, ContainerIcon, CpuIcon, DiskIcon, MemoryIcon, NextIcon, SettingsIcon, UserPlusIcon } from "../../components/icons";

type Data = {
  host: { hostname: string; cpus: number; load: number[]; memTotal: number; memFree: number; uptime: number; platform: string };
  runtime: { ok: boolean; server?: string; version?: string; storageDriver?: string; error?: string };
  pool: { used: number; total: number } | null;
  project: string;
  network: string;
  counts: { total: number; running: number; stopped: number; failed: number; cpu: number; memory_mb: number; disk_gb: number; users: number };
  traffic: { rx: number; tx: number };
  settings: { publicHost: string };
  events: EventItem[];
  version: string;
};

export function AdminOverview() {
  const { data, error, loading, reload } = useApi<Data>("/api/admin/overview", { poll: 20000 });
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorState error={error} retry={reload} />;
  const { host, counts, runtime, pool } = data;
  const memUsed = host.memTotal - host.memFree;
  const warnings: React.ReactNode[] = [];
  if (!runtime.ok) warnings.push(<>{t("LXD is not reachable: {e}", { e: runtime.error || "" })}</>);
  if (!data.settings.publicHost)
    warnings.push(<>{t("Set the server's public address so users get a working SSH command and can add domains.")} <Link to="/admin/settings">{t("Open settings")}</Link></>);
  if (runtime.ok && runtime.storageDriver === "dir")
    warnings.push(<>{t("The storage pool uses the “dir” driver, which cannot enforce disk sizes. Use btrfs or ZFS for hard disk limits.")}</>);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Overview")}</h1>
          <p><span className="mono">{host.hostname}</span> · {host.platform} · {t("up {d}", { d: duration(host.uptime) })}</p>
        </div>
        <Link to="/admin/users" className="btn btn-primary"><UserPlusIcon size={16} />{t("New user")}</Link>
      </div>
      <div className="stack">
        {warnings.map((w, i) => <div key={i} className="warn-box">{w}</div>)}
        <div className="grid grid-4">
          <div className="card stat">
            <div className="k"><ContainerIcon size={16} />{t("Containers")}</div>
            <div className="v">{counts.total}</div>
            <div className="s">{t("{r} running · {s} stopped", { r: counts.running || 0, s: counts.stopped || 0 })}{counts.failed ? ` · ${t("{f} failed", { f: counts.failed })}` : ""}</div>
          </div>
          <div className="card stat">
            <div className="k"><CpuIcon size={16} />{t("CPU")}</div>
            <div className="v">{host.load[0].toFixed(2)}</div>
            <div className="s">{t("load on {n} cores · {a} vCPU allocated", { n: host.cpus, a: counts.cpu })}</div>
            <Meter value={host.load[0]} max={host.cpus} />
          </div>
          <div className="card stat">
            <div className="k"><MemoryIcon size={16} />{t("Memory")}</div>
            <div className="v">{bytes(memUsed)}</div>
            <div className="s">{t("of {t} · {a} allocated", { t: bytes(host.memTotal), a: memory(counts.memory_mb) })}</div>
            <Meter value={memUsed} max={host.memTotal} />
          </div>
          <div className="card stat">
            <div className="k"><DiskIcon size={16} />{t("Storage pool")}</div>
            <div className="v">{pool ? bytes(pool.used) : "—"}</div>
            <div className="s">{pool ? t("of {t} · {a} GB allocated", { t: bytes(pool.total), a: counts.disk_gb }) : t("unknown")}</div>
            {pool && <Meter value={pool.used} max={pool.total} />}
          </div>
        </div>

        <div className="grid grid-2">
          <section className="card">
            <div className="card-head"><h2 className="h-icon"><SettingsIcon size={18} />{t("Runtime")}</h2></div>
            <div className="card-body">
              <dl className="kv">
                <dt>{t("Engine")}</dt><dd>{runtime.ok ? `${runtime.server} ${runtime.version}` : <span style={{ color: "var(--bad)" }}>{t("unavailable")}</span>}</dd>
                <dt>{t("Storage driver")}</dt><dd className="mono">{runtime.storageDriver || "—"}</dd>
                <dt>{t("LXD project")}</dt><dd className="mono">{data.project}</dd>
                <dt>{t("Bridge")}</dt><dd className="mono">{data.network}</dd>
                <dt>{t("Public address")}</dt><dd className="mono">{data.settings.publicHost || "—"}</dd>
                <dt>{t("Users")}</dt><dd>{counts.users}</dd>
                <dt>{t("Traffic this month")}</dt><dd className="mono">↓ {bytes(data.traffic.rx)} · ↑ {bytes(data.traffic.tx)}</dd>
                <dt>{t("Version")}</dt><dd className="mono">Boukarou {data.version}</dd>
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="h-icon"><ActivityIcon size={18} />{t("Recent activity")}</h2>
              <Link to="/admin/activity" className="btn btn-sm btn-ghost">{t("All activity")}<NextIcon size={14} /></Link>
            </div>
            {data.events.length ? data.events.slice(0, 8).map((e) => <EventRow key={e.id} e={e} showUser />) : <div className="card-body muted">{t("Nothing yet.")}</div>}
          </section>
        </div>
      </div>
    </>
  );
}
