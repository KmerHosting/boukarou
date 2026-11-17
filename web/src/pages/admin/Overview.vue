<script setup lang="ts">
import InOut from '@/components/app/InOut.vue'
import { ActivityIcon, ChevronRightIcon, ClockIcon, MonitorIcon, ContainerIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, ServerIcon, TriangleAlertIcon, UserPlusIcon } from '@lucide/vue'
import { computed } from 'vue'
import EventList from '@/components/app/EventList.vue'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useResource } from '@/composables/useResource'
import { bytes, duration, memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { EventItem } from '@/lib/types'

type Data = {
  host: { hostname: string; cpus: number; load: number[]; memTotal: number; memFree: number; uptime: number; platform: string }
  runtime: { ok: boolean; server?: string; version?: string; storageDriver?: string; error?: string }
  pool: { used: number; total: number } | null
  project: string
  network: string
  counts: { total: number; running: number; stopped: number; failed: number; cpu: number; memory_mb: number; disk_gb: number; users: number }
  traffic: { rx: number; tx: number }
  settings: { publicHost: string }
  events: EventItem[]
  version: string
}

const { data, error } = useResource<Data>('/api/admin/overview', 20_000)
const memUsed = computed(() => (data.value ? data.value.host.memTotal - data.value.host.memFree : 0))
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('Overview') }}</h2>
      <p v-if="data" class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span class="inline-flex items-center gap-1.5"><ServerIcon class="size-3.5 opacity-60" /><span class="font-mono">{{ data.host.hostname }}</span></span>
        <span class="inline-flex items-center gap-1.5"><MonitorIcon class="size-3.5 opacity-60" />{{ data.host.platform }}</span>
        <span class="inline-flex items-center gap-1.5"><ClockIcon class="size-3.5 opacity-60" />{{ t('up {d}', { d: duration(data.host.uptime) }) }}</span>
      </p>
    </div>
    <Button as-child><RouterLink to="/admin/users?new=1"><UserPlusIcon data-icon="inline-start" /> {{ t('New user') }}</RouterLink></Button>
  </div>

  <LoadError :message="data ? '' : error" />

  <template v-if="data">
    <Alert v-if="!data.runtime.ok" variant="destructive">
      <TriangleAlertIcon /><AlertDescription>{{ t('LXD is not reachable: {e}', { e: data.runtime.error || '' }) }}</AlertDescription>
    </Alert>
    <Alert v-if="!data.settings.publicHost">
      <TriangleAlertIcon />
      <AlertDescription>
        <span>{{ t("Set the server's public address so users get a working SSH command and can add domains.") }}
          <RouterLink to="/admin/settings" class="text-foreground underline">{{ t('Open settings') }}</RouterLink></span>
      </AlertDescription>
    </Alert>
    <Alert v-if="data.runtime.ok && data.runtime.storageDriver === 'dir'">
      <TriangleAlertIcon />
      <AlertDescription>{{ t('The storage pool uses the “dir” driver, which cannot enforce disk sizes. Use btrfs or ZFS for hard disk limits.') }}</AlertDescription>
    </Alert>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card class="gap-2">
        <CardHeader><CardDescription class="flex items-center gap-2"><ContainerIcon class="size-4" /> {{ t('Containers') }}</CardDescription></CardHeader>
        <CardContent class="flex flex-col gap-1">
          <div class="text-3xl font-semibold tabular-nums">{{ data.counts.total }}</div>
          <p class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-emerald-500" />{{ t('{r} running', { r: data.counts.running || 0 }) }}</span>
            <span class="inline-flex items-center gap-1.5"><span class="bg-muted-foreground/50 size-1.5 rounded-full" />{{ t('{s} stopped', { s: data.counts.stopped || 0 }) }}</span>
            <span v-if="data.counts.failed" class="inline-flex items-center gap-1.5"><span class="bg-destructive size-1.5 rounded-full" />{{ t('{f} failed', { f: data.counts.failed }) }}</span>
          </p>
        </CardContent>
      </Card>
      <Card class="gap-2">
        <CardHeader><CardDescription class="flex items-center gap-2"><CpuIcon class="size-4" /> {{ t('CPU') }}</CardDescription></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div class="text-3xl font-semibold tabular-nums">{{ data.host.load[0]!.toFixed(2) }}</div>
          <div class="text-muted-foreground text-xs"><p>{{ t('load on {n} cores', { n: data.host.cpus }) }}</p><p>{{ t('{a} vCPU allocated', { a: data.counts.cpu }) }}</p></div>
          <Progress :model-value="Math.min(100, (data.host.load[0]! / data.host.cpus) * 100)" />
        </CardContent>
      </Card>
      <Card class="gap-2">
        <CardHeader><CardDescription class="flex items-center gap-2"><MemoryStickIcon class="size-4" /> {{ t('Memory') }}</CardDescription></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div class="text-3xl font-semibold tabular-nums">{{ bytes(memUsed) }}</div>
          <div class="text-muted-foreground text-xs"><p>{{ t('of {t}', { t: bytes(data.host.memTotal) }) }}</p><p>{{ t('{a} allocated', { a: memory(data.counts.memory_mb) }) }}</p></div>
          <Progress :model-value="(memUsed / data.host.memTotal) * 100" />
        </CardContent>
      </Card>
      <Card class="gap-2">
        <CardHeader><CardDescription class="flex items-center gap-2"><HardDriveIcon class="size-4" /> {{ t('Storage pool') }}</CardDescription></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div class="text-3xl font-semibold tabular-nums">{{ data.pool ? bytes(data.pool.used) : '-' }}</div>
          <div class="text-muted-foreground text-xs">
            <template v-if="data.pool"><p>{{ t('of {t}', { t: bytes(data.pool.total) }) }}</p><p>{{ t('{a} GB allocated', { a: data.counts.disk_gb }) }}</p></template>
            <p v-else>{{ t('unknown') }}</p>
          </div>
          <Progress v-if="data.pool && data.pool.total" :model-value="(data.pool.used / data.pool.total) * 100" />
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle class="flex items-center gap-2"><ServerIcon class="size-4" /> {{ t('Runtime') }}</CardTitle></CardHeader>
        <CardContent>
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ t('Engine') }}</dt>
            <dd>
              <template v-if="data.runtime.ok">{{ data.runtime.server }} {{ data.runtime.version }}</template>
              <span v-else class="text-destructive">{{ t('unavailable') }}</span>
            </dd>
            <dt class="text-muted-foreground">{{ t('Storage driver') }}</dt><dd class="font-mono">{{ data.runtime.storageDriver || '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('LXD project') }}</dt><dd class="font-mono">{{ data.project }}</dd>
            <dt class="text-muted-foreground">{{ t('Bridge') }}</dt><dd class="font-mono">{{ data.network }}</dd>
            <dt class="text-muted-foreground">{{ t('Public address') }}</dt><dd class="font-mono">{{ data.settings.publicHost || '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('Users') }}</dt><dd>{{ data.counts.users }}</dd>
            <dt class="text-muted-foreground">{{ t('Traffic this month') }}</dt><dd><InOut :down="bytes(data.traffic.rx)" :up="bytes(data.traffic.tx)" /></dd>
            <dt class="text-muted-foreground">{{ t('Version') }}</dt><dd class="font-mono">Boukarou {{ data.version }}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card class="gap-0 pb-0">
        <CardHeader class="pb-4">
          <CardTitle class="flex items-center gap-2"><ActivityIcon class="size-4" /> {{ t('Recent activity') }}</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" as-child><RouterLink to="/admin/activity">{{ t('All activity') }} <ChevronRightIcon data-icon="inline-end" /></RouterLink></Button>
          </CardAction>
        </CardHeader>
        <CardContent class="border-t px-0"><EventList :events="data.events.slice(0, 8)" show-user /></CardContent>
      </Card>
    </div>
  </template>
  <div v-else-if="!error" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Skeleton v-for="n in 4" :key="n" class="h-32 rounded-xl" /></div>
</template>
