<script setup lang="ts">
import { CpuIcon, HardDriveIcon, KeyRoundIcon, PlusIcon, ShuffleIcon, TagIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import OsLogo from '@/components/app/OsLogo.vue'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useResource } from '@/composables/useResource'
import { messageOf, post } from '@/lib/api'
import { memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Image, Instance, Limits, Usage } from '@/lib/types'

type Overview = { usage: Usage; limits: Limits; diskQuotaEnforced: boolean; host: { cpus: number; memoryMb: number } }

const router = useRouter()
const overview = useResource<Overview>('/api/overview')
const images = useResource<{ images: Image[] }>('/api/images')

const WORDS = ['baobab', 'okapi', 'mango', 'kola', 'safou', 'ndole', 'ebene', 'iroko', 'sanaga', 'wouri', 'manengouba', 'bamenda', 'kribi', 'limbe']
const suggestName = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(100 + Math.random() * 900)}`
const PRESETS = [
  { label: 'Small', cpu: 1, mem: 1024, disk: 10 },
  { label: 'Medium', cpu: 2, mem: 4096, disk: 40 },
  { label: 'Large', cpu: 4, mem: 8192, disk: 80 },
]

const name = ref(suggestName())
const imageId = ref('')
const cpu = ref(1)
const mem = ref(1024)
const disk = ref(10)
const sshKey = ref('')
const showKey = ref(false)
const error = ref('')
const busy = ref(false)

const remaining = computed(() => {
  const o = overview.data.value
  if (!o) return { cpu: null, mem: null, disk: null }
  const left = (max: number | null, used: number) => (max == null ? null : Math.max(0, max - used))
  return { cpu: left(o.limits.max_cpu, o.usage.cpu), mem: left(o.limits.max_memory_mb, o.usage.memoryMb), disk: left(o.limits.max_disk_gb, o.usage.diskGb) }
})
const fit = (want: number, max: number | null, min: number) => Math.max(min, max == null ? want : Math.min(want, max))

const families = computed(() => {
  const map = new Map<string, Image[]>()
  for (const i of images.data.value?.images ?? []) map.set(i.family, [...(map.get(i.family) ?? []), i])
  return [...map.entries()]
})
const familyPick = ref<Record<string, string>>({})

watch(
  () => [images.data.value, overview.data.value] as const,
  ([imgs, o]) => {
    if (imgs && !imageId.value) imageId.value = imgs.images.find((i) => i.id === 'ubuntu-24.04')?.id ?? imgs.images[0]?.id ?? ''
    if (o) applyPreset(PRESETS[0]!)
  },
  { immediate: true },
)

function applyPreset(p: (typeof PRESETS)[number]) {
  cpu.value = fit(p.cpu, remaining.value.cpu, 1)
  mem.value = fit(p.mem, remaining.value.mem, 128)
  disk.value = fit(p.disk, remaining.value.disk, 1)
}

const full = computed(() => {
  const o = overview.data.value
  return !!o && o.limits.max_instances != null && o.usage.instances >= o.limits.max_instances
})
const noRoom = computed(() => (remaining.value.cpu ?? 1) < 1 || (remaining.value.mem ?? 128) < 128 || (remaining.value.disk ?? 1) < 1)
const nameOk = computed(() => /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(name.value))
const selected = computed(() => images.data.value?.images.find((i) => i.id === imageId.value))

function pickFamily(family: string, list: Image[]) {
  imageId.value = list.find((i) => i.id === familyPick.value[family])?.id ?? list[0]!.id
}

async function create() {
  busy.value = true
  error.value = ''
  try {
    const r = await post<{ instance: Instance }>('/api/instances', {
      name: name.value,
      imageId: imageId.value,
      cpu: cpu.value,
      memoryMb: mem.value,
      diskGb: disk.value,
      sshKey: sshKey.value.trim() || undefined,
    })
    await router.push(`/c/${r.instance.id}`)
  } catch (failure) {
    error.value = messageOf(failure)
    busy.value = false
  }
}

const clampInt = (value: string | number, min: number, max: number | null) => {
  const n = Math.round(Number(value) || min)
  return Math.max(min, max == null ? n : Math.min(n, max))
}
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold tracking-tight">{{ t('New container') }}</h2>
    <p class="text-muted-foreground text-sm">{{ t('Pick a system and the resources it needs. You can resize it later.') }}</p>
  </div>

  <LoadError :message="overview.error.value || images.error.value" />

  <template v-if="overview.data.value && images.data.value">
    <Alert v-if="full || noRoom" variant="destructive">
      <AlertDescription>
        {{ full
          ? t('You have reached your container limit. Delete a container or ask your administrator for more.')
          : t('Your resource limits are fully used. Resize or delete a container, or ask your administrator for more.') }}
      </AlertDescription>
    </Alert>

    <form class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" @submit.prevent="create">
      <div class="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><TagIcon class="size-4" /> {{ t('Name') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <Field :data-invalid="!nameOk || undefined">
              <FieldLabel for="name">{{ t('Container name') }}</FieldLabel>
              <div class="flex gap-2">
                <Input id="name" v-model="name" class="font-mono" maxlength="32" spellcheck="false" autocomplete="off" @update:model-value="(v) => (name = String(v).toLowerCase())" />
                <Button type="button" variant="outline" @click="name = suggestName()"><ShuffleIcon data-icon="inline-start" /> {{ t('Suggest') }}</Button>
              </div>
              <FieldDescription>{{ t('Lowercase letters, digits and hyphens. Also used as the hostname.') }}</FieldDescription>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><HardDriveIcon class="size-4" /> {{ t('Operating system') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
              <div
                v-for="[family, list] in families"
                :key="family"
                role="button"
                tabindex="0"
                class="hover:border-primary/40 flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors"
                :class="list.some((i) => i.id === imageId) ? 'border-primary ring-primary/20 bg-primary/5 ring-2' : ''"
                :aria-pressed="list.some((i) => i.id === imageId)"
                @click="pickFamily(family, list)"
                @keydown.enter.space.prevent="pickFamily(family, list)"
              >
                <OsLogo :family="family" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{{ list[0]!.name }}</div>
                  <select
                    v-if="list.length > 1"
                    class="text-muted-foreground w-full truncate bg-transparent text-xs outline-none"
                    :aria-label="t('{x} version', { x: list[0]!.name })"
                    :value="list.find((i) => i.id === imageId)?.id ?? familyPick[family] ?? list[0]!.id"
                    @click.stop
                    @change="(e) => { const v = (e.target as HTMLSelectElement).value; familyPick[family] = v; imageId = v }"
                  >
                    <option v-for="i in list" :key="i.id" :value="i.id">{{ i.version }}</option>
                  </select>
                  <div v-else class="text-muted-foreground text-xs">{{ list[0]!.version }}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><CpuIcon class="size-4" /> {{ t('Resources') }}</CardTitle>
            <CardDescription>{{ t('Only what you allocate counts against your limits.') }}</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-5">
            <div class="grid gap-2 sm:grid-cols-3">
              <button
                v-for="p in PRESETS"
                :key="p.label"
                type="button"
                class="hover:border-primary/40 rounded-lg border p-3 text-left transition-colors"
                @click="applyPreset(p)"
              >
                <div class="text-sm font-medium">{{ t(p.label) }}</div>
                <div class="text-muted-foreground font-mono text-xs">{{ p.cpu }} vCPU | {{ memory(p.mem) }} | {{ p.disk }} GB</div>
              </button>
            </div>
            <div class="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel for="cpu">{{ t('vCPU') }}</FieldLabel>
                <Input id="cpu" type="number" min="1" :max="remaining.cpu ?? overview.data.value.host.cpus" class="font-mono" :model-value="cpu" @update:model-value="(v) => (cpu = clampInt(v, 1, remaining.cpu ?? overview.data.value!.host.cpus))" />
                <FieldDescription>
                  {{ remaining.cpu == null ? t('Host has {n} cores', { n: overview.data.value.host.cpus }) : t('{n} available', { n: remaining.cpu }) }}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel for="mem">{{ t('Memory (MB)') }}</FieldLabel>
                <Input id="mem" type="number" min="128" step="256" class="font-mono" :model-value="mem" @update:model-value="(v) => (mem = clampInt(v, 128, remaining.mem))" />
                <FieldDescription>
                  {{ remaining.mem == null ? t('Host has {n}', { n: memory(overview.data.value.host.memoryMb) }) : t('{n} available', { n: memory(remaining.mem) }) }}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel for="disk">{{ t('Disk (GB)') }}</FieldLabel>
                <Input id="disk" type="number" min="1" step="5" class="font-mono" :model-value="disk" @update:model-value="(v) => (disk = clampInt(v, 1, remaining.disk))" />
                <FieldDescription>{{ remaining.disk == null ? t('No limit') : t('{n} GB available', { n: remaining.disk }) }}</FieldDescription>
              </Field>
            </div>
            <p v-if="!overview.data.value.diskQuotaEnforced" class="text-muted-foreground text-sm">
              {{ t("This server's storage does not enforce disk sizes. The size is recorded but not applied.") }}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2">
              <KeyRoundIcon class="size-4" /> {{ t('SSH key') }}
              <span class="text-muted-foreground font-normal">· {{ t('optional') }}</span>
            </CardTitle>
            <CardDescription>{{ t('A root password is always generated. Add a public key to sign in without it.') }}</CardDescription>
            <CardAction v-if="!showKey">
              <Button type="button" variant="outline" size="sm" @click="showKey = true">{{ t('Add key') }}</Button>
            </CardAction>
          </CardHeader>
          <CardContent v-if="showKey">
            <Textarea v-model="sshKey" class="font-mono text-xs" rows="3" placeholder="ssh-ed25519 AAAA… you@laptop" spellcheck="false" />
          </CardContent>
        </Card>
      </div>

      <Card class="lg:sticky lg:top-20">
        <CardHeader><CardTitle>{{ t('Summary') }}</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-4">
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ t('Name') }}</dt><dd class="truncate text-right font-mono">{{ name || '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('System') }}</dt><dd class="text-right">{{ selected ? `${selected.name} ${selected.version}` : '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('vCPU') }}</dt><dd class="text-right font-mono">{{ cpu }}</dd>
            <dt class="text-muted-foreground">{{ t('Memory') }}</dt><dd class="text-right font-mono">{{ memory(mem) }}</dd>
            <dt class="text-muted-foreground">{{ t('Disk') }}</dt><dd class="text-right font-mono">{{ disk }} GB</dd>
            <dt class="text-muted-foreground">{{ t('Access') }}</dt><dd class="text-right">{{ sshKey.trim() ? t('Password + key') : t('Password') }}</dd>
          </dl>
          <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
          <Button type="submit" class="w-full" :disabled="busy || !nameOk || !imageId || full || noRoom">
            <Spinner v-if="busy" data-icon="inline-start" />
            <PlusIcon v-else data-icon="inline-start" />
            {{ t('Create container') }}
          </Button>
          <p class="text-muted-foreground text-xs">{{ t('The first container from a system takes longer while the image downloads.') }}</p>
        </CardContent>
      </Card>
    </form>
  </template>
  <Skeleton v-else-if="!overview.error.value" class="h-96 rounded-xl" />
</template>
