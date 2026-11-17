<script setup lang="ts">
import BrandLogo from '@/components/app/BrandLogo.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

defineProps<{ title: string; description: string }>()
</script>

<template>
  <div class="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6">
    <div class="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <BrandLogo :size="36" />
      Boukarou
    </div>
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription>{{ description }}</CardDescription>
      </CardHeader>
      <CardContent>
        <slot />
      </CardContent>
    </Card>
  </div>
</template>
