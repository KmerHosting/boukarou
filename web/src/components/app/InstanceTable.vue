<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { memory } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Instance } from '@/lib/types'
import InstanceStatus from './InstanceStatus.vue'
import OsLogo from './OsLogo.vue'

defineProps<{ items: Instance[]; showOwner?: boolean }>()
const router = useRouter()
</script>

<template>
  <Card class="py-0">
    <CardContent class="px-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t('Name') }}</TableHead>
            <TableHead v-if="showOwner">{{ t('Owner') }}</TableHead>
            <TableHead>{{ t('Status') }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t('Private IPv4') }}</TableHead>
            <TableHead class="hidden md:table-cell">SSH</TableHead>
            <TableHead class="text-right">{{ t('vCPU') }}</TableHead>
            <TableHead class="text-right">{{ t('Memory') }}</TableHead>
            <TableHead class="hidden pr-4 text-right sm:table-cell">{{ t('Disk') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="i in items" :key="i.id" class="cursor-pointer" @click="router.push(`/c/${i.id}`)">
            <TableCell class="w-full max-w-0 pl-4">
              <div class="flex items-center gap-3">
                <OsLogo :family="i.image.family" />
                <div class="min-w-0">
                  <RouterLink :to="`/c/${i.id}`" class="block truncate font-mono font-medium hover:underline" @click.stop>{{ i.name }}</RouterLink>
                  <span class="text-muted-foreground block truncate text-xs">{{ i.image.name }} {{ i.image.version }}</span>
                </div>
              </div>
            </TableCell>
            <TableCell v-if="showOwner" class="font-mono">{{ i.owner?.username }}</TableCell>
            <TableCell>
              <div class="flex flex-wrap items-center gap-1.5">
                <InstanceStatus :status="i.status" :busy="i.busy" />
                <Badge v-if="i.trafficBlocked" variant="destructive">{{ t('Traffic limited') }}</Badge>
              </div>
            </TableCell>
            <TableCell class="hidden font-mono md:table-cell">{{ i.ipv4 ?? '-' }}</TableCell>
            <TableCell class="hidden font-mono md:table-cell">{{ i.sshPort ? `:${i.sshPort}` : '-' }}</TableCell>
            <TableCell class="text-right font-mono tabular-nums">{{ i.cpu }}</TableCell>
            <TableCell class="text-right font-mono whitespace-nowrap tabular-nums">{{ memory(i.memoryMb) }}</TableCell>
            <TableCell class="hidden pr-4 text-right font-mono whitespace-nowrap tabular-nums sm:table-cell">{{ i.diskGb }} GB</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
