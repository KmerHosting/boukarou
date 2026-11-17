<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

defineProps<{ tone: 'good' | 'bad' | 'warn' | 'idle' }>()
</script>

<template>
  <Badge :variant="tone === 'bad' ? 'destructive' : tone === 'good' ? 'secondary' : 'outline'">
    <slot />
  </Badge>
</template>
