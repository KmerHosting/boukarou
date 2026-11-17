<script setup lang="ts">
import {
  ActivityIcon, ChevronRightIcon, CircleCheckIcon, ExpandIcon, GaugeIcon, GlobeIcon, LoaderCircleIcon, PlayIcon,
  RotateCcwIcon, RotateCwIcon, SettingsIcon, SnowflakeIcon, SquareIcon, SquareTerminalIcon, SunIcon, Trash2Icon,
  HistoryIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/app/ConfirmDialog.vue'
import InstanceStatus from '@/components/app/InstanceStatus.vue'
import OsLogo from '@/components/app/OsLogo.vue'
import SecretDialog from '@/components/app/SecretDialog.vue'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useResource } from '@/composables/useResource'
import { user } from '@/composables/useSession'
import { del, messageOf, post } from '@/lib/api'
import { ago, memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Detail, Instance } from '@/lib/types'
import ActivityTab from './container/ActivityTab.vue'
import ConsoleTab from './container/ConsoleTab.vue'
import DomainsTab from './container/DomainsTab.vue'
import OverviewTab from './container/OverviewTab.vue'
import ResizeTab from './container/ResizeTab.vue'
import SettingsTab from './container/SettingsTab.vue'
import SnapshotsTab from './container/SnapshotsTab.vue'

const STEPS: [string, string][] = [
  ['queued', 'Waiting in queue'],
  ['image', 'Downloading and unpacking the image'],
  ['configure', 'Applying resources and network'],
  ['start', 'Booting'],
  ['network', 'Waiting for the network'],
  ['ssh', 'Installing and configuring SSH'],
  ['credentials', 'Setting the root password'],
]

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))
const tab = computed(() => String(route.params.tab || 'overview'))

const transitional = (i?: Instance) => !!i && (['creating', 'reinstalling', 'deleting'].includes(i.status) || !!i.busy)
const { data, error, reload } = useResource<Detail>(() => `/api/instances/${id.value}`, (d) => (transitional(d?.instance) ? 2500 : 10_000))

const inst = computed(() => data.value?.instance)
const mine = computed(() => !!inst.value && inst.value.userId === user.value?.id)
const status = computed(() => inst.value?.status ?? 'unknown')
const pending = ref<string | null>(null)
const busy = computed(() => transitional(inst.value) || !!pending.value)
const ready = computed(() => !['creating', 'deleting'].includes(status.value))

const password = ref<string | null>(null)
const confirmDelete = ref(false)
let asked = false

// Reveal the generated root password exactly once, to the owner.
watch(
  inst,
  (i) => {
    if (i?.status === 'reinstalling') asked = false
    if (!i || !mine.value || !i.passwordPending || i.status !== 'running' || asked) return
    asked = true
    post<{ password: string | null }>(`/api/instances/${i.id}/initial-password`)
      .then((r) => { if (r.password) password.value = r.password })
      .catch(() => undefined)
  },
  { immediate: true },
)

async function action(name: string) {
  pending.value = name
  try {
    await post(`/api/instances/${id.value}/actions`, { action: name })
    await reload()
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  pending.value = null
}

async function retry() {
  try {
    await post(`/api/instances/${id.value}/retry`)
    await reload()
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

async function remove() {
  await del(`/api/instances/${id.value}`, { confirm: inst.value!.name })
  toast.success(t('{n} deleted', { n: inst.value!.name }))
  await router.push('/')
}

const steps = computed(() => (status.value === 'reinstalling' ? STEPS.filter(([k]) => k !== 'queued' && k !== 'configure') : STEPS))
const stepIndex = computed(() => Math.max(0, steps.value.findIndex(([k]) => k === inst.value?.progress)))

const TABS = [
  { key: 'overview', label: 'Overview', icon: GaugeIcon },
  { key: 'console', label: 'Console', icon: SquareTerminalIcon },
  { key: 'snapshots', label: 'Snapshots', icon: HistoryIcon },
  { key: 'domains', label: 'Domains', icon: GlobeIcon },
  { key: 'resize', label: 'Resize', icon: ExpandIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'activity', label: 'Activity', icon: ActivityIcon },
]
const goTab = (key: string | number) => router.replace(key === 'overview' ? `/c/${id.value}` : `/c/${id.value}/${key}`)
</script>

<template>
  <LoadError :message="data ? '' : error" />
  <template v-if="data && inst">
    <nav class="text-muted-foreground flex items-center gap-1 text-sm">
      <RouterLink :to="user?.role === 'admin' && !mine ? '/admin/containers' : '/'" class="hover:text-foreground">{{ t('Containers') }}</RouterLink>
      <ChevronRightIcon class="size-3.5" />
      <span class="text-foreground font-mono">{{ inst.name }}</span>
    </nav>

    <div class="flex flex-wrap items-center gap-4">
      <OsLogo :family="inst.image.family" size="lg" />
      <div class="min-w-0 flex-1">
        <h2 class="truncate font-mono text-2xl font-semibold tracking-tight">{{ inst.name }}</h2>
        <div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <InstanceStatus :status="status" :busy="inst.busy" />
          <span>{{ inst.image.name }} {{ inst.image.version }}</span>
          <span class="font-mono">{{ inst.cpu }} vCPU | {{ memory(inst.memoryMb) }} | {{ inst.diskGb }} GB</span>
          <span v-if="inst.owner && !mine">
            {{ t('Owner') }}: <RouterLink :to="`/admin/users/${inst.owner.id}`" class="text-foreground font-mono hover:underline">{{ inst.owner.username }}</RouterLink>
          </span>
          <Badge v-if="inst.trafficBlocked" variant="destructive">{{ t('Traffic limited') }}</Badge>
        </div>
      </div>
      <div v-if="ready && status !== 'failed'" class="flex flex-wrap gap-2">
        <Button v-if="status === 'stopped'" :disabled="busy" @click="action('start')">
          <Spinner v-if="pending === 'start'" data-icon="inline-start" /><PlayIcon v-else data-icon="inline-start" /> {{ t('Start') }}
        </Button>
        <Button v-if="status === 'frozen'" :disabled="busy" @click="action('unfreeze')">
          <Spinner v-if="pending === 'unfreeze'" data-icon="inline-start" /><SunIcon v-else data-icon="inline-start" /> {{ t('Unfreeze') }}
        </Button>
        <template v-if="status === 'running'">
          <Button variant="outline" @click="goTab('console')"><SquareTerminalIcon data-icon="inline-start" /> {{ t('Console') }}</Button>
          <Button variant="outline" :disabled="busy" @click="action('restart')">
            <Spinner v-if="pending === 'restart'" data-icon="inline-start" /><RotateCwIcon v-else data-icon="inline-start" /> {{ t('Restart') }}
          </Button>
          <Button variant="outline" :disabled="busy" :title="t('Pause every process without shutting down')" @click="action('freeze')">
            <Spinner v-if="pending === 'freeze'" data-icon="inline-start" /><SnowflakeIcon v-else data-icon="inline-start" /> {{ t('Freeze') }}
          </Button>
        </template>
        <Button v-if="status === 'running' || status === 'frozen'" variant="outline" :disabled="busy" @click="action('stop')">
          <Spinner v-if="pending === 'stop'" data-icon="inline-start" /><SquareIcon v-else data-icon="inline-start" /> {{ t('Stop') }}
        </Button>
      </div>
    </div>

    <Card v-if="status === 'creating' || status === 'reinstalling'">
      <CardHeader>
        <CardTitle>{{ status === 'reinstalling' ? t('Reinstalling {n}', { n: inst.name }) : t('Creating {n}', { n: inst.name }) }}</CardTitle>
        <CardDescription>{{ t('You can leave this page. The container keeps building in the background.') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol class="flex flex-col gap-2.5">
          <li v-for="([key, label], i) in steps" :key="key" class="flex items-center gap-2.5 text-sm" :class="i > stepIndex ? 'text-muted-foreground' : ''">
            <CircleCheckIcon v-if="i < stepIndex" class="size-4 text-emerald-500" />
            <LoaderCircleIcon v-else-if="i === stepIndex" class="text-primary size-4 animate-spin" />
            <span v-else class="size-4 rounded-full border" />
            <span :class="i === stepIndex ? 'font-medium' : ''">{{ t(label) }}</span>
          </li>
        </ol>
      </CardContent>
    </Card>

    <Card v-if="status === 'failed'" class="border-destructive/40">
      <CardHeader><CardTitle>{{ t('Something went wrong') }}</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-4">
        <pre class="bg-destructive/5 text-destructive rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{{ inst.error || t('Unknown error') }}</pre>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="!!inst.busy" @click="retry"><RotateCcwIcon data-icon="inline-start" /> {{ t('Try again') }}</Button>
          <Button variant="outline" @click="goTab('settings')"><RotateCwIcon data-icon="inline-start" /> {{ t('Reinstall') }}</Button>
          <Button variant="destructive" @click="confirmDelete = true"><Trash2Icon data-icon="inline-start" /> {{ t('Delete') }}</Button>
        </div>
      </CardContent>
    </Card>

    <Alert v-if="status === 'deleting'"><AlertDescription>{{ t('Deleting this container…') }}</AlertDescription></Alert>

    <template v-if="ready && status !== 'creating'">
      <Tabs :model-value="tab" @update:model-value="goTab">
        <div class="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger v-for="x in TABS" :key="x.key" :value="x.key"><component :is="x.icon" /> {{ t(x.label) }}</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      <OverviewTab v-if="tab === 'overview'" :d="data" />
      <ConsoleTab v-else-if="tab === 'console'" :inst="inst" />
      <SnapshotsTab v-else-if="tab === 'snapshots'" :d="data" @changed="reload" />
      <DomainsTab v-else-if="tab === 'domains'" :inst="inst" />
      <ResizeTab v-else-if="tab === 'resize'" :d="data" @changed="reload" />
      <SettingsTab v-else-if="tab === 'settings'" :d="data" @changed="reload" @password="(p) => (password = p)" />
      <ActivityTab v-else-if="tab === 'activity'" :inst="inst" />
    </template>

    <p class="text-muted-foreground text-xs">{{ t('Created {t}', { t: ago(inst.createdAt) }) }}</p>

    <SecretDialog
      :title="t('Root password')"
      :description="t('This password is shown only once. Save it in your password manager now.')"
      :secret="password"
      @close="password = null"
    />
    <ConfirmDialog
      v-model:open="confirmDelete"
      :title="t('Delete {n}?', { n: inst.name })"
      :description="t('The container, its snapshots and its domains are removed for good.')"
      :word="inst.name"
      :action="t('Delete container')"
      destructive
      :confirm="remove"
    />
  </template>
  <template v-else-if="!error">
    <Skeleton class="h-16 rounded-xl" />
    <Skeleton class="h-80 rounded-xl" />
  </template>
</template>
