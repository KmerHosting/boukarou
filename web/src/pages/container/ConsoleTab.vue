<script setup lang="ts">
import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { RotateCwIcon } from '@lucide/vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { t } from '@/lib/i18n'
import type { Instance } from '@/lib/types'

const props = defineProps<{ inst: Instance }>()
const box = ref<HTMLDivElement>()
const state = ref<'connecting' | 'open' | 'closed'>('connecting')
const attempt = ref(0)
let cleanup: (() => void) | null = null

function connect() {
  cleanup?.()
  cleanup = null
  if (props.inst.status !== 'running' || !box.value) return
  const term = new Terminal({
    fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
    fontSize: 13.5,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#121110', foreground: '#e9e6df', cursor: '#e07a52', selectionBackground: '#5a3a2c' },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(box.value)
  fit.fit()
  state.value = 'connecting'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/api/instances/${props.inst.id}/terminal?cols=${term.cols}&rows=${term.rows}`)
  ws.binaryType = 'arraybuffer'
  const decoder = new TextDecoder()
  ws.onopen = () => {
    state.value = 'open'
    term.focus()
  }
  ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : decoder.decode(new Uint8Array(e.data), { stream: true }))
  ws.onclose = () => {
    state.value = 'closed'
    term.write(`\r\n\x1b[2m${t('Session closed.')}\x1b[0m\r\n`)
  }
  const input = term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'i', d })))
  const resize = term.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'r', c: cols, r: rows })))
  const observer = new ResizeObserver(() => {
    try {
      fit.fit()
    } catch {
      // Hidden or detached: nothing to fit.
    }
  })
  observer.observe(box.value)
  cleanup = () => {
    observer.disconnect()
    input.dispose()
    resize.dispose()
    ws.onclose = null
    ws.close()
    term.dispose()
  }
}

watch([() => props.inst.id, () => props.inst.status === 'running', attempt, box], connect, { flush: 'post' })
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <Card v-if="inst.status !== 'running'">
    <CardContent class="text-muted-foreground text-sm">{{ t('Start the container to open a console.') }}</CardContent>
  </Card>
  <div v-else class="flex flex-col gap-2">
    <div class="flex min-h-8 items-center justify-between gap-2">
      <span class="text-muted-foreground flex items-center gap-2 text-sm">
        <span class="size-2 rounded-full" :class="state === 'open' ? 'bg-emerald-500' : state === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground/50'" />
        {{ state === 'open' ? t('Connected as root.') : state === 'connecting' ? t('Connecting…') : t('Disconnected.') }}
      </span>
      <Button v-if="state === 'closed'" size="sm" variant="outline" @click="attempt++"><RotateCwIcon data-icon="inline-start" /> {{ t('Reconnect') }}</Button>
    </div>
    <div class="overflow-hidden rounded-xl border bg-[#121110] p-2">
      <div ref="box" class="h-[min(70vh,560px)] w-full" />
    </div>
  </div>
</template>
