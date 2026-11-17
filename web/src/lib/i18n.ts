import { ref } from 'vue'
import { fr } from './fr'

export type Lang = 'en' | 'fr'
const KEY = 'boukarou-lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'fr') return saved
  } catch {
    // Private mode: fall back to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/** The current language. Reading it inside a template makes the template follow changes. */
export const lang = ref<Lang>(initial())
document.documentElement.lang = lang.value

export function setLang(value: Lang) {
  lang.value = value
  document.documentElement.lang = value
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // Not saved; the choice still applies until the page is closed.
  }
}

/** t('English text', { n: 2 }): English is the key, French comes from fr.ts. */
export function t(text: string, vars?: Record<string, string | number>) {
  let out = lang.value === 'fr' ? (fr[text] ?? text) : text
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  return out
}
