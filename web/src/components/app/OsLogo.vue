<script setup lang="ts">
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siDevuan, siFedora,
  siGentoo, siLinux, siLinuxmint, siOpensuse, siRockylinux, siUbuntu,
} from 'simple-icons'
import { computed } from 'vue'

const props = defineProps<{ family: string; size?: 'sm' | 'lg' }>()

// Official distribution logos (simple-icons, CC0). Systems without a published mark show Tux.
const LOGOS: Record<string, { path: string; hex: string }> = {
  ubuntu: siUbuntu, debian: siDebian, alpine: siAlpinelinux, rocky: siRockylinux, alma: siAlmalinux,
  centos: siCentos, fedora: siFedora, arch: siArchlinux, gentoo: siGentoo, opensuse: siOpensuse,
  mint: siLinuxmint, devuan: siDevuan,
}

const logo = computed(() => LOGOS[props.family] ?? siLinux)
const color = computed(() => (props.family in LOGOS ? `#${logo.value.hex}` : 'currentColor'))
</script>

<template>
  <span
    class="bg-muted/70 inline-flex shrink-0 items-center justify-center rounded-lg border"
    :class="size === 'lg' ? 'size-12' : 'size-9'"
  >
    <svg viewBox="0 0 24 24" :class="size === 'lg' ? 'size-7' : 'size-5'" aria-hidden="true">
      <path :d="logo.path" :fill="color" />
    </svg>
  </span>
</template>
