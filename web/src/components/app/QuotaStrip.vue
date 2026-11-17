<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Limits, Usage } from '@/lib/types'

const props = defineProps<{ usage: Usage; limits: Limits }>()

const items = computed(() => [
  { label: t('Containers'), used: props.usage.instances, max: props.limits.max_instances, fmt: (n: number) => String(n) },
  { label: t('vCPU'), used: props.usage.cpu, max: props.limits.max_cpu, fmt: (n: number) => String(n) },
  { label: t('Memory'), used: props.usage.memoryMb, max: props.limits.max_memory_mb, fmt: memory },
  { label: t('Disk'), used: props.usage.diskGb, max: props.limits.max_disk_gb, fmt: (n: number) => `${n} GB` },
])
</script>

<template>
  <Card class="py-4">
    <CardContent class="grid gap-x-6 gap-y-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in items" :key="i.label" class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-2 text-sm">
          <span class="text-muted-foreground">{{ i.label }}</span>
          <span class="font-mono font-medium tabular-nums">
            {{ i.fmt(i.used) }} <span class="text-muted-foreground font-normal">/ {{ i.max == null ? '∞' : i.fmt(i.max) }}</span>
          </span>
        </div>
        <Progress :model-value="i.max ? Math.min(100, (i.used / i.max) * 100) : 0" />
      </div>
    </CardContent>
  </Card>
</template>
