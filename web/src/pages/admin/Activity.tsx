import { useState } from "react";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { EventItem } from "../../lib/types";
import { Button, ErrorState, useApi } from "../../components/ui";
import { EventRow } from "../../components/Events";
import { RestoreIcon } from "../../components/icons";
import { RowsPageSkeleton } from "../../components/Skeleton";

export function AdminActivity() {
  const { data, error, loading, reload } = useApi<{ events: EventItem[] }>("/api/admin/events");
  const [more, setMore] = useState<EventItem[]>([]);
  const [end, setEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <RowsPageSkeleton />;
  if (!data) return <ErrorState error={error} retry={reload} />;
  const events = [...data.events, ...more];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Activity")}</h1>
          <p>{t("Sign-ins, container operations and admin changes. Kept for 180 days.")}</p>
        </div>
      </div>
      <section className="card">{events.length ? events.map((e) => <EventRow key={e.id} e={e} showUser />) : <div className="card-body muted">{t("Nothing yet.")}</div>}</section>
      {events.length >= 100 && !end && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <Button icon={<RestoreIcon size={16} />} loading={busy} onClick={async () => {
            setBusy(true);
            const r = await api<{ events: EventItem[] }>(`/api/admin/events?before=${events[events.length - 1].id}`);
            setMore((m) => [...m, ...r.events]);
            if (r.events.length < 100) setEnd(true);
            setBusy(false);
          }}>{t("Load older")}</Button>
        </div>
      )}
    </>
  );
}
