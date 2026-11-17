<script setup lang="ts">
import { SearchIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import InstanceTable from '@/components/app/InstanceTable.vue'
import LoadError from '@/components/LoadError.vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useResource } from '@/composables/useResource'
import { t } from '@/lib/i18n'
import type { Instance } from '@/lib/types'

const { data, error } = useResource<{ instances: Instance[] }>('/api/admin/instances', (d) =>
  d?.instances.some((i) => ['creating', 'reinstalling', 'deleting'].includes(i.status)) ? 3000 : 15_000,
)
const q = ref('')
const items = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const all = data.value?.instances ?? []
  return needle
    ? all.filter((i) => [i.name, i.owner?.username, i.ipv4, i.image.name, String(i.sshPort)].some((v) => v?.toLowerCase().includes(needle)))
    : all
})
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('All containers') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('Every container on this server. Open one to manage it as its owner would.') }}</p>
    </div>
    <InputGroup class="w-full sm:w-72">
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput v-model="q" :placeholder="t('Search name, owner, IP, port…')" />
    </InputGroup>
  </div>
  <LoadError :message="error" />
  <template v-if="data">
    <InstanceTable v-if="items.length" :items="items" show-owner />
    <p v-else class="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">{{ t('No containers.') }}</p>
  </template>
  <Skeleton v-else-if="!error" class="h-64 rounded-xl" />
</template>
