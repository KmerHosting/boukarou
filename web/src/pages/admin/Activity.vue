<script setup lang="ts">
import { HistoryIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import EventList from '@/components/app/EventList.vue'
import LoadError from '@/components/LoadError.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { EventItem } from '@/lib/types'

const { data, error } = useResource<{ events: EventItem[] }>('/api/admin/events')
const more = ref<EventItem[]>([])
const end = ref(false)
const busy = ref(false)
const events = computed(() => [...(data.value?.events ?? []), ...more.value])

async function loadOlder() {
  busy.value = true
  const r = await api<{ events: EventItem[] }>(`/api/admin/events?before=${events.value[events.value.length - 1]!.id}`).catch(() => ({ events: [] }))
  more.value.push(...r.events)
  if (r.events.length < 100) end.value = true
  busy.value = false
}
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold tracking-tight">{{ t('Activity') }}</h2>
    <p class="text-muted-foreground text-sm">{{ t('Sign-ins, container operations and admin changes. Kept for 180 days.') }}</p>
  </div>
  <LoadError :message="error" />
  <Card v-if="data" class="py-0">
    <CardContent class="px-0"><EventList :events="events" show-user /></CardContent>
  </Card>
  <Skeleton v-else-if="!error" class="h-96 rounded-xl" />
  <div v-if="events.length >= 100 && !end" class="flex justify-center">
    <Button variant="outline" :disabled="busy" @click="loadOlder">
      <Spinner v-if="busy" data-icon="inline-start" /><HistoryIcon v-else data-icon="inline-start" /> {{ t('Load older') }}
    </Button>
  </div>
</template>
