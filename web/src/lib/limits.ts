import type { LimitKey, Limits } from './types'

export const LIMIT_FIELDS: { key: LimitKey; label: string; unit: string; hint: string }[] = [
  { key: 'max_instances', label: 'Containers', unit: '', hint: 'How many containers they can have' },
  { key: 'max_cpu', label: 'vCPU', unit: '', hint: 'Total across all their containers' },
  { key: 'max_memory_mb', label: 'Memory', unit: 'MB', hint: 'Total across all their containers' },
  { key: 'max_disk_gb', label: 'Disk', unit: 'GB', hint: 'Total across all their containers' },
  { key: 'max_snapshots', label: 'Snapshots', unit: '', hint: 'Per container' },
  { key: 'traffic_gb', label: 'Monthly traffic', unit: 'GB', hint: 'Per container, in + out' },
  { key: 'max_domains', label: 'Domains', unit: '', hint: 'Total across all their containers' },
]

/** Limits as form text: an empty string means unlimited. */
export type LimitDraft = Record<LimitKey, string>

export const toDraft = (l: Partial<Limits>): LimitDraft =>
  Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, l[f.key] == null ? '' : String(l[f.key])])) as LimitDraft

export const fromDraft = (d: LimitDraft): Limits =>
  Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, d[f.key] === '' ? null : Number(d[f.key])])) as Limits
