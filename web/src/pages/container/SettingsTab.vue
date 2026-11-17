<script setup lang="ts">
import { KeyRoundIcon, RotateCwIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import ConfirmDialog from '@/components/app/ConfirmDialog.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useResource } from '@/composables/useResource'
import { del, messageOf, post } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { Detail, Image } from '@/lib/types'

const props = defineProps<{ d: Detail }>()
const emit = defineEmits<{ changed: []; password: [string] }>()
const router = useRouter()
const inst = computed(() => props.d.instance)
const images = useResource<{ images: Image[] }>('/api/images')
const imageList = computed(() => {
  const list = images.data.value?.images ?? []
  return list.some((i) => i.id === inst.value.image.id) ? list : [inst.value.image, ...list]
})

const pwBusy = ref(false)
const imageId = ref(inst.value.image.id)
const sshKey = ref('')
const reinstallOpen = ref(false)
const deleteOpen = ref(false)
const running = computed(() => inst.value.status === 'running')

async function newPassword() {
  pwBusy.value = true
  try {
    const r = await post<{ password: string }>(`/api/instances/${inst.value.id}/root-password`)
    emit('password', r.password)
  } catch (failure) {
    toast.error(messageOf(failure))
  }
  pwBusy.value = false
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><KeyRoundIcon class="size-4" /> {{ t('Root password') }}</CardTitle>
      <CardDescription>{{ t('Generate a new root password. The old one stops working right away.') }}</CardDescription>
      <CardAction>
        <Button variant="outline" :disabled="!running || pwBusy" @click="newPassword">
          <Spinner v-if="pwBusy" data-icon="inline-start" /><KeyRoundIcon v-else data-icon="inline-start" /> {{ t('New password') }}
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent v-if="!running"><p class="text-muted-foreground text-sm">{{ t('Start the container first.') }}</p></CardContent>
  </Card>

  <Card class="border-destructive/30">
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><RotateCwIcon class="size-4" /> {{ t('Reinstall') }}</CardTitle>
      <CardDescription>{{ t('Wipe the disk and start again from a fresh system. Name, IP address, SSH port and domains are kept.') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{{ t('Operating system') }}</FieldLabel>
          <Select v-model="imageId">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="i in imageList" :key="i.id" :value="i.id">{{ i.name }} {{ i.version }}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel for="ri-key">{{ t('SSH public key (optional)') }}</FieldLabel>
          <Input id="ri-key" v-model="sshKey" class="font-mono" placeholder="ssh-ed25519 AAAA…" spellcheck="false" />
          <FieldDescription v-if="inst.hasSshKey">{{ t('Leave empty to keep the current key.') }}</FieldDescription>
        </Field>
      </div>
      <div>
        <Button variant="destructive" :disabled="!!inst.busy || inst.status === 'reinstalling'" @click="reinstallOpen = true">
          <RotateCwIcon data-icon="inline-start" /> {{ t('Reinstall…') }}
        </Button>
      </div>
    </CardContent>
  </Card>

  <Card class="border-destructive/30">
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><Trash2Icon class="size-4" /> {{ t('Delete container') }}</CardTitle>
      <CardDescription>{{ t('Removes the container, its snapshots and its domains. This cannot be undone.') }}</CardDescription>
      <CardAction>
        <Button variant="destructive" :disabled="!!inst.busy" @click="deleteOpen = true"><Trash2Icon data-icon="inline-start" /> {{ t('Delete…') }}</Button>
      </CardAction>
    </CardHeader>
  </Card>

  <ConfirmDialog
    v-model:open="reinstallOpen"
    :title="t('Reinstall {n}?', { n: inst.name })"
    :description="t('All files on the container are erased. Take a snapshot first if you may need them.')"
    :word="inst.name"
    :action="t('Reinstall')"
    destructive
    :confirm="async () => {
      await post(`/api/instances/${inst.id}/reinstall`, { imageId, sshKey: sshKey.trim() || undefined, confirm: inst.name })
      sshKey = ''
      emit('changed')
      await router.replace(`/c/${inst.id}`)
    }"
  />
  <ConfirmDialog
    v-model:open="deleteOpen"
    :title="t('Delete {n}?', { n: inst.name })"
    :description="t('The container, its snapshots and its domains are removed for good.')"
    :word="inst.name"
    :action="t('Delete container')"
    destructive
    :confirm="async () => {
      await del(`/api/instances/${inst.id}`, { confirm: inst.name })
      toast.success(t('{n} deleted', { n: inst.name }))
      await router.push('/')
    }"
  />
</template>
