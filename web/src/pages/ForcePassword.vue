<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { refreshSession, user } from '@/composables/useSession'
import { messageOf, post } from '@/lib/api'
import { t } from '@/lib/i18n'

const router = useRouter()
const current = ref('')
const password = ref('')
const repeat = ref('')
const error = ref('')
const busy = ref(false)

async function save() {
  if (password.value !== repeat.value) {
    error.value = t('The two passwords do not match.')
    return
  }
  busy.value = true
  error.value = ''
  try {
    await post('/api/account/password', { current: current.value, password: password.value })
    await refreshSession()
    await router.replace('/')
  } catch (failure) {
    error.value = messageOf(failure)
  }
  busy.value = false
}

async function signOut() {
  await post('/api/auth/logout').catch(() => null)
  user.value = null
  await router.push('/login')
}
</script>

<template>
  <AuthCard :title="t('Choose your password')" :description="t('Your administrator gave you a temporary password. Choose your own before you continue.')">
    <form @submit.prevent="save">
      <FieldGroup>
        <Field>
          <FieldLabel for="current">{{ t('Temporary password') }}</FieldLabel>
          <Input id="current" v-model="current" type="password" autocomplete="current-password" required />
        </Field>
        <Field>
          <FieldLabel for="new">{{ t('New password') }}</FieldLabel>
          <Input id="new" v-model="password" type="password" autocomplete="new-password" minlength="10" required />
          <FieldDescription>{{ t('At least 10 characters.') }}</FieldDescription>
        </Field>
        <Field :data-invalid="!!error || undefined">
          <FieldLabel for="repeat">{{ t('Repeat new password') }}</FieldLabel>
          <Input id="repeat" v-model="repeat" type="password" autocomplete="new-password" required />
          <FieldError v-if="error">{{ error }}</FieldError>
        </Field>
        <Button type="submit" :disabled="busy || password.length < 10 || !current">
          <Spinner v-if="busy" data-icon="inline-start" />
          {{ t('Save and continue') }}
        </Button>
        <Button type="button" variant="ghost" @click="signOut">{{ t('Sign out') }}</Button>
      </FieldGroup>
    </form>
  </AuthCard>
</template>
