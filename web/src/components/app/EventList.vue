<script setup lang="ts">
import { CircleAlertIcon, TriangleAlertIcon } from '@lucide/vue'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { EVENT_LABELS } from '@/lib/events'
import { shortDate } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { EventItem } from '@/lib/types'

defineProps<{ events: EventItem[]; showUser?: boolean }>()
</script>

<template>
  <ul v-if="events.length" class="divide-y">
    <li v-for="e in events" :key="e.id" class="flex items-start gap-3 px-4 py-2.5 text-sm">
      <time class="text-muted-foreground w-28 shrink-0 font-mono text-xs leading-5 tabular-nums">{{ shortDate(e.at) }}</time>
      <CircleAlertIcon v-if="e.level === 'error'" class="text-destructive mt-0.5 size-4 shrink-0" />
      <TriangleAlertIcon v-else-if="e.level === 'warning'" class="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div class="min-w-0 flex-1">
        <span class="font-medium">{{ t(EVENT_LABELS[e.action] ?? e.action) }}</span>
        <span v-if="e.message" class="text-muted-foreground break-words"> · {{ e.message }}</span>
      </div>
      <span v-if="showUser && (e.user || e.actor)" class="text-muted-foreground shrink-0 font-mono text-xs">{{ e.actor ?? e.user }}</span>
    </li>
  </ul>
  <Empty v-else>
    <EmptyHeader>
      <EmptyTitle>{{ t('Nothing yet') }}</EmptyTitle>
      <EmptyDescription>{{ t('Actions show up here as they happen.') }}</EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
