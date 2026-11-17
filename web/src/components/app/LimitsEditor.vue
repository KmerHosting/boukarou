<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n'
import { LIMIT_FIELDS, type LimitDraft } from '@/lib/limits'

const draft = defineModel<LimitDraft>({ required: true })

function setUnlimited(key: keyof LimitDraft, on: boolean) {
  draft.value = { ...draft.value, [key]: on ? '' : '1' }
}
</script>

<template>
  <div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
    <Field v-for="f in LIMIT_FIELDS" :key="f.key">
      <div class="flex items-center justify-between gap-2">
        <FieldLabel :for="`lim-${f.key}`">
          {{ t(f.label) }}<span v-if="f.unit" class="text-muted-foreground font-normal"> ({{ f.unit }})</span>
        </FieldLabel>
        <label class="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Checkbox :model-value="draft[f.key] === ''" @update:model-value="(on) => setUnlimited(f.key, on === true)" />
          {{ t('Unlimited') }}
        </label>
      </div>
      <Input
        :id="`lim-${f.key}`"
        :model-value="draft[f.key]"
        class="font-mono"
        inputmode="numeric"
        :disabled="draft[f.key] === ''"
        :placeholder="t('Unlimited')"
        @update:model-value="(v) => (draft = { ...draft, [f.key]: String(v).replace(/\D/g, '') })"
      />
      <FieldDescription>{{ t(f.hint) }}</FieldDescription>
    </Field>
  </div>
</template>
