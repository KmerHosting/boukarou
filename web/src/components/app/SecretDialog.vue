<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/lib/i18n'
import CopyLine from './CopyLine.vue'

defineProps<{ title: string; description: string; secret: string | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Dialog :open="!!secret" @update:open="(value: boolean) => { if (!value) emit('close') }">
    <DialogContent v-if="secret" class="sm:max-w-md" @interact-outside.prevent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <CopyLine :text="secret" />
      <DialogFooter>
        <Button @click="emit('close')">{{ t('I saved it') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
