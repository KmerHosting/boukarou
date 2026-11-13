import { t } from "../lib/i18n";
import { memory } from "../lib/format";
import type { Limits, Usage } from "../lib/types";
import { Meter } from "./ui";

export function QuotaStrip({ usage, limits }: { usage: Usage; limits: Limits }) {
  const items = [
    { label: t("Containers"), used: usage.instances, max: limits.max_instances, fmt: (n: number) => String(n) },
    { label: t("vCPU"), used: usage.cpu, max: limits.max_cpu, fmt: (n: number) => String(n) },
    { label: t("Memory"), used: usage.memoryMb, max: limits.max_memory_mb, fmt: memory },
    { label: t("Disk"), used: usage.diskGb, max: limits.max_disk_gb, fmt: (n: number) => `${n} GB` },
  ];
  return (
    <div className="card quota">
      {items.map((i) => (
        <div key={i.label}>
          <div className="q-top">
            <span>{i.label}</span>
            <b>
              {i.fmt(i.used)} <span className="faint">/ {i.max == null ? "∞" : i.fmt(i.max)}</span>
            </b>
          </div>
          {i.max == null ? <div className="meter" title={t("Unlimited")}><i style={{ width: 0 }} /></div> : <Meter value={i.used} max={i.max} />}
        </div>
      ))}
    </div>
  );
}
