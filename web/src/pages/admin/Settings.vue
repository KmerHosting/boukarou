<script setup lang="ts">
import { GlobeIcon, HardDriveIcon, SaveIcon, UsersIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import LimitsEditor from '@/components/app/LimitsEditor.vue'
import OsLogo from '@/components/app/OsLogo.vue'
import LoadError from '@/components/LoadError.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { messageOf, put } from '@/lib/api'
import { t } from '@/lib/i18n'
import { LIMIT_FIELDS, toDraft, type LimitDraft } from '@/lib/limits'
import type { Image, Limits } from '@/lib/types'

const { data, error, reload } = useResource<{ settings: Record<string, string>; images: Image[] }>('/api/admin/settings')

const publicHost = ref('')
const portStart = ref('')
const portEnd = ref('')
const acme = ref('')
const defaults = ref<LimitDraft | null>(null)
const disabled = ref(new Set<string>())
const busy = ref(false)
const formError = ref('')

watch(data, (d) => {
  if (!d) return
  const s = d.settings
  publicHost.value = s.public_host ?? ''
  portStart.value = s.ssh_port_start ?? ''
  portEnd.value = s.ssh_port_end ?? ''
  acme.value = s.acme_email ?? ''
  defaults.value = toDraft(
    Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, s[`default_${f.key}`] === '' ? null : Number(s[`default_${f.key}`])])) as Partial<Limits>,
  )
  disabled.value = new Set(JSON.parse(s.disabled_images || '[]'))
}, { immediate: true })

const families = computed(() => {
  const map = new Map<string, Image[]>()
  for (const i of data.value?.images ?? []) map.set(i.family, [...(map.get(i.family) ?? []), i])
  return [...map.entries()]
})

function toggle(id: string, on: boolean) {
  const next = new Set(disabled.value)
  if (on) next.delete(id)
  else next.add(id)
  disabled.value = next
}

async function save() {
  busy.value = true
  formError.value = ''
  try {
    const body: Record<string, string> = {
      public_host: publicHost.value.trim(),
      ssh_port_start: portStart.value,
      ssh_port_end: portEnd.value,
      acme_email: acme.value.trim(),
      disabled_images: JSON.stringify([...disabled.value]),
    }
    for (const f of LIMIT_FIELDS) body[`default_${f.key}`] = defaults.value![f.key]
    await put('/api/admin/settings', body)
    toast.success(t('Settings saved'))
    await reload()
  } catch (failure) {
    formError.value = messageOf(failure)
  }
  busy.value = false
}
const digits = (v: string | number) => String(v).replace(/\D/g, '')
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('Settings') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('How this server is reached, and what new users get by default.') }}</p>
    </div>
    <Button :disabled="busy || !data" @click="save"><Spinner v-if="busy" data-icon="inline-start" /><SaveIcon v-else data-icon="inline-start" /> {{ t('Save settings') }}</Button>
  </div>
  <LoadError :message="error" />
  <FieldError v-if="formError">{{ formError }}</FieldError>

  <div v-if="data && defaults" class="flex max-w-4xl flex-col gap-5">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><GlobeIcon class="size-4" /> {{ t('Network access') }}</CardTitle>
        <CardDescription>{{ t('Each container gets one host port forwarded to its SSH server.') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="s-host">{{ t('Public address') }}</FieldLabel>
            <Input id="s-host" v-model="publicHost" class="font-mono" placeholder="203.0.113.10" />
            <FieldDescription>{{ t('IP or host name users connect to. Domains must point here.') }}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{{ t('SSH port range') }}</FieldLabel>
            <div class="flex gap-2">
              <Input :aria-label="t('First port')" class="font-mono" inputmode="numeric" :model-value="portStart" @update:model-value="(v) => (portStart = digits(v))" />
              <Input :aria-label="t('Last port')" class="font-mono" inputmode="numeric" :model-value="portEnd" @update:model-value="(v) => (portEnd = digits(v))" />
            </div>
            <FieldDescription>{{ t('Open this range in your firewall or cloud provider.') }}</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel for="s-acme">{{ t("Let's Encrypt email") }}</FieldLabel>
          <Input id="s-acme" v-model="acme" type="email" />
          <FieldDescription>{{ t('Optional. Receives certificate expiry notices for custom domains.') }}</FieldDescription>
        </Field>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><UsersIcon class="size-4" /> {{ t('Default limits for new users') }}</CardTitle>
        <CardDescription>{{ t('Applied when you create a user. You can change them per user afterwards.') }}</CardDescription>
      </CardHeader>
      <CardContent><LimitsEditor v-model="defaults" /></CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><HardDriveIcon class="size-4" /> {{ t('Operating systems') }}</CardTitle>
        <CardDescription>{{ t("Uncheck the systems you don't want users to install.") }}</CardDescription>
        <CardAction class="text-muted-foreground font-mono text-sm">{{ data.images.length - disabled.size }} / {{ data.images.length }}</CardAction>
      </CardHeader>
      <CardContent class="grid gap-4 sm:grid-cols-2">
        <div v-for="[family, list] in families" :key="family" class="flex items-start gap-3">
          <OsLogo :family="family" />
          <div>
            <div class="mb-1 text-sm font-medium">{{ list[0]!.name }}</div>
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              <label v-for="i in list" :key="i.id" class="flex items-center gap-1.5 text-sm">
                <Checkbox :model-value="!disabled.has(i.id)" @update:model-value="(v) => toggle(i.id, v === true)" />
                {{ i.version }}
              </label>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
  <Skeleton v-else-if="!error" class="h-96 rounded-xl" />
</template>
