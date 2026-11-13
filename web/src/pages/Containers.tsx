import { Link, useNavigate } from "react-router";
import { t } from "../lib/i18n";
import { memory } from "../lib/format";
import type { Instance, Limits, Usage } from "../lib/types";
import { ErrorState, Loading, Logo, OsTile, StatusBadge, useApi } from "../components/ui";
import { QuotaStrip } from "../components/Quota";
import { PlusIcon } from "../components/icons";

type Overview = { instances: Instance[]; usage: Usage; limits: Limits };

const transitional = (i: Instance) => ["creating", "reinstalling", "deleting"].includes(i.status) || !!i.busy;

export function sshLine(i: Instance) {
  return i.sshPort ? `ssh root@${i.sshHost || location.hostname} -p ${i.sshPort}` : "";
}

export function InstanceTable({ items, showOwner }: { items: Instance[]; showOwner?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Name")}</th>
            {showOwner && <th>{t("Owner")}</th>}
            <th>{t("Status")}</th>
            <th className="hide-sm">{t("Private IPv4")}</th>
            <th className="hide-sm">{t("SSH")}</th>
            <th className="num">{t("vCPU")}</th>
            <th className="num">{t("Memory")}</th>
            <th className="num hide-sm">{t("Disk")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => navigate(`/c/${i.id}`)}>
              <td>
                <div className="cell-main">
                  <OsTile family={i.image.family} />
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/c/${i.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
                      <strong className="mono">{i.name}</strong>
                    </Link>
                    <small>{i.image.name} {i.image.version}</small>
                  </div>
                </div>
              </td>
              {showOwner && <td className="mono">{i.owner?.username}</td>}
              <td>
                <StatusBadge status={i.status} busy={i.busy} />
                {i.trafficBlocked && <span className="tag tag-bad" style={{ marginLeft: 8 }}>{t("Traffic limited")}</span>}
              </td>
              <td className="mono hide-sm">{i.ipv4 || <span className="faint">—</span>}</td>
              <td className="mono hide-sm">{i.sshPort ? `:${i.sshPort}` : <span className="faint">—</span>}</td>
              <td className="num mono">{i.cpu}</td>
              <td className="num mono nowrap">{memory(i.memoryMb)}</td>
              <td className="num mono nowrap hide-sm">{i.diskGb} GB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Containers() {
  const { data, error, loading, reload } = useApi<Overview>("/api/overview", {
    poll: (d) => (d?.instances.some(transitional) ? 3000 : 15000),
  });
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorState error={error} retry={reload} />;
  const full = data.limits.max_instances != null && data.usage.instances >= data.limits.max_instances;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Containers")}</h1>
          <p>{t("Linux containers running on this server.")}</p>
        </div>
        {full ? (
          <span className="tag tag-warn" title={t("Delete a container or ask your administrator for a higher limit.")}>{t("Container limit reached")}</span>
        ) : (
          <Link to="/new" className="btn btn-primary"><PlusIcon size={16} weight="bold" />{t("New container")}</Link>
        )}
      </div>
      <div className="stack">
        <QuotaStrip usage={data.usage} limits={data.limits} />
        {data.instances.length ? (
          <InstanceTable items={data.instances} />
        ) : (
          <div className="card empty">
            <div className="empty-art"><Logo size={88} /></div>
            <h2>{t("No containers yet")}</h2>
            <p>{t("Create your first container. It takes about a minute.")}</p>
            {!full && <Link to="/new" className="btn btn-primary"><PlusIcon size={16} weight="bold" />{t("New container")}</Link>}
          </div>
        )}
      </div>
    </>
  );
}
