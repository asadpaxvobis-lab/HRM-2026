import { supabase } from '@/lib/supabase'

export const DEPARTMENT_CODE_PREFIX = 'DEP-'

/** Standard department list — codes DEP-001 … DEP-009 in this order. */
export const STANDARD_DEPARTMENTS = [
  'Accounts Dept',
  'ADMIN',
  'C-Suite',
  'DESIGNING',
  'Designs Dept',
  'EMBROIDERY',
  'Main Godown',
  'Online Dept',
  'PACKING',
] as const

const suffixRe = /^(?:DEPT|DEP)-(\d+)$/i

const normName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')

const NAME_ALIASES: Record<string, string> = {
  'accounts dept': 'Accounts Dept',
  admin: 'ADMIN',
  'c-suite': 'C-Suite',
  'c suite': 'C-Suite',
  designing: 'DESIGNING',
  'designs dept': 'Designs Dept',
  embroidery: 'EMBROIDERY',
  'main godown': 'Main Godown',
  'online dept': 'Online Dept',
  packing: 'PACKING',
}

export function canonicalDepartmentName(name: string): string {
  const key = normName(name)
  return NAME_ALIASES[key] ?? name.trim()
}

/** Numeric suffix from DEPT-001 / DEP-001 style codes. */
export function departmentCodeSuffix(code: string): number | null {
  const m = code.trim().match(suffixRe)
  return m ? parseInt(m[1], 10) : null
}

export function formatDepartmentCode(n: number): string {
  return `${DEPARTMENT_CODE_PREFIX}${String(n).padStart(3, '0')}`
}

export function duplicateDepartmentSuffixes(rows: { code: string }[]): number[] {
  const counts = new Map<number, number>()
  for (const row of rows) {
    const n = departmentCodeSuffix(row.code)
    if (n == null) continue
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n)
}

export function hasDepartmentCodeIssues(rows: { code: string; name?: string }[]): boolean {
  if (rows.length === 0) return false
  if (duplicateDepartmentSuffixes(rows).length > 0) return true
  if (
    rows.some((r) => {
      const code = r.code.trim()
      return /^DEPT-/i.test(code) || !suffixRe.test(code)
    })
  ) {
    return true
  }
  if (rows.length >= STANDARD_DEPARTMENTS.length) {
    for (let i = 0; i < STANDARD_DEPARTMENTS.length; i++) {
      const expected = formatDepartmentCode(i + 1)
      const stdName = STANDARD_DEPARTMENTS[i]!
      const std = normName(stdName)
      const row = rows.find((r) => normName(canonicalDepartmentName(r.name ?? '')) === std)
      if (!row || row.code.trim().toUpperCase() !== expected.toUpperCase()) return true
    }
  }
  return false
}

export async function nextDepartmentCode(companyId: string): Promise<string> {
  const { data, error } = await supabase.from('departments').select('code').eq('company_id', companyId)
  if (error) throw new Error(error.message)

  let maxN = 0
  for (const row of data ?? []) {
    const n = departmentCodeSuffix(String(row.code))
    if (n != null && n > maxN) maxN = n
  }
  return formatDepartmentCode(maxN + 1)
}

type DeptRow = { id: string; code: string; name: string }

function findMatch(
  canonical: string,
  pool: DeptRow[],
  usedIds: Set<string>
): DeptRow | null {
  const key = normName(canonical)
  const exact = pool.find((d) => !usedIds.has(d.id) && normName(canonicalDepartmentName(d.name)) === key)
  if (exact) return exact
  const loose = pool.find(
    (d) =>
      !usedIds.has(d.id) &&
      (normName(d.name).includes(key) || key.includes(normName(d.name)))
  )
  return loose ?? null
}

/**
 * Ensure standard 9 departments exist with codes DEP-001 … DEP-009; renumber any others after.
 */
export async function syncStandardDepartments(
  companyId: string
): Promise<{ created: number; updated: number; updates: { name: string; from: string; to: string }[] }> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('apply_standard_departments')
  if (!rpcErr && rpcData && typeof rpcData === 'object') {
    const created = Number((rpcData as { created?: number }).created ?? 0)
    const updated = Number((rpcData as { updated?: number }).updated ?? 0)
    return { created, updated, updates: [] }
  }
  if (rpcErr && !rpcErr.message.includes('Could not find the function')) {
    throw new Error(rpcErr.message)
  }

  const { data, error } = await supabase
    .from('departments')
    .select('id, code, name')
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)

  const pool = [...(data ?? [])] as DeptRow[]
  const usedIds = new Set<string>()
  const updates: { name: string; from: string; to: string }[] = []
  let created = 0
  let updated = 0

  // Temp codes first to avoid unique constraint when swapping DEP/DEPT suffixes
  for (const d of pool) {
    const temp = `TMP-${d.id.slice(0, 8)}`
    if (d.code === temp) continue
    const { error: tmpErr } = await supabase.from('departments').update({ code: temp }).eq('id', d.id)
    if (tmpErr) throw new Error(`${d.name}: ${tmpErr.message}`)
    d.code = temp
  }

  for (let i = 0; i < STANDARD_DEPARTMENTS.length; i++) {
    const name = STANDARD_DEPARTMENTS[i]
    const code = formatDepartmentCode(i + 1)
    const match = findMatch(name, pool, usedIds)

    if (match) {
      usedIds.add(match.id)
      if (match.code.trim().toUpperCase() !== code || match.name.trim() !== name) {
        const { error: upErr } = await supabase
          .from('departments')
          .update({ code, name, is_active: true })
          .eq('id', match.id)
        if (upErr) throw new Error(`${name}: ${upErr.message}`)
        updates.push({ name, from: match.code, to: code })
        updated++
        match.code = code
        match.name = name
      }
    } else {
      const { error: insErr } = await supabase.from('departments').insert({
        company_id: companyId,
        code,
        name,
        is_active: true,
      })
      if (insErr) throw new Error(`${name}: ${insErr.message}`)
      created++
      updates.push({ name, from: '—', to: code })
    }
  }

  let nextNum = STANDARD_DEPARTMENTS.length + 1
  for (const d of pool) {
    if (usedIds.has(d.id)) continue
    const code = formatDepartmentCode(nextNum++)
    if (d.code.trim().toUpperCase() === code.toUpperCase()) continue
    const { error: upErr } = await supabase.from('departments').update({ code }).eq('id', d.id)
    if (upErr) throw new Error(`${d.name}: ${upErr.message}`)
    updates.push({ name: d.name, from: d.code, to: code })
    updated++
  }

  return { created, updated, updates }
}

export async function renumberDepartmentCodes(
  companyId: string
): Promise<{ fixed: number; updates: { id: string; name: string; from: string; to: string }[] }> {
  const result = await syncStandardDepartments(companyId)
  return {
    fixed: result.created + result.updated,
    updates: result.updates.map((u) => ({
      id: '',
      name: u.name,
      from: u.from,
      to: u.to,
    })),
  }
}
