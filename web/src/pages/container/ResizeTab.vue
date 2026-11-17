<script setup lang="ts">
import { CheckIcon, ExpandIcon, UndoIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { user } from '@/composables/useSession'
import { api, messageOf, post } from '@/lib/api'
import { memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Detail, Limits, Usage } from '@/lib/types'

const props = defineProps<{ d: Detail }>()
const emit = defineEmits<{ changed: [] }>()
const inst = computed(() => props.d.instance)
const own = computed(() => inst.value.userId === user.value?.id)

// Room comes from the owner's limits; an admin resizing someone else's container is checked by the server.
const overview = ref<{ usage: Usage; limits: Limits } | null>(null)
if (own.value) api<{ usage: Usage; limits: Limits }>('/api/overview').then((o) => (overview.value = o)).catch(() => null)

const cpu = ref(inst.value.cpu)
const mem = ref(inst.value.memoryMb)
const disk = ref(inst.value.diskGb)
const busy = ref(false)

const room = (limit: number | null | undefined, used: number | undefined, current: number) =>
  limit == null || used == null ? null : limit - used + current
const maxCpu = computed(() => (own.value ? room(overview.value?.limits.max_cpu, overview.value?.usage.cpu, inst.value.cpu) : null))
const maxMem = computed(() => (own.value ? room(overview.value?.limits.max_memory_mb, overview.value?.usage.memoryMb, inst.value.memoryMb) : null))
const maxDisk = computed(() => (own.value ? room(overview.value?.limits.max_disk_gb, overview.value?.usage.diskGb, inst.value.diskGb) : null))
const changed = computed(() => cpu.value !== inst.value.cpu || mem.value !== inst.value.memoryMb || disk.value !== inst.value.diskGb)

const clampInt = (value: string | number, min: number, max: number | null) => {
  const n = Math.round(Number(value) || min)
  return Math.max(min, max == null ? n : Math.min(n, max))
}

function reset() {
  cpu.value = inst.value.cpu
  mem.value = inst.value.memoryMb
  disk.value = inst.value.diskGb
}

async function apply() {
  busy.value = true
  try {
    await post(`/api/instances/${inst.value.id}/resize`, { cpu: cpu.value, memoryMb: mem.value, diskGb: disk.value })
    toast.success(t('Resources updated'))
    emit('changed')
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  busy.value = false
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><ExpandIcon class="size-4" /> {{ t('Resize') }}</CardTitle>
      <CardDescription>{{ t('CPU and memory change live, without a restart. Disk can only grow.') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel for="r-cpu">{{ t('vCPU') }}</FieldLabel>
          <Input id="r-cpu" type="number" min="1" class="font-mono" :model-value="cpu" @update:model-value="(v) => (cpu = clampInt(v, 1, maxCpu))" />
          <FieldDescription>{{ maxCpu != null ? t('Up to {n}', { n: maxCpu }) : t('No limit') }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="r-mem">{{ t('Memory (MB)') }}</FieldLabel>
          <Input id="r-mem" type="number" min="128" step="256" class="font-mono" :model-value="mem" @update:model-value="(v) => (mem = clampInt(v, 128, maxMem))" />
          <FieldDescription>{{ maxMem != null ? t('Up to {n}', { n: memory(maxMem) }) : t('No limit') }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="r-disk">{{ t('Disk (GB)') }}</FieldLabel>
          <Input id="r-disk" type="number" :min="inst.diskGb" step="5" class="font-mono" :model-value="disk" @update:model-value="(v) => (disk = clampInt(v, inst.diskGb, maxDisk))" />
          <FieldDescription>{{ maxDisk != null ? t('Up to {n} GB', { n: maxDisk }) : t('No limit') }}</FieldDescription>
        </Field>
      </div>
      <p v-if="!d.diskQuotaEnforced" class="text-muted-foreground text-sm">
        {{ t("This server's storage does not enforce disk sizes. The size is recorded but not applied.") }}
      </p>
      <div class="flex gap-2">
        <Button :disabled="!changed || busy" @click="apply">
          <Spinner v-if="busy" data-icon="inline-start" /><CheckIcon v-else data-icon="inline-start" /> {{ t('Apply') }}
        </Button>
        <Button v-if="changed" variant="ghost" @click="reset"><UndoIcon data-icon="inline-start" /> {{ t('Reset') }}</Button>
      </div>
    </CardContent>
  </Card>
</template>
