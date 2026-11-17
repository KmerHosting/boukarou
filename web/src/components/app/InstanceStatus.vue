<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n'

const props = defineProps<{ status: string; busy?: string | null }>()

const LABELS: Record<string, string> = {
  running: 'Running', stopped: 'Stopped', frozen: 'Frozen', failed: 'Failed', creating: 'Creating',
  reinstalling: 'Reinstalling', deleting: 'Deleting', unknown: 'Unknown',
}

const tone = computed(() => {
  if (props.busy || ['creating', 'reinstalling', 'deleting'].includes(props.status)) return 'bg-amber-500'
  if (props.status === 'running') return 'bg-emerald-500'
  if (props.status === 'failed') return 'bg-destructive'
  if (props.status === 'frozen') return 'bg-sky-500'
  return 'bg-muted-foreground/50'
})
</script>

<template>
  <Badge variant="outline" class="gap-1.5 font-normal">
    <span class="size-1.5 rounded-full" :class="[tone, busy || ['creating', 'reinstalling', 'deleting'].includes(status) ? 'animate-pulse' : '']" />
    {{ busy ? t('Working…') : t(LABELS[status] ?? 'Unknown') }}
  </Badge>
</template>
