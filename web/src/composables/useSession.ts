import { ref } from 'vue'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'

export const user = ref<User | null>(null)
export const version = ref('')
export const ready = ref(false)

export async function refreshSession() {
  const me = await api<{ user: User | null; version: string }>('/api/auth/me').catch(() => ({ user: null, version: '' }))
  user.value = me.user
  version.value = me.version
  ready.value = true
  return me.user
}
