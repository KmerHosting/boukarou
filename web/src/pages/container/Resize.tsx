import { useState } from "react";
import { post } from "../../lib/api";
import { t } from "../../lib/i18n";
import { memory } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { Limits, Usage } from "../../lib/types";
import { Button, Field, Stepper, useApi, useToast } from "../../components/ui";
import type { Detail } from "../Container";
import { CheckIcon, ResizeIcon, RetryIcon } from "../../components/icons";

export function ResizeTab({ d, reload }: { d: Detail; reload: () => void }) {
  const inst = d.instance;
  const toast = useToast();
  const { user } = useSession();
  const own = inst.userId === user?.id;
  // Remaining room comes from the owner's limits; admins resizing someone else's container are checked server-side.
  const ov = useApi<{ usage: Usage; limits: Limits }>(own ? "/api/overview" : null);
  const [cpu, setCpu] = useState(inst.cpu);
  const [mem, setMem] = useState(inst.memoryMb);
  const [disk, setDisk] = useState(inst.diskGb);
  const [busy, setBusy] = useState(false);

  const room = (limit: number | null | undefined, used: number | undefined, current: number) =>
    limit == null || used == null ? null : limit - used + current;
  const maxCpu = own ? room(ov.data?.limits.max_cpu, ov.data?.usage.cpu, inst.cpu) : null;
  const maxMem = own ? room(ov.data?.limits.max_memory_mb, ov.data?.usage.memoryMb, inst.memoryMb) : null;
  const maxDisk = own ? room(ov.data?.limits.max_disk_gb, ov.data?.usage.diskGb, inst.diskGb) : null;
  const changed = cpu !== inst.cpu || mem !== inst.memoryMb || disk !== inst.diskGb;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="h-icon"><ResizeIcon size={18} />{t("Resize")}</h2>
          <p>{t("CPU and memory change live, without a restart. Disk can only grow.")}</p>
        </div>
      </div>
      <div className="card-body">
        <div className="res-grid">
          <Field label={t("vCPU")} hint={maxCpu != null ? t("Up to {n}", { n: maxCpu }) : t("No limit")}>
            <Stepper label={t("vCPU")} value={cpu} onChange={setCpu} min={1} max={maxCpu} />
          </Field>
          <Field label={t("Memory (MB)")} hint={maxMem != null ? t("Up to {n}", { n: memory(maxMem) }) : t("No limit")}>
            <Stepper label={t("Memory (MB)")} value={mem} onChange={setMem} min={128} step={256} max={maxMem} />
          </Field>
          <Field label={t("Disk (GB)")} hint={maxDisk != null ? t("Up to {n} GB", { n: maxDisk }) : t("No limit")}>
            <Stepper label={t("Disk (GB)")} value={disk} onChange={setDisk} min={inst.diskGb} step={5} max={maxDisk} />
          </Field>
        </div>
        {!d.diskQuotaEnforced && <p className="hint" style={{ marginTop: 12 }}>{t("This server's storage does not enforce disk sizes. The size is recorded but not applied.")}</p>}
        <div className="btn-group" style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<CheckIcon size={16} weight="bold" />} disabled={!changed} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await post(`/api/instances/${inst.id}/resize`, { cpu, memoryMb: mem, diskGb: disk });
              toast(t("Resources updated"));
              reload();
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}>{t("Apply")}</Button>
          {changed && <Button variant="ghost" icon={<RetryIcon size={16} />} onClick={() => { setCpu(inst.cpu); setMem(inst.memoryMb); setDisk(inst.diskGb); }}>{t("Reset")}</Button>}
        </div>
      </div>
    </section>
  );
}
