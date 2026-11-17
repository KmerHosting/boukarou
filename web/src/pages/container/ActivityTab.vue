<script setup lang="ts">
import EventList from '@/components/app/EventList.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useResource } from '@/composables/useResource'
import type { EventItem, Instance } from '@/lib/types'

const props = defineProps<{ inst: Instance }>()
const { data } = useResource<{ events: EventItem[] }>(() => `/api/instances/${props.inst.id}/events`, 15_000)
</script>

<template>
  <Card class="py-0">
    <CardContent class="px-0">
      <EventList v-if="data" :events="data.events" />
      <div v-else class="flex flex-col gap-2 p-4"><Skeleton v-for="n in 6" :key="n" class="h-6" /></div>
    </CardContent>
  </Card>
</template>
