<script setup lang="ts">
import { CalendarIcon, KeyRoundIcon, ShieldIcon, UserIcon, LanguagesIcon, LogOutIcon, ShieldCheckIcon, ShieldOffIcon } from '@lucide/vue'
import { useColorMode } from '@vueuse/core'
import QRCode from 'qrcode'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import CopyLine from '@/components/app/CopyLine.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { refreshSession, user } from '@/composables/useSession'
import { messageOf, post } from '@/lib/api'
import { date } from '@/lib/format'
import { lang, setLang, t } from '@/lib/i18n'

const { store: theme } = useColorMode({ storageKey: 'boukarou-theme' })
const isAdmin = computed(() => user.value?.role === 'admin')

// Password
const current = ref('')
const password = ref('')
const repeat = ref('')
const pwBusy = ref(false)
const pwError = ref('')
async function changePassword() {
  if (password.value !== repeat.value) {
    pwError.value = t('The two passwords do not match.')
    return
  }
  pwBusy.value = true
  pwError.value = ''
  try {
    await post('/api/account/password', { current: current.value, password: password.value })
    current.value = password.value = repeat.value = ''
    toast.success(t('Password changed. Other sessions were signed out.'))
  } catch (failure) {
    pwError.value = messageOf(failure)
  }
  pwBusy.value = false
}

// Two-factor
const setup = ref<{ secret: string; qr: string } | null>(null)
const disabling = ref(false)
const code = ref('')
const confirmPw = ref('')
const tfBusy = ref(false)
const tfError = ref('')

async function startSetup() {
  tfBusy.value = true
  try {
    const r = await post<{ secret: string; uri: string }>('/api/account/2fa/setup')
    setup.value = { secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 200 }) }
    code.value = ''
    tfError.value = ''
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  tfBusy.value = false
}

async function enable() {
  tfBusy.value = true
  tfError.value = ''
  try {
    await post('/api/account/2fa/enable', { code: code.value })
    setup.value = null
    await refreshSession()
    toast.success(t('Two-factor sign-in is on'))
  } catch (failure) {
    tfError.value = messageOf(failure)
  }
  tfBusy.value = false
}

async function disable() {
  tfBusy.value = true
  tfError.value = ''
  try {
    await post('/api/account/2fa/disable', { password: confirmPw.value, code: code.value })
    disabling.value = false
    await refreshSession()
    toast.success(t('Two-factor sign-in is off'))
  } catch (failure) {
    tfError.value = messageOf(failure)
  }
  tfBusy.value = false
}

function openDisable() {
  disabling.value = true
  code.value = confirmPw.value = tfError.value = ''
}

async function revoke() {
  try {
    await post('/api/account/sessions/revoke')
    toast.success(t('Other sessions signed out'))
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}
</script>

<template>
  <div v-if="user">
    <h2 class="text-2xl font-semibold tracking-tight">{{ t('Account & security') }}</h2>
    <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span class="inline-flex items-center gap-1.5"><UserIcon class="size-3.5 opacity-60" /><span class="font-mono">{{ user.username }}</span></span>
      <span class="inline-flex items-center gap-1.5"><ShieldIcon class="size-3.5 opacity-60" />{{ isAdmin ? t('Administrator') : t('User') }}</span>
      <span class="inline-flex items-center gap-1.5"><CalendarIcon class="size-3.5 opacity-60" />{{ t('Member since {d}', { d: date(user.createdAt) }) }}</span>
    </p>
  </div>

  <div v-if="user" class="flex max-w-3xl flex-col gap-5">
    <Card v-if="isAdmin">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><KeyRoundIcon class="size-4" /> {{ t('Password') }}</CardTitle>
        <CardDescription>{{ t('For safety, the administrator password can only be changed on the server.') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <CopyLine text="sudo boukarou reset-admin-password" />
        <p class="text-muted-foreground text-xs">{{ t('Add --prompt to type your own password instead of getting a random one.') }}</p>
      </CardContent>
    </Card>
    <Card v-else>
      <CardHeader><CardTitle class="flex items-center gap-2"><KeyRoundIcon class="size-4" /> {{ t('Password') }}</CardTitle></CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="changePassword">
          <div class="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel for="pw-cur">{{ t('Current password') }}</FieldLabel>
              <Input id="pw-cur" v-model="current" type="password" autocomplete="current-password" />
            </Field>
            <Field>
              <FieldLabel for="pw-new">{{ t('New password') }}</FieldLabel>
              <Input id="pw-new" v-model="password" type="password" autocomplete="new-password" />
            </Field>
            <Field>
              <FieldLabel for="pw-rep">{{ t('Repeat new password') }}</FieldLabel>
              <Input id="pw-rep" v-model="repeat" type="password" autocomplete="new-password" />
            </Field>
          </div>
          <FieldDescription>{{ t('At least 10 characters.') }}</FieldDescription>
          <FieldError v-if="pwError">{{ pwError }}</FieldError>
          <div>
            <Button type="submit" :disabled="pwBusy || !current || password.length < 10">
              <Spinner v-if="pwBusy" data-icon="inline-start" /> {{ t('Change password') }}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <ShieldCheckIcon class="size-4" /> {{ t('Two-factor sign-in') }}
          <Badge :variant="user.totpEnabled ? 'secondary' : 'outline'">{{ user.totpEnabled ? t('On') : t('Off') }}</Badge>
        </CardTitle>
        <CardDescription>{{ t('Ask for a code from an authenticator app (Aegis, Google Authenticator, 1Password…) after your password.') }}</CardDescription>
        <CardAction>
          <Button v-if="user.totpEnabled" variant="outline" class="text-destructive" @click="openDisable"><ShieldOffIcon data-icon="inline-start" /> {{ t('Turn off') }}</Button>
          <Button v-else variant="outline" :disabled="tfBusy" @click="startSetup">
            <Spinner v-if="tfBusy" data-icon="inline-start" /><ShieldCheckIcon v-else data-icon="inline-start" /> {{ t('Turn on') }}
          </Button>
        </CardAction>
      </CardHeader>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><LogOutIcon class="size-4" /> {{ t('Sessions') }}</CardTitle>
        <CardDescription>{{ t('Sign out every other browser where your account is signed in.') }}</CardDescription>
        <CardAction><Button variant="outline" @click="revoke"><LogOutIcon data-icon="inline-start" /> {{ t('Sign out others') }}</Button></CardAction>
      </CardHeader>
    </Card>

    <Card>
      <CardHeader><CardTitle class="flex items-center gap-2"><LanguagesIcon class="size-4" /> {{ t('Preferences') }}</CardTitle></CardHeader>
      <CardContent class="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{{ t('Language') }}</FieldLabel>
          <Select :model-value="lang" @update:model-value="(v) => setLang(v as 'en' | 'fr')">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fr">Français</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{{ t('Theme') }}</FieldLabel>
          <Select v-model="theme">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{{ t('System') }}</SelectItem>
              <SelectItem value="light">{{ t('Light') }}</SelectItem>
              <SelectItem value="dark">{{ t('Dark') }}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  </div>

  <Dialog :open="!!setup" @update:open="(v: boolean) => { if (!v) setup = null }">
    <DialogContent v-if="setup" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('Set up two-factor sign-in') }}</DialogTitle>
        <DialogDescription>{{ t('Scan the code with your authenticator app, then enter the 6-digit code it shows.') }}</DialogDescription>
      </DialogHeader>
      <form id="tf-on" class="flex flex-col gap-4" @submit.prevent="enable">
        <div class="flex flex-wrap items-center gap-4">
          <img :src="setup.qr" alt="" width="160" height="160" class="rounded-md border bg-white" />
          <div class="min-w-0 flex-1 text-sm">
            <p class="text-muted-foreground">{{ t('Or enter this key by hand:') }}</p>
            <code class="font-mono text-xs break-all">{{ setup.secret }}</code>
          </div>
        </div>
        <Field :data-invalid="!!tfError || undefined">
          <FieldLabel for="tf-code">{{ t('Code') }}</FieldLabel>
          <Input id="tf-code" v-model="code" class="font-mono tracking-widest" inputmode="numeric" autocomplete="one-time-code" maxlength="7" />
          <FieldError v-if="tfError">{{ tfError }}</FieldError>
        </Field>
      </form>
      <DialogFooter>
        <Button variant="outline" @click="setup = null">{{ t('Cancel') }}</Button>
        <Button type="submit" form="tf-on" :disabled="tfBusy || code.trim().length < 6"><Spinner v-if="tfBusy" data-icon="inline-start" /> {{ t('Turn on') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="disabling">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('Turn off two-factor sign-in') }}</DialogTitle>
        <DialogDescription>{{ t('Confirm with your password and a current code.') }}</DialogDescription>
      </DialogHeader>
      <form id="tf-off" class="flex flex-col gap-4" @submit.prevent="disable">
        <Field>
          <FieldLabel for="tf-pw">{{ t('Password') }}</FieldLabel>
          <Input id="tf-pw" v-model="confirmPw" type="password" autocomplete="current-password" />
        </Field>
        <Field :data-invalid="!!tfError || undefined">
          <FieldLabel for="tf-code2">{{ t('Code') }}</FieldLabel>
          <Input id="tf-code2" v-model="code" class="font-mono tracking-widest" inputmode="numeric" maxlength="7" />
          <FieldError v-if="tfError">{{ tfError }}</FieldError>
        </Field>
      </form>
      <DialogFooter>
        <Button variant="outline" @click="disabling = false">{{ t('Cancel') }}</Button>
        <Button type="submit" form="tf-off" variant="destructive" :disabled="tfBusy || !confirmPw || code.trim().length < 6">
          <Spinner v-if="tfBusy" data-icon="inline-start" /> {{ t('Turn off') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
