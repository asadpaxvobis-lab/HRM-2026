import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Calendar date in local timezone as YYYY-MM-DD (avoids UTC shift from toISOString). */
export function toLocalDateIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function codeNumericSuffix(code: string): number {
  const m = code.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : 0
}

/** Sort master records by trailing numeric suffix (DES-001, DEPT-002, BR-003, …). */
export function sortByMasterCode<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = codeNumericSuffix(a.code) - codeNumericSuffix(b.code)
    return diff !== 0 ? diff : a.code.localeCompare(b.code)
  })
}

/** Sort employees by EMP-0001, EMP-0002, … EMP-0010 order. */
export function sortByEmployeeCode<T extends { employee_code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = codeNumericSuffix(a.employee_code) - codeNumericSuffix(b.employee_code)
    return diff !== 0 ? diff : a.employee_code.localeCompare(b.employee_code)
  })
}

export function initialsFromName(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function avatarColorFor(seed: string): string {
  const palette = [
    'bg-orange-100 text-orange-800',
    'bg-amber-100 text-amber-800',
    'bg-emerald-100 text-emerald-800',
    'bg-sky-100 text-sky-800',
    'bg-violet-100 text-violet-800',
    'bg-rose-100 text-rose-800',
    'bg-teal-100 text-teal-800',
    'bg-indigo-100 text-indigo-800',
  ]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % palette.length
  return palette[hash]
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString()
}
