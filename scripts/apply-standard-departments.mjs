/**
 * Apply DEPT-001 … DEPT-009 (run from repo root):
 *   node scripts/apply-standard-departments.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../apps/web/.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
const companyId = process.env.COMPANY_ID || '00000000-0000-0000-0000-000000000001'

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or key in apps/web/.env')
  process.exit(1)
}

const STANDARD = [
  'Accounts Dept',
  'ADMIN',
  'C-Suite',
  'DESIGNING',
  'Designs Dept',
  'EMBROIDERY',
  'Main Godown',
  'Online Dept',
  'PACKING',
]

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-')
const fmt = (n) => `DEPT-${String(n).padStart(3, '0')}`

const supabase = createClient(url, key)

function findMatch(name, pool, used) {
  const key = norm(name)
  let m = pool.find((d) => !used.has(d.id) && norm(d.name) === key)
  if (m) return m
  m = pool.find(
    (d) =>
      !used.has(d.id) &&
      (norm(d.name).includes(key) || key.includes(norm(d.name)))
  )
  return m ?? null
}

const { data: rows, error } = await supabase.from('departments').select('id, code, name').eq('company_id', companyId)
if (error) {
  console.error(error.message)
  process.exit(1)
}

const pool = [...(rows ?? [])]
const used = new Set()
let created = 0
let updated = 0

for (let i = 0; i < STANDARD.length; i++) {
  const name = STANDARD[i]
  const code = fmt(i + 1)
  const match = findMatch(name, pool, used)
  if (match) {
    used.add(match.id)
    if (match.code !== code || match.name !== name) {
      const { error: upErr } = await supabase.from('departments').update({ code, name, is_active: true }).eq('id', match.id)
      if (upErr) {
        console.error(`${name}:`, upErr.message)
        process.exit(1)
      }
      console.log(`Updated ${match.name} (${match.code}) → ${code} ${name}`)
      updated++
    } else {
      console.log(`OK ${code} ${name}`)
    }
  } else {
    const { error: insErr } = await supabase.from('departments').insert({ company_id: companyId, code, name, is_active: true })
    if (insErr) {
      console.error(`${name}:`, insErr.message)
      process.exit(1)
    }
    console.log(`Created ${code} ${name}`)
    created++
  }
}

let n = STANDARD.length + 1
for (const d of pool) {
  if (used.has(d.id)) continue
  const code = fmt(n++)
  if (d.code === code) continue
  const { error: upErr } = await supabase.from('departments').update({ code }).eq('id', d.id)
  if (upErr) {
    console.error(`${d.name}:`, upErr.message)
    process.exit(1)
  }
  console.log(`Renumbered ${d.name} → ${code}`)
  updated++
}

const { data: final } = await supabase.from('departments').select('code, name').eq('company_id', companyId).order('code')
console.log('\nDone:', created, 'created,', updated, 'updated\n')
for (const r of final ?? []) console.log(r.code, r.name)
