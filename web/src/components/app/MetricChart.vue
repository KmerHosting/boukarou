<script setup lang="ts" generic="T extends { at: number }">
import { CurveType } from '@unovis/ts'
import { VisArea, VisAxis, VisLine, VisXYContainer } from '@unovis/vue'
import { computed } from 'vue'
import { type ChartConfig, ChartContainer, ChartCrosshair, ChartTooltip } from '@/components/ui/chart'
import { lang } from '@/lib/i18n'

const props = defineProps<{
  data: T[]
  series: { key: keyof T & string; label: string; color: string }[]
  rangeMs: number
  max?: number
  format: (value: number) => string
}>()

const config = computed(() =>
  Object.fromEntries(props.series.map((s) => [s.key, { label: s.label, color: s.color }])) as ChartConfig,
)

const locale = () => (lang.value === 'fr' ? 'fr-FR' : 'en-GB')
const tick = (value: number) =>
  new Date(value).toLocaleString(locale(), props.rangeMs > 24 * 3600e3 ? { weekday: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
const full = (value: number | Date) =>
  new Date(value).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const accessors = computed(() => props.series.map((s) => (d: T) => Number(d[s.key])))
const colors = computed(() => props.series.map((s) => s.color))
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The tooltip: the time, then each series with its value in the chart's own unit. */
const tooltip = (d: T) => {
  const rows = props.series
    .map(
      (s) => `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
        <span style="display:flex;align-items:center;gap:6px;color:var(--muted-foreground)"><i style="width:8px;height:8px;border-radius:2px;background:${s.color}"></i>${escape(s.label)}</span>
        <span style="font-family:var(--font-mono,monospace);font-weight:500">${escape(props.format(Number(d[s.key])))}</span>
      </div>`,
    )
    .join('')
  return `<div style="display:grid;gap:6px;min-width:140px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--background);font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.12)">
    <div style="font-weight:500">${escape(full(d.at))}</div>${rows}</div>`
}
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-44 w-full" cursor>
    <VisXYContainer :data="data" :y-domain="max ? [0, max] : undefined" :margin="{ left: 4, right: 8, top: 6 }">
      <VisArea :x="(d: T) => d.at" :y="accessors" :color="colors" :opacity="0.12" :curve-type="CurveType.MonotoneX" />
      <VisLine :x="(d: T) => d.at" :y="accessors" :color="colors" :line-width="1.5" :curve-type="CurveType.MonotoneX" />
      <VisAxis type="x" :num-ticks="5" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="tick" />
      <VisAxis type="y" :num-ticks="3" :tick-line="false" :domain-line="false" :tick-format="(v: number) => format(v)" />
      <ChartTooltip />
      <ChartCrosshair :template="tooltip" :color="colors" />
    </VisXYContainer>
  </ChartContainer>
</template>
