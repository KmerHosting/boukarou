import { t } from "../../lib/i18n";
import type { EventItem, Instance } from "../../lib/types";
import { Loading, useApi } from "../../components/ui";
import { EventRow } from "../../components/Events";

export function ActivityTab({ inst }: { inst: Instance }) {
  const { data, loading } = useApi<{ events: EventItem[] }>(`/api/instances/${inst.id}/events`, { poll: 15000 });
  if (loading && !data) return <Loading />;
  return (
    <section className="card">
      {data?.events.length ? data.events.map((e) => <EventRow key={e.id} e={e} />) : <div className="card-body muted">{t("Nothing yet.")}</div>}
    </section>
  );
}
