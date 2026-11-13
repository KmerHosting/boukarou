import { t } from "../lib/i18n";
import type { Limits } from "../lib/types";

export const LIMIT_FIELDS: { key: keyof Limits; label: string; unit: string; hint: string }[] = [
  { key: "max_instances", label: "Containers", unit: "", hint: "How many containers they can have" },
  { key: "max_cpu", label: "vCPU", unit: "", hint: "Total across all their containers" },
  { key: "max_memory_mb", label: "Memory", unit: "MB", hint: "Total across all their containers" },
  { key: "max_disk_gb", label: "Disk", unit: "GB", hint: "Total across all their containers" },
  { key: "max_snapshots", label: "Snapshots", unit: "", hint: "Per container" },
  { key: "traffic_gb", label: "Monthly traffic", unit: "GB", hint: "Per container, in + out" },
  { key: "max_domains", label: "Domains", unit: "", hint: "Total across all their containers" },
];

export type LimitDraft = Record<keyof Limits, string>; // "" = unlimited

export const toDraft = (l: Partial<Limits>): LimitDraft =>
  Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, l[f.key] == null ? "" : String(l[f.key])])) as LimitDraft;
export const fromDraft = (d: LimitDraft) =>
  Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, d[f.key] === "" ? null : Number(d[f.key])])) as Limits;

export function LimitsEditor({ value, onChange }: { value: LimitDraft; onChange: (v: LimitDraft) => void }) {
  return (
    <div className="grid grid-2" style={{ gap: "14px 20px" }}>
      {LIMIT_FIELDS.map((f) => {
        const unlimited = value[f.key] === "";
        return (
          <div key={f.key} className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="label" htmlFor={`lim-${f.key}`}>{t(f.label)}{f.unit && <span className="faint"> ({f.unit})</span>}</label>
              <label className="check" style={{ fontSize: 12.5 }}>
                <input type="checkbox" checked={unlimited} onChange={(e) => onChange({ ...value, [f.key]: e.target.checked ? "" : "0" })} />
                {t("Unlimited")}
              </label>
            </div>
            <input
              id={`lim-${f.key}`}
              className="input mono"
              inputMode="numeric"
              disabled={unlimited}
              placeholder="∞"
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value.replace(/\D/g, "") })}
            />
            <div className="hint">{t(f.hint)}</div>
          </div>
        );
      })}
    </div>
  );
}
