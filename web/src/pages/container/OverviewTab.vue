<script setup lang="ts">
import { ActivityIcon, ChartLineIcon, GlobeIcon, KeyRoundIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import CopyLine from '@/components/app/CopyLine.vue'
import MetricChart from '@/components/app/MetricChart.vue'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useResource } from '@/composables/useResource'
import { bytes, memory, rate } from '@/lib/format'
import { t } from '@/lib/i18n'
import { sshLine } from '@/lib/ssh'
import type { Detail, Point } from '@/lib/types'

const props = defineProps<{ d: Detail }>()
const RANGES: Record<string, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 }
const range = ref('1h')
const inst = computed(() => props.d.instance)
const metrics = useResource<{ points: Point[] }>(() => `/api/instances/${inst.value.id}/metrics?range=${range.value}`, 60_000)
const points = computed(() => metrics.data.value?.points ?? [])
const last = computed(() => points.value[points.value.length - 1])
const ssh = computed(() => sshLine(inst.value))
const quotaBytes = computed(() => (props.d.traffic.quotaGb != null ? props.d.traffic.quotaGb * 1e9 : null))
const used = computed(() => props.d.traffic.rx + props.d.traffic.tx)
const pct = (n: number) => `${Math.round(n)}%`
</script>

<template>
  <div class="grid gap-5 md:grid-cols-2">
    <Card>
      <CardHeader><CardTitle class="flex items-center gap-2"><KeyRoundIcon class="size-4" /> {{ t('Connect') }}</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-4">
        <CopyLine v-if="ssh" :text="ssh" />
        <p v-else class="text-muted-foreground text-sm">{{ t('SSH is not configured for this container.') }}</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt class="text-muted-foreground">{{ t('User') }}</dt><dd class="font-mono">root</dd>
          <dt class="text-muted-foreground">{{ t('SSH port') }}</dt><dd class="font-mono">{{ inst.sshPort ?? '-' }}</dd>
          <dt class="text-muted-foreground">{{ t('Private IPv4') }}</dt><dd class="font-mono">{{ d.live?.ipv4 || inst.ipv4 || '-' }}</dd>
          <dt class="text-muted-foreground">{{ t('IPv6') }}</dt><dd class="font-mono break-all">{{ d.live?.ipv6 || inst.ipv6 || '-' }}</dd>
          <dt class="text-muted-foreground">{{ t('Sign-in') }}</dt><dd>{{ inst.hasSshKey ? t('Password or SSH key') : t('Password') }}</dd>
        </dl>
        <p v-if="!inst.sshHost" class="text-muted-foreground text-xs">
          {{ t("The administrator has not set the server's public address, so the command uses this page's address.") }}
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="flex items-center gap-2"><ActivityIcon class="size-4" /> {{ t('Now') }}</CardTitle></CardHeader>
      <CardContent>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt class="text-muted-foreground">{{ t('CPU') }}</dt>
          <dd class="font-mono">{{ last ? `${last.cpu}%` : '-' }} <span class="text-muted-foreground">{{ t('of {n} vCPU', { n: inst.cpu }) }}</span></dd>
          <dt class="text-muted-foreground">{{ t('Memory') }}</dt>
          <dd class="font-mono">{{ d.live ? bytes(d.live.memUsed) : '-' }} <span class="text-muted-foreground">/ {{ memory(inst.memoryMb) }}</span></dd>
          <dt class="text-muted-foreground">{{ t('Disk used') }}</dt>
          <dd class="font-mono">{{ last ? bytes(last.diskUsed) : '-' }} <span class="text-muted-foreground">/ {{ inst.diskGb }} GB</span></dd>
          <dt class="text-muted-foreground">{{ t('Processes') }}</dt><dd class="font-mono">{{ d.live?.processes ?? '-' }}</dd>
          <dt class="text-muted-foreground">{{ t('Network') }}</dt>
          <dd class="font-mono">↓ {{ last ? rate(last.rx) : '-' }} | ↑ {{ last ? rate(last.tx) : '-' }}</dd>
        </dl>
      </CardContent>
    </Card>

    <Card class="md:col-span-2">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><GlobeIcon class="size-4" /> {{ t('Traffic this month') }}</CardTitle>
        <CardDescription>{{ t('Counted in and out. Resets on the 1st (UTC).') }}</CardDescription>
        <CardAction class="font-mono text-sm">
          {{ bytes(used) }} <span class="text-muted-foreground">/ {{ quotaBytes == null ? t('unlimited') : bytes(quotaBytes) }}</span>
        </CardAction>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <Progress v-if="quotaBytes != null" :model-value="Math.min(100, (used / quotaBytes) * 100)" />
        <p class="text-muted-foreground text-sm">
          ↓ {{ bytes(d.traffic.rx) }} {{ t('received') }} | ↑ {{ bytes(d.traffic.tx) }} {{ t('sent') }}
          <span v-if="inst.trafficBlocked" class="text-destructive"> | {{ t('Quota reached: network is limited until next month.') }}</span>
        </p>
      </CardContent>
    </Card>

    <Card class="md:col-span-2">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><ChartLineIcon class="size-4" /> {{ t('Usage') }}</CardTitle>
        <CardAction>
          <ToggleGroup :model-value="range" type="single" variant="outline" size="sm" :aria-label="t('Time range')" @update:model-value="(v) => v && (range = String(v))">
            <ToggleGroupItem v-for="(_, k) in RANGES" :key="k" :value="k" class="font-mono">{{ k }}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div v-if="metrics.loading.value && !metrics.data.value" class="grid gap-6 md:grid-cols-2">
          <Skeleton v-for="n in 4" :key="n" class="h-48" />
        </div>
        <p v-else-if="points.length < 2" class="text-muted-foreground text-sm">
          {{ t('Metrics appear a couple of minutes after the container starts. They are sampled every minute.') }}
        </p>
        <div v-else-if="last" class="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <div>
            <div class="mb-2 flex items-baseline justify-between text-sm"><h3 class="font-medium">{{ t('CPU') }}</h3><span class="font-mono">{{ last.cpu }}%</span></div>
            <MetricChart :data="points" :range-ms="RANGES[range]!" :max="100" :format="pct" :series="[{ key: 'cpu', label: 'CPU', color: 'var(--chart-1)' }]" />
          </div>
          <div>
            <div class="mb-2 flex items-baseline justify-between text-sm"><h3 class="font-medium">{{ t('Memory') }}</h3><span class="font-mono">{{ bytes(last.memUsed) }}</span></div>
            <MetricChart :data="points" :range-ms="RANGES[range]!" :max="inst.memoryMb * 1048576" :format="(n) => bytes(n)" :series="[{ key: 'memUsed', label: 'RAM', color: 'var(--chart-1)' }]" />
          </div>
          <div>
            <div class="mb-2 flex items-baseline justify-between text-sm"><h3 class="font-medium">{{ t('Network') }}</h3></div>
            <MetricChart
              :data="points" :range-ms="RANGES[range]!" :format="rate"
              :series="[{ key: 'rx', label: t('in'), color: 'var(--chart-1)' }, { key: 'tx', label: t('out'), color: 'var(--chart-2)' }]"
            />
          </div>
          <div>
            <div class="mb-2 flex items-baseline justify-between text-sm"><h3 class="font-medium">{{ t('Disk') }}</h3><span class="font-mono">{{ bytes(last.diskUsed) }}</span></div>
            <MetricChart :data="points" :range-ms="RANGES[range]!" :max="inst.diskGb * 1e9" :format="(n) => bytes(n)" :series="[{ key: 'diskUsed', label: t('Disk'), color: 'var(--chart-2)' }]" />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
