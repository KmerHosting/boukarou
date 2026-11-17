<script setup lang="ts">
import { HistoryIcon, RotateCcwIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import ConfirmDialog from '@/components/app/ConfirmDialog.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { del, messageOf, post } from '@/lib/api'
import { date } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Detail, Snapshot } from '@/lib/types'

const props = defineProps<{ d: Detail }>()
const emit = defineEmits<{ changed: [] }>()
const inst = computed(() => props.d.instance)
const list = useResource<{ snapshots: Snapshot[] }>(() => `/api/instances/${inst.value.id}/snapshots`)
const snaps = computed(() => [...(list.data.value?.snapshots ?? [])].sort((a, b) => b.createdAt - a.createdAt))
const max = computed(() => props.d.limits.maxSnapshots)
const full = computed(() => max.value != null && snaps.value.length >= max.value)

const name = ref('')
const busy = ref(false)
const restoring = ref<Snapshot | null>(null)
const removing = ref<Snapshot | null>(null)
const restoreOpen = computed({ get: () => !!restoring.value, set: (v) => { if (!v) restoring.value = null } })
const removeOpen = computed({ get: () => !!removing.value, set: (v) => { if (!v) removing.value = null } })

async function create() {
  busy.value = true
  try {
    await post(`/api/instances/${inst.value.id}/snapshots`, { name: name.value.trim() || undefined })
    name.value = ''
    toast.success(t('Snapshot created'))
    await list.reload()
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  busy.value = false
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><HistoryIcon class="size-4" /> {{ t('Take a snapshot') }}</CardTitle>
      <CardDescription>{{ t('A snapshot saves the whole disk as it is now. Restoring it rolls the container back.') }}</CardDescription>
      <CardAction class="text-muted-foreground font-mono text-sm">{{ snaps.length }} / {{ max == null ? '∞' : max }}</CardAction>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <form class="flex gap-2" @submit.prevent="create">
        <Input v-model="name" class="font-mono" :placeholder="t('Name (optional)')" maxlength="63" :disabled="full" />
        <Button type="submit" :disabled="busy || full">
          <Spinner v-if="busy" data-icon="inline-start" /><HistoryIcon v-else data-icon="inline-start" /> {{ t('Take snapshot') }}
        </Button>
      </form>
      <p v-if="full" class="text-muted-foreground text-sm">{{ t('You reached your snapshot limit for this container. Delete one to take another.') }}</p>
    </CardContent>
  </Card>

  <Card class="py-0">
    <CardContent class="px-0">
      <div v-if="!list.data.value" class="flex flex-col gap-2 p-4"><Skeleton v-for="n in 3" :key="n" class="h-10" /></div>
      <p v-else-if="!snaps.length" class="text-muted-foreground p-6 text-sm">{{ t('No snapshots yet.') }}</p>
      <ul v-else class="divide-y">
        <li v-for="s in snaps" :key="s.name" class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm">{{ s.name }}</div>
            <div class="text-muted-foreground text-xs">{{ date(s.createdAt) }}</div>
          </div>
          <Button size="sm" variant="outline" @click="restoring = s"><RotateCcwIcon data-icon="inline-start" /> {{ t('Restore') }}</Button>
          <Button size="sm" variant="outline" class="text-destructive" @click="removing = s"><Trash2Icon data-icon="inline-start" /> {{ t('Delete') }}</Button>
        </li>
      </ul>
    </CardContent>
  </Card>

  <ConfirmDialog
    v-model:open="restoreOpen"
    :title="t('Restore {s}?', { s: restoring?.name ?? '' })"
    :description="t('Everything written since {d} is lost. The container restarts in the state it had then.', { d: date(restoring?.createdAt) })"
    :action="t('Restore snapshot')"
    :word="inst.name"
    destructive
    :confirm="async () => {
      await post(`/api/instances/${inst.id}/snapshots/${encodeURIComponent(restoring!.name)}/restore`)
      toast.success(t('Snapshot restored'))
      emit('changed')
    }"
  />
  <ConfirmDialog
    v-model:open="removeOpen"
    :title="t('Delete {s}?', { s: removing?.name ?? '' })"
    :description="t('The snapshot is removed for good.')"
    :action="t('Delete snapshot')"
    destructive
    :confirm="async () => {
      await del(`/api/instances/${inst.id}/snapshots/${encodeURIComponent(removing!.name)}`)
      await list.reload()
    }"
  />
</template>
