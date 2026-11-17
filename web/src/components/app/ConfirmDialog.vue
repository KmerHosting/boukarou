<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { messageOf } from '@/lib/api'
import { t } from '@/lib/i18n'

const props = defineProps<{
  title: string
  description: string
  action: string
  /** When set, the action only unlocks once this word is typed. */
  word?: string
  destructive?: boolean
  confirm: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { required: true })

const typed = ref('')
const busy = ref(false)
const error = ref('')
watch(open, (value) => {
  if (value) {
    typed.value = ''
    error.value = ''
  }
})

const ready = computed(() => !props.word || typed.value === props.word)

async function run() {
  busy.value = true
  error.value = ''
  try {
    await props.confirm()
    open.value = false
  } catch (failure) {
    error.value = messageOf(failure)
  }
  busy.value = false
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>{{ description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <form v-if="word" id="confirm-form" @submit.prevent="ready && run()">
        <Field>
          <FieldLabel for="confirm-word">{{ t('Type {w} to confirm', { w: word }) }}</FieldLabel>
          <Input id="confirm-word" v-model="typed" class="font-mono" autocomplete="off" spellcheck="false" />
        </Field>
      </form>
      <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">{{ t('Cancel') }}</AlertDialogCancel>
        <Button :variant="destructive ? 'destructive' : 'default'" :disabled="!ready || busy" @click="run">
          <Spinner v-if="busy" data-icon="inline-start" />
          {{ action }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
