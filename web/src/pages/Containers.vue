<script setup lang="ts">
import { PlusIcon } from '@lucide/vue'
import InstanceTable from '@/components/app/InstanceTable.vue'
import QuotaStrip from '@/components/app/QuotaStrip.vue'
import LoadError from '@/components/LoadError.vue'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useResource } from '@/composables/useResource'
import { t } from '@/lib/i18n'
import type { Instance, Limits, Usage } from '@/lib/types'

const busy = (i: Instance) => ['creating', 'reinstalling', 'deleting'].includes(i.status) || !!i.busy
const { data, error } = useResource<{ instances: Instance[]; usage: Usage; limits: Limits }>('/api/overview', (d) =>
  d?.instances.some(busy) ? 3000 : 15_000,
)
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('My containers') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('Your Linux containers, with root access over SSH and in the browser.') }}</p>
    </div>
    <Button as-child>
      <RouterLink to="/new"><PlusIcon data-icon="inline-start" /> {{ t('New container') }}</RouterLink>
    </Button>
  </div>

  <LoadError :message="error" />

  <template v-if="data">
    <QuotaStrip :usage="data.usage" :limits="data.limits" />
    <InstanceTable v-if="data.instances.length" :items="data.instances" />
    <Empty v-else class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{{ t('No containers yet') }}</EmptyTitle>
        <EmptyDescription>{{ t('Create your first one: pick a system and the resources it needs.') }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button as-child>
          <RouterLink to="/new"><PlusIcon data-icon="inline-start" /> {{ t('New container') }}</RouterLink>
        </Button>
      </EmptyContent>
    </Empty>
  </template>
  <template v-else-if="!error">
    <Skeleton class="h-20 rounded-xl" />
    <Skeleton class="h-64 rounded-xl" />
  </template>
</template>
