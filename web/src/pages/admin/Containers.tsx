import { useState } from "react";
import { t } from "../../lib/i18n";
import type { Instance } from "../../lib/types";
import { ErrorState, Loading, useApi } from "../../components/ui";
import { InstanceTable } from "../Containers";

export function AdminContainers() {
  const { data, error, loading, reload } = useApi<{ instances: Instance[] }>("/api/admin/instances", {
    poll: (d) => (d?.instances.some((i) => ["creating", "reinstalling", "deleting"].includes(i.status)) ? 3000 : 15000),
  });
  const [q, setQ] = useState("");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorState error={error} retry={reload} />;
  const needle = q.trim().toLowerCase();
  const items = needle
    ? data.instances.filter((i) => [i.name, i.owner?.username, i.ipv4, i.image.name, String(i.sshPort)].some((v) => v?.toLowerCase().includes(needle)))
    : data.instances;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("All containers")}</h1>
          <p>{t("Every container on this server. Open one to manage it as its owner would.")}</p>
        </div>
        <input className="input" style={{ width: 260 }} placeholder={t("Search name, owner, IP, port…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {items.length ? <InstanceTable items={items} showOwner /> : <div className="card card-pad muted">{t("No containers.")}</div>}
    </>
  );
}
