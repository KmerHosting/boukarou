<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<template>
  <img src="/favicon.svg" alt="" :width="size ?? 32" :height="size ?? 32" class="shrink-0" />
</template>
