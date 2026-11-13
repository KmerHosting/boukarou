import { FormEvent, useState } from "react";
import { del, post } from "../../lib/api";
import { t } from "../../lib/i18n";
import { date } from "../../lib/format";
import { Button, ConfirmModal, Loading, useApi, useToast } from "../../components/ui";
import type { Detail } from "../Container";

type Snap = { name: string; createdAt: number; stateful: boolean };

export function SnapshotsTab({ d, reload }: { d: Detail; reload: () => void }) {
  const inst = d.instance;
  const toast = useToast();
  const list = useApi<{ snapshots: Snap[] }>(`/api/instances/${inst.id}/snapshots`);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<Snap | null>(null);
  const [remove, setRemove] = useState<Snap | null>(null);
  const snaps = list.data?.snapshots || [];
  const max = d.limits.maxSnapshots;
  const full = max != null && snaps.length >= max;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/api/instances/${inst.id}/snapshots`, { name: name.trim() || undefined });
      setName("");
      toast(t("Snapshot created"));
      list.reload();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{t("Take a snapshot")}</h2>
            <p>{t("A snapshot saves the whole disk as it is now. Restoring it rolls the container back.")}</p>
          </div>
          <span className="mono muted">{snaps.length} / {max == null ? "∞" : max}</span>
        </div>
        <form className="card-body input-row" onSubmit={create}>
          <input className="input mono" placeholder={t("Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} maxLength={63} disabled={full} />
          <Button type="submit" variant="primary" loading={busy} disabled={full}>{t("Take snapshot")}</Button>
        </form>
        {full && <div className="card-body" style={{ paddingTop: 0 }}><p className="hint">{t("You reached your snapshot limit for this container. Delete one to take another.")}</p></div>}
      </section>

      <section className="card">
        {list.loading && !list.data ? (
          <Loading />
        ) : snaps.length === 0 ? (
          <div className="card-body muted">{t("No snapshots yet.")}</div>
        ) : (
          [...snaps].sort((a, b) => b.createdAt - a.createdAt).map((s) => (
            <div key={s.name} className="list-row">
              <div>
                <div className="mono">{s.name}</div>
                <div className="hint">{date(s.createdAt)}</div>
              </div>
              <div className="btn-group">
                <Button size="sm" onClick={() => setRestore(s)}>{t("Restore")}</Button>
                <Button size="sm" variant="danger" onClick={() => setRemove(s)}>{t("Delete")}</Button>
              </div>
            </div>
          ))
        )}
      </section>

      {restore && (
        <ConfirmModal
          title={t("Restore {s}?", { s: restore.name })}
          description={t("Everything written since {d} is lost. The container restarts in the state it had then.", { d: date(restore.createdAt) })}
          action={t("Restore snapshot")}
          word={inst.name}
          onClose={() => setRestore(null)}
          onConfirm={async () => {
            await post(`/api/instances/${inst.id}/snapshots/${encodeURIComponent(restore.name)}/restore`);
            toast(t("Snapshot restored"));
            reload();
          }}
        />
      )}
      {remove && (
        <ConfirmModal
          title={t("Delete {s}?", { s: remove.name })}
          description={t("The snapshot is removed for good.")}
          action={t("Delete snapshot")}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await del(`/api/instances/${inst.id}/snapshots/${encodeURIComponent(remove.name)}`);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
