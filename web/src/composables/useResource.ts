import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, messageOf } from '@/lib/api'

/**
 * Loads a resource and keeps it fresh. `poll` is a delay in ms, or a function of the
 * current data that returns one (or false to stop), so busy containers refresh faster.
 */
export function useResource<T>(
  path: string | (() => string),
  poll: number | false | ((data: T | null) => number | false) = false,
) {
  const data = ref<T | null>(null) as Ref<T | null>
  const error = ref('')
  const loading = ref(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  let request = 0
  let stopped = false

  const url = () => (typeof path === 'function' ? path() : path)

  async function reload() {
    const current = ++request
    clearTimeout(timer)
    try {
      const result = await api<T>(url())
      if (current !== request) return
      data.value = result
      error.value = ''
    } catch (failure) {
      if (current === request) error.value = messageOf(failure)
    } finally {
      if (current === request) {
        loading.value = false
        schedule()
      }
    }
  }

  function schedule() {
    if (stopped) return
    const delay = typeof poll === 'function' ? poll(data.value) : poll
    if (delay) timer = setTimeout(() => (document.hidden ? schedule() : void reload()), delay)
  }

  onMounted(reload)
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
    request++
  })
  if (typeof path === 'function') {
    watch(path, () => {
      loading.value = true
      void reload()
    })
  }

  return { data, error, loading, reload }
}
