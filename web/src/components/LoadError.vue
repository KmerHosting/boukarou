<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { t } from '@/lib/i18n'

defineProps<{ message: string }>()
</script>

<template>
  <Alert v-if="message" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>{{ t('This could not be loaded') }}</AlertTitle>
    <AlertDescription>{{ message }}</AlertDescription>
  </Alert>
</template>
