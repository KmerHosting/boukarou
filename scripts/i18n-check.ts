// Lists strings passed to t() that have no French translation in web/src/lib/fr.ts.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
const root = process.argv[2] ?? "web/src"
const fr = readFileSync(join(root, 'lib/fr.ts'), 'utf8')
const files: string[] = []
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!p.includes('components/ui')) walk(p) } else if (/\.(vue|ts)$/.test(f) && !p.endsWith('fr.ts')) files.push(p) } }
walk(root)
const keys = new Set<string>()
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.add(m[2]!.replace(/\\'/g, "'"))
  for (const m of s.matchAll(/(?:label|hint|title): '([^']+)'/g)) keys.add(m[1]!)
  for (const m of s.matchAll(/\['[a-z]+', '([^']+)'\]/g)) keys.add(m[1]!)
}
const has = (k: string) => fr.includes(JSON.stringify(k)) || fr.includes(`'${k.replace(/'/g, "\\'")}'`) || fr.includes(`"${k}"`) || new RegExp(`^\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m").test(fr)
for (const k of [...keys].sort()) if (!has(k)) console.log(k)
