import { lang } from './i18n'

export function bytes(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`
}

export const rate = (n: number) => `${bytes(n)}/s`

export const memory = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(mb % 1024 ? 2 : 0)} GB` : `${mb} MB`)

const locale = () => (lang.value === 'fr' ? 'fr-FR' : 'en-GB')

export function date(ms: number | null | undefined) {
  if (!ms) return '-'
  return new Date(ms).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
}

export const shortTime = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
export const shortDate = (ms: number) =>
  new Date(ms).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ago(ms: number | null | undefined) {
  if (!ms) return '-'
  const s = Math.round((Date.now() - ms) / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' })
  if (s < 60) return rtf.format(-s, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

export function duration(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
