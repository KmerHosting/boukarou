<script setup lang="ts">
import { CpuIcon, HardDriveIcon, MemoryStickIcon } from '@lucide/vue'
import { memory } from '@/lib/format'

defineProps<{ cpu: number; memoryMb: number; diskGb: number }>()
</script>

<template>
  <!-- Each resource stands on its own, set apart by an icon and spacing rather than a separator. -->
  <span class="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
    <span class="inline-flex items-center gap-1"><CpuIcon class="size-3.5 opacity-60" />{{ cpu }} vCPU</span>
    <span class="inline-flex items-center gap-1"><MemoryStickIcon class="size-3.5 opacity-60" />{{ memory(memoryMb) }}</span>
    <span class="inline-flex items-center gap-1"><HardDriveIcon class="size-3.5 opacity-60" />{{ diskGb }} GB</span>
  </span>
</template>
