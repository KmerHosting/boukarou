<script setup lang="ts">
import { UserPlusIcon } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LimitsEditor from '@/components/app/LimitsEditor.vue'
import SecretDialog from '@/components/app/SecretDialog.vue'
import LoadError from '@/components/LoadError.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useResource } from '@/composables/useResource'
import { api, messageOf, post } from '@/lib/api'
import { ago, memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import { fromDraft, LIMIT_FIELDS, toDraft, type LimitDraft } from '@/lib/limits'
import type { AdminUser, Limits } from '@/lib/types'

const route = useRoute()
const router = useRouter()
const { data, error, reload } = useResource<{ users: AdminUser[] }>('/api/admin/users')

const creating = ref(false)
const created = ref<{ username: string; password: string } | null>(null)
const username = ref('')
const password = ref('')
const note = ref('')
const mustChange = ref(true)
const limits = ref<LimitDraft | null>(null)
const busy = ref(false)
const formError = ref('')

async function openCreate() {
  username.value = password.value = note.value = formError.value = ''
  mustChange.value = true
  limits.value = null
  creating.value = true
  try {
    const { settings: s } = await api<{ settings: Record<string, string> }>('/api/admin/settings')
    limits.value = toDraft(
      Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, s[`default_${f.key}`] === '' ? null : Number(s[`default_${f.key}`])])) as Partial<Limits>,
    )
  } catch (failure) {
    formError.value = messageOf(failure)
  }
}

watch(() => route.query.new, (v) => { if (v) { void openCreate(); void router.replace({ query: {} }) } }, { immediate: true })

async function create() {
  busy.value = true
  formError.value = ''
  try {
    const r = await post<{ user: AdminUser; password: string }>('/api/admin/users', {
      username: username.value,
      password: password.value || undefined,
      note: note.value,
      mustChange: mustChange.value,
      limits: fromDraft(limits.value!),
    })
    creating.value = false
    created.value = { username: r.user.username, password: r.password }
    await reload()
  } catch (failure) {
    formError.value = messageOf(failure)
  }
  busy.value = false
}

const cell = (used: number, max: number | null, fmt: (n: number) => string = String) => ({ used: fmt(used), max: max == null ? '∞' : fmt(max) })
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('Users') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('Everyone who can sign in, and the limits you give them. Everything is free; limits only protect your server.') }}</p>
    </div>
    <Button @click="openCreate"><UserPlusIcon data-icon="inline-start" /> {{ t('New user') }}</Button>
  </div>

  <LoadError :message="error" />

  <Card v-if="data" class="py-0">
    <CardContent class="px-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t('Username') }}</TableHead>
            <TableHead>{{ t('Containers') }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t('vCPU') }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t('Memory') }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t('Disk') }}</TableHead>
            <TableHead class="hidden pr-4 lg:table-cell">{{ t('Last sign-in') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="u in data.users" :key="u.id" class="cursor-pointer" @click="router.push(`/admin/users/${u.id}`)">
            <TableCell class="pl-4">
              <div class="flex flex-wrap items-center gap-1.5">
                <RouterLink :to="`/admin/users/${u.id}`" class="font-mono font-medium hover:underline" @click.stop>{{ u.username }}</RouterLink>
                <Badge v-if="u.role === 'admin'">{{ t('Admin') }}</Badge>
                <Badge v-if="u.disabled" variant="destructive">{{ t('Disabled') }}</Badge>
                <Badge v-if="u.mustChangePassword" variant="outline">{{ t('Temporary password') }}</Badge>
                <Badge v-if="u.totpEnabled" variant="secondary">2FA</Badge>
              </div>
            </TableCell>
            <TableCell v-for="(c, i) in [
              cell(u.usage.instances, u.limits.max_instances),
              cell(u.usage.cpu, u.limits.max_cpu),
              cell(u.usage.memoryMb, u.limits.max_memory_mb, memory),
              cell(u.usage.diskGb, u.limits.max_disk_gb, (n) => `${n} GB`),
            ]" :key="i" class="font-mono whitespace-nowrap" :class="i ? 'hidden md:table-cell' : ''">
              {{ c.used }} <span class="text-muted-foreground">/ {{ c.max }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground hidden pr-4 lg:table-cell">{{ ago(u.lastLoginAt) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
  <Skeleton v-else-if="!error" class="h-64 rounded-xl" />

  <Dialog v-model:open="creating">
    <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('New user') }}</DialogTitle>
        <DialogDescription>{{ t('Limits start from the defaults in Settings. Leave a field on Unlimited to allow any amount.') }}</DialogDescription>
      </DialogHeader>
      <form id="new-user" class="flex flex-col gap-4" @submit.prevent="create">
        <div class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="nu-name">{{ t('Username') }}</FieldLabel>
            <Input id="nu-name" class="font-mono" autocomplete="off" spellcheck="false" :model-value="username" @update:model-value="(v) => (username = String(v).toLowerCase())" />
            <FieldDescription>{{ t('Lowercase, 3–32 characters.') }}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="nu-pw">{{ t('Temporary password') }}</FieldLabel>
            <Input id="nu-pw" v-model="password" class="font-mono" autocomplete="new-password" />
            <FieldDescription>{{ t('Leave empty to generate one.') }}</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel for="nu-note">{{ t('Note (only you see it)') }}</FieldLabel>
          <Input id="nu-note" v-model="note" maxlength="300" />
        </Field>
        <label class="flex items-center gap-2 text-sm">
          <Switch v-model="mustChange" /> {{ t('Ask them to choose a new password at first sign-in') }}
        </label>
        <h3 class="text-sm font-medium">{{ t('Limits') }}</h3>
        <LimitsEditor v-if="limits" v-model="limits" />
        <div v-else class="grid gap-3 sm:grid-cols-2"><Skeleton v-for="n in 4" :key="n" class="h-16" /></div>
        <FieldError v-if="formError">{{ formError }}</FieldError>
      </form>
      <DialogFooter>
        <Button variant="outline" @click="creating = false">{{ t('Cancel') }}</Button>
        <Button type="submit" form="new-user" :disabled="busy || !username || !limits">
          <Spinner v-if="busy" data-icon="inline-start" /><UserPlusIcon v-else data-icon="inline-start" /> {{ t('Create user') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <SecretDialog
    :title="t('{u} can sign in', { u: created?.username ?? '' })"
    :description="t('Give them this password. It is not shown again.')"
    :secret="created?.password ?? null"
    @close="created = null"
  />
</template>
