<script setup lang="ts">
import { ArrowDownIcon, ArrowUpIcon } from '@lucide/vue'

defineProps<{ down: string; up: string; downLabel?: string; upLabel?: string }>()
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
    <span class="inline-flex items-center gap-1"><ArrowDownIcon class="size-3.5 opacity-60" /><span class="font-mono">{{ down }}</span><span v-if="downLabel">{{ downLabel }}</span></span>
    <span class="inline-flex items-center gap-1"><ArrowUpIcon class="size-3.5 opacity-60" /><span class="font-mono">{{ up }}</span><span v-if="upLabel">{{ upLabel }}</span></span>
  </span>
</template>
