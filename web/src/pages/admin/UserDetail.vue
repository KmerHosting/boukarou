<script setup lang="ts">
import { BanIcon, CheckIcon, ChevronRightIcon, CpuIcon, KeyRoundIcon, ShieldOffIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import ConfirmDialog from '@/components/app/ConfirmDialog.vue'
import InstanceTable from '@/components/app/InstanceTable.vue'
import LimitsEditor from '@/components/app/LimitsEditor.vue'
import SecretDialog from '@/components/app/SecretDialog.vue'
import LoadError from '@/components/LoadError.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { del, messageOf, patch, post } from '@/lib/api'
import { ago, date } from '@/lib/format'
import { t } from '@/lib/i18n'
import { fromDraft, toDraft, type LimitDraft } from '@/lib/limits'
import type { AdminUser, Instance } from '@/lib/types'

const route = useRoute()
const router = useRouter()
const uid = computed(() => String(route.params.uid))
const { data, error, reload } = useResource<{ user: AdminUser; instances: Instance[] }>(() => `/api/admin/users/${uid.value}`)
const u = computed(() => data.value?.user)
const isAdmin = computed(() => u.value?.role === 'admin')

const limits = ref<LimitDraft | null>(null)
const note = ref('')
const saving = ref(false)
const password = ref<string | null>(null)
const confirmDelete = ref(false)

watch(() => u.value?.id, () => {
  if (u.value) {
    limits.value = toDraft(u.value.limits)
    note.value = u.value.note
  }
}, { immediate: true })

async function act(fn: () => Promise<unknown>, ok: string) {
  try {
    await fn()
    toast.success(ok)
    await reload()
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

async function save() {
  saving.value = true
  await act(() => patch(`/api/admin/users/${uid.value}`, { limits: fromDraft(limits.value!), note: note.value }), t('Saved'))
  saving.value = false
}
</script>

<template>
  <LoadError :message="data ? '' : error" />
  <template v-if="u && data">
    <nav class="text-muted-foreground flex items-center gap-1 text-sm">
      <RouterLink to="/admin/users" class="hover:text-foreground">{{ t('Users') }}</RouterLink>
      <ChevronRightIcon class="size-3.5" />
      <span class="text-foreground font-mono">{{ u.username }}</span>
    </nav>
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-mono text-2xl font-semibold tracking-tight">{{ u.username }}</h2>
        <p class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          {{ isAdmin ? t('Administrator') : t('User') }} | {{ t('created {d}', { d: date(u.createdAt) }) }} | {{ t('last sign-in {d}', { d: ago(u.lastLoginAt) }) }}
          <Badge v-if="u.disabled" variant="destructive">{{ t('Disabled') }}</Badge>
        </p>
      </div>
      <div v-if="!isAdmin" class="flex flex-wrap gap-2">
        <Button variant="outline" @click="act(async () => (password = (await post<{ password: string }>(`/api/admin/users/${u!.id}/reset-password`)).password), t('Password reset'))">
          <KeyRoundIcon data-icon="inline-start" /> {{ t('Reset password') }}
        </Button>
        <Button v-if="u.totpEnabled" variant="outline" @click="act(() => post(`/api/admin/users/${u!.id}/reset-2fa`), t('Two-factor sign-in removed'))">
          <ShieldOffIcon data-icon="inline-start" /> {{ t('Reset 2FA') }}
        </Button>
        <Button variant="outline" @click="act(() => patch(`/api/admin/users/${u!.id}`, { disabled: !u!.disabled }), u!.disabled ? t('Account enabled') : t('Account disabled'))">
          <CheckIcon v-if="u.disabled" data-icon="inline-start" /><BanIcon v-else data-icon="inline-start" /> {{ u.disabled ? t('Enable') : t('Disable') }}
        </Button>
      </div>
    </div>

    <Alert v-if="isAdmin"><AlertDescription>{{ t('The administrator has no limits. Its password is reset on the server with: sudo boukarou reset-admin-password') }}</AlertDescription></Alert>
    <Card v-else>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><CpuIcon class="size-4" /> {{ t('Limits') }}</CardTitle>
        <CardDescription>{{ t('Lowering a limit never touches existing containers; it only blocks new ones and growth.') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-5">
        <LimitsEditor v-if="limits" v-model="limits" />
        <Field>
          <FieldLabel for="u-note">{{ t('Note (only you see it)') }}</FieldLabel>
          <Input id="u-note" v-model="note" maxlength="300" />
        </Field>
        <div><Button :disabled="saving" @click="save"><Spinner v-if="saving" data-icon="inline-start" /> {{ t('Save changes') }}</Button></div>
      </CardContent>
    </Card>

    <h3 class="text-lg font-semibold">{{ t('Containers') }} <span class="text-muted-foreground font-normal">| {{ data.instances.length }}</span></h3>
    <InstanceTable v-if="data.instances.length" :items="data.instances" />
    <p v-else class="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">{{ t('No containers.') }}</p>

    <Card v-if="!isAdmin" class="border-destructive/30">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><Trash2Icon class="size-4" /> {{ t('Delete user') }}</CardTitle>
        <CardDescription>{{ t('Deletes the account and all of its containers, snapshots and domains.') }}</CardDescription>
        <CardAction><Button variant="destructive" @click="confirmDelete = true"><Trash2Icon data-icon="inline-start" /> {{ t('Delete…') }}</Button></CardAction>
      </CardHeader>
    </Card>

    <SecretDialog
      :title="t('New temporary password')"
      :description="t('Give it to {u}. They will choose their own at next sign-in. All their sessions were signed out.', { u: u.username })"
      :secret="password"
      @close="password = null"
    />
    <ConfirmDialog
      v-model:open="confirmDelete"
      :title="t('Delete {u}?', { u: u.username })"
      :description="data.instances.length ? t('This also deletes {n} container(s) for good.', { n: data.instances.length }) : t('The account is removed for good.')"
      :word="u.username"
      :action="t('Delete user')"
      destructive
      :confirm="async () => {
        await del(`/api/admin/users/${u!.id}`, { confirm: u!.username })
        toast.success(t('{u} deleted', { u: u!.username }))
        await router.push('/admin/users')
      }"
    />
  </template>
  <Skeleton v-else-if="!error" class="h-80 rounded-xl" />
</template>
