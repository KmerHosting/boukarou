<script setup lang="ts">
import { ExternalLinkIcon, GlobeIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import ConfirmDialog from '@/components/app/ConfirmDialog.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { del, messageOf, post } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { Domain, Instance } from '@/lib/types'

const props = defineProps<{ inst: Instance }>()
type Resp = { available: boolean; reason: string | null; publicHost: string | null; domains: Domain[] }
const { data, reload } = useResource<Resp>(
  () => `/api/instances/${props.inst.id}/domains`,
  (d) => (d?.domains.some((x) => x.status === 'provisioning' || x.status === 'deleting') ? 3000 : false),
)

const domain = ref('')
const port = ref('80')
const busy = ref(false)
const error = ref('')
const removing = ref<Domain | null>(null)
const removeOpen = computed({ get: () => !!removing.value, set: (v) => { if (!v) removing.value = null } })

async function add() {
  busy.value = true
  error.value = ''
  try {
    await post(`/api/instances/${props.inst.id}/domains`, { domain: domain.value.trim(), targetPort: Number(port.value) })
    domain.value = ''
    await reload()
  } catch (failure) {
    error.value = messageOf(failure)
  }
  busy.value = false
}

const statusLabel = (s: string) =>
  s === 'active' ? t('HTTPS active') : s === 'failed' ? t('Failed') : s === 'deleting' ? t('Removing') : t('Issuing certificate')
</script>

<template>
  <Skeleton v-if="!data" class="h-56 rounded-xl" />
  <template v-else>
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><GlobeIcon class="size-4" /> {{ t('Add a domain') }}</CardTitle>
        <CardDescription>{{ t('Serve a website from this container on your own domain, with a free HTTPS certificate.') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <Alert v-if="!data.available"><AlertDescription>{{ data.reason }}</AlertDescription></Alert>
        <form v-else class="flex flex-col gap-4" @submit.prevent="add">
          <ol class="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>{{ t('At your DNS provider, create an A record for the domain pointing to') }} <b class="text-foreground font-mono">{{ data.publicHost }}</b>.</li>
            <li>{{ t('Make sure your app listens on the port below inside the container.') }}</li>
            <li>{{ t('Add the domain. The certificate is issued automatically.') }}</li>
          </ol>
          <div class="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
            <Field>
              <FieldLabel for="dom">{{ t('Domain') }}</FieldLabel>
              <Input id="dom" v-model="domain" class="font-mono" placeholder="app.example.com" autocomplete="off" spellcheck="false" />
            </Field>
            <Field>
              <FieldLabel for="port">{{ t('Port') }}</FieldLabel>
              <Input id="port" :model-value="port" class="font-mono" inputmode="numeric" @update:model-value="(v) => (port = String(v).replace(/\D/g, ''))" />
            </Field>
            <Button type="submit" :disabled="busy || !domain || !port">
              <Spinner v-if="busy" data-icon="inline-start" /><PlusIcon v-else data-icon="inline-start" /> {{ t('Add domain') }}
            </Button>
          </div>
          <FieldError v-if="error">{{ error }}</FieldError>
        </form>
      </CardContent>
    </Card>

    <Card class="py-0">
      <CardContent class="px-0">
        <p v-if="!data.domains.length" class="text-muted-foreground p-6 text-sm">{{ t('No domains yet.') }}</p>
        <ul v-else class="divide-y">
          <li v-for="d in data.domains" :key="d.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1 font-mono text-sm">
              <a v-if="d.status === 'active'" :href="`https://${d.domain}`" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 hover:underline">
                {{ d.domain }} <ExternalLinkIcon class="size-3.5" />
              </a>
              <span v-else>{{ d.domain }}</span>
              <span class="text-muted-foreground"> → :{{ d.targetPort }}</span>
              <div v-if="d.error" class="text-destructive font-sans text-xs">{{ d.error }}</div>
            </div>
            <Badge :variant="d.status === 'failed' ? 'destructive' : d.status === 'active' ? 'secondary' : 'outline'">{{ statusLabel(d.status) }}</Badge>
            <Button v-if="d.status !== 'deleting' && d.status !== 'provisioning'" size="sm" variant="outline" class="text-destructive" @click="removing = d">
              <Trash2Icon data-icon="inline-start" /> {{ t('Remove') }}
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>
  </template>

  <ConfirmDialog
    v-model:open="removeOpen"
    :title="t('Remove {d}?', { d: removing?.domain ?? '' })"
    :description="t('The domain stops pointing to this container and its certificate is deleted.')"
    :action="t('Remove domain')"
    destructive
    :confirm="async () => {
      await del(`/api/instances/${inst.id}/domains/${removing!.id}`)
      toast.success(t('Domain removed'))
      await reload()
    }"
  />
</template>
