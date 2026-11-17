<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { refreshSession } from '@/composables/useSession'
import { messageOf, post } from '@/lib/api'
import { t } from '@/lib/i18n'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const code = ref('')
const ticket = ref<string | null>(null)
const error = ref('')
const busy = ref(false)

async function done() {
  await refreshSession()
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/'
  await router.replace(next)
}

async function signIn() {
  busy.value = true
  error.value = ''
  try {
    const r = await post<{ twoFactor?: boolean; ticket?: string }>('/api/auth/login', { username: username.value, password: password.value })
    if (r.twoFactor) {
      ticket.value = r.ticket!
      setTimeout(() => document.getElementById('code')?.focus(), 50)
    } else await done()
  } catch (failure) {
    error.value = messageOf(failure)
  }
  busy.value = false
}

async function verify() {
  busy.value = true
  error.value = ''
  try {
    await post('/api/auth/2fa', { ticket: ticket.value, code: code.value })
    await done()
  } catch (failure) {
    error.value = messageOf(failure)
    if (/expired|expiré/i.test(error.value)) ticket.value = null
  }
  busy.value = false
}
</script>

<template>
  <AuthCard
    v-if="!ticket"
    :title="t('Sign in')"
    :description="t('Use the username and password your administrator gave you.')"
  >
    <form @submit.prevent="signIn">
      <FieldGroup>
        <Field>
          <FieldLabel for="username">{{ t('Username') }}</FieldLabel>
          <Input id="username" v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus required />
        </Field>
        <Field :data-invalid="!!error || undefined">
          <FieldLabel for="password">{{ t('Password') }}</FieldLabel>
          <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
          <FieldError v-if="error">{{ error }}</FieldError>
        </Field>
        <Button type="submit" :disabled="busy || !username || !password">
          <Spinner v-if="busy" data-icon="inline-start" />
          {{ t('Sign in') }}
        </Button>
      </FieldGroup>
    </form>
  </AuthCard>
  <AuthCard v-else :title="t('Two-factor sign-in')" :description="t('Enter the 6-digit code from your authenticator app.')">
    <form @submit.prevent="verify">
      <FieldGroup>
        <Field :data-invalid="!!error || undefined">
          <FieldLabel for="code">{{ t('Code') }}</FieldLabel>
          <Input id="code" v-model="code" class="text-center font-mono text-lg tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required />
          <FieldError v-if="error">{{ error }}</FieldError>
        </Field>
        <Button type="submit" :disabled="busy || code.replace(/\s/g, '').length < 6">
          <Spinner v-if="busy" data-icon="inline-start" />
          {{ t('Verify') }}
        </Button>
        <Button type="button" variant="ghost" @click="ticket = null; code = ''; error = ''">{{ t('Back') }}</Button>
      </FieldGroup>
    </form>
  </AuthCard>
</template>
