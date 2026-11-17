<script setup lang="ts">
import { useColorMode } from '@vueuse/core'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { lang } from '@/lib/i18n'
import 'vue-sonner/style.css'

const mode = useColorMode({ storageKey: 'boukarou-theme' })
</script>

<template>
  <TooltipProvider>
    <!-- Keyed on the language so every label switches at once. -->
    <RouterView :key="lang" />
  </TooltipProvider>
  <Toaster :theme="mode === 'dark' ? 'dark' : 'light'" position="bottom-right" rich-colors />
</template>
