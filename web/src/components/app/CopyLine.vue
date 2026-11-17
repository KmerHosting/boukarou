<script setup lang="ts">
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'

const props = defineProps<{ text: string }>()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // The browser refused; the text stays selectable.
  }
}
</script>

<template>
  <div class="bg-muted/60 flex items-center gap-2 rounded-md border py-1 pr-1 pl-3">
    <code class="min-w-0 flex-1 truncate font-mono text-sm select-all">{{ text }}</code>
    <Button variant="ghost" size="icon-sm" :aria-label="copied ? t('Copied') : t('Copy')" @click="copy">
      <CheckIcon v-if="copied" />
      <CopyIcon v-else />
    </Button>
  </div>
</template>
