import * as XLSX from 'xlsx'
import { canonicalDepartmentName } from '@/lib/departmentCodes'

export type StaffImportSource = 'staff_status' | 'employee_directory'

/** One row from Staff Status Report or Employee Directory workbook. */
export type StaffImportRow = {
  rowIndex: number
  source: StaffImportSource
  sr: number | null
  employeeCode: string | null
  devicePin: number | null
  fullName: string
  firstName: string
  lastName: string
  cnic: string
  hasRealCnic: boolean
  designation: string
  department: string
  branch: string
  deviceLabel: string
  deviceIp: string | null
  mobile: string
  salary: number
  allowances: number
  address: string
  dateOfJoining: string | null
  dateOfBirth: string | null
  payFrequency: string | null
  reportsToName: string | null
}

export type StaffImportParseResult = {
  rows: StaffImportRow[]
  skipped: number
  source: StaffImportSource
}

const STAFF_STATUS_HEADER_MARKERS = ['device pin', 'name', 'cnic']
const DIRECTORY_HEADER_MARKERS = ['code', 'name', 'branch', 'department']

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export const normPersonName = (s: string) => norm(s)

const cellStr = (v: unknown): string => {
  if (v == null || v === '') return ''
  return String(v).trim()
}

const cellNum = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function extractDeviceIp(label: string): string | null {
  const m = label.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
  return m ? m[1] : null
}

export function splitPersonName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '-' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '-' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** Excel placeholder CNICs — must not be used to merge different employees. */
export function isPlaceholderCnic(digits: string): boolean {
  if (digits.length < 5) return true
  if (digits === '1000000000000') return true
  if (/^0+$/.test(digits)) return true
  if (/^90{10,}\d$/.test(digits)) return true
  if (/^(\d)\1{12}$/.test(digits)) return true
  return false
}

export function normalizeCnic(raw: string, devicePin: number | null): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 13) return digits.slice(0, 13)
  if (digits.length > 0) return digits.padStart(13, '0').slice(0, 13)
  const pin = devicePin != null && devicePin > 0 ? devicePin : 0
  return `9${String(pin).padStart(12, '0')}`.slice(0, 13)
}

function findStaffStatusHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const line = matrix[i].map((c) => cellStr(c).toLowerCase()).join('|')
    if (STAFF_STATUS_HEADER_MARKERS.every((m) => line.includes(m))) return i
  }
  return 4
}

function findEmployeeDirectoryHeader(matrix: unknown[][]): { headerIdx: number; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const cells = matrix[i] ?? []
    const col: Record<string, number> = {}
    cells.forEach((c, idx) => {
      const key = norm(cellStr(c))
      if (key) col[key] = idx
    })
    const line = cells.map((c) => cellStr(c).toLowerCase()).join('|')
    if (DIRECTORY_HEADER_MARKERS.every((m) => line.includes(m))) {
      return { headerIdx: i, col }
    }
  }
  return null
}

export function parseDateCell(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 1000) {
    const utc = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(utc)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function parsePhoneCell(v: unknown): string {
  const raw = cellStr(v)
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length <= 15) return digits
  return ''
}

function colIndex(col: Record<string, number>, ...keys: string[]): number {
  for (const k of keys) {
    if (col[k] != null) return col[k]
  }
  for (const k of keys) {
    const hit = Object.entries(col).find(([name]) => name === k)
    if (hit) return hit[1]
  }
  for (const k of keys) {
    const hit = Object.entries(col).find(([name]) => name.includes(k) && name !== 'device pin')
    if (hit) return hit[1]
  }
  return -1
}

function isSectionRow(cells: unknown[]): boolean {
  const pin = cellNum(cells[1])
  const name = cellStr(cells[2])
  const dept = cellStr(cells[5])
  if (name) return false
  if (pin != null) return false
  return !!dept
}

function dedupeImportRows(rows: StaffImportRow[], skippedStart: number): StaffImportParseResult {
  const deduped: StaffImportRow[] = []
  const seen = new Set<string>()
  let skipped = skippedStart
  const source = rows[0]?.source ?? 'staff_status'

  for (const row of rows) {
    const key = row.employeeCode
      ? `code:${row.employeeCode.toUpperCase()}`
      : row.hasRealCnic
        ? `cnic:${row.cnic}`
        : row.devicePin != null && row.devicePin > 0
          ? `pin:${row.devicePin}:${row.fullName.toLowerCase().replace(/\s+/g, ' ')}`
          : `name:${row.fullName.toLowerCase().replace(/\s+/g, ' ')}`
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    deduped.push(row)
  }

  return { rows: deduped, skipped, source }
}

/**
 * Parse Employee_Directory_Report workbook (sheet "Employee Directory").
 * Columns: Code, Name, Branch, Department, Designation, DOJ, CNIC, Phone, device pin, device, basic, allowences, Reports to, date of birth, pay frequency.
 */
export function parseEmployeeDirectoryWorkbook(buffer: ArrayBuffer): StaffImportParseResult | null {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames.find((n) => norm(n).includes('employee')) ?? wb.SheetNames[0]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
  })

  const header = findEmployeeDirectoryHeader(matrix)
  if (!header) return null

  const { headerIdx, col } = header
  const iCode = colIndex(col, 'code')
  const iName = colIndex(col, 'name')
  const iBranch = colIndex(col, 'branch')
  const iDept = colIndex(col, 'department')
  const iDes = colIndex(col, 'designation')
  const iDoj = colIndex(col, 'doj')
  const iCnic = colIndex(col, 'cnic')
  const iPhone = colIndex(col, 'phone')
  const iPin = colIndex(col, 'device pin')
  const iDevice = colIndex(col, 'device')
  const iBasic = colIndex(col, 'basic')
  const iAllow = colIndex(col, 'allowences', 'allowances')
  const iReports = colIndex(col, 'reports to')
  const iDob = colIndex(col, 'date of birth')
  const iPayFreq = colIndex(col, 'pay frequency')

  const rows: StaffImportRow[] = []
  let skipped = 0

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? []
    const fullName = iName >= 0 ? cellStr(cells[iName]) : ''
    const employeeCode = iCode >= 0 ? cellStr(cells[iCode]).trim() : ''
    if (!fullName && !employeeCode) {
      skipped++
      continue
    }
    if (!fullName) {
      skipped++
      continue
    }

    const { firstName, lastName } = splitPersonName(fullName)
    const devicePin = iPin >= 0 ? cellNum(cells[iPin]) : null
    const pinInt = devicePin != null ? Math.trunc(devicePin) : null
    const rawCnic = iCnic >= 0 ? cellStr(cells[iCnic]) : ''
    const cnicDigits = rawCnic.replace(/\D/g, '')
    const hasRealCnic = cnicDigits.length >= 13 && !isPlaceholderCnic(cnicDigits)
    const deviceLabel = iDevice >= 0 ? cellStr(cells[iDevice]) : ''

    rows.push({
      rowIndex: i + 1,
      source: 'employee_directory',
      sr: null,
      employeeCode: employeeCode || null,
      devicePin: pinInt,
      fullName,
      firstName,
      lastName,
      cnic: hasRealCnic ? cnicDigits.padStart(13, '0').slice(0, 13) : normalizeCnic(rawCnic, pinInt),
      hasRealCnic,
      designation: iDes >= 0 ? cellStr(cells[iDes]).trim() : '',
      department: iDept >= 0 ? cellStr(cells[iDept]).trim() : '',
      branch: iBranch >= 0 ? cellStr(cells[iBranch]).trim() : '',
      deviceLabel,
      deviceIp: extractDeviceIp(deviceLabel),
      mobile: iPhone >= 0 ? parsePhoneCell(cells[iPhone]) : '',
      salary: (iBasic >= 0 ? cellNum(cells[iBasic]) : null) ?? 0,
      allowances: (iAllow >= 0 ? cellNum(cells[iAllow]) : null) ?? 0,
      address: '',
      dateOfJoining: iDoj >= 0 ? parseDateCell(cells[iDoj]) : null,
      dateOfBirth: iDob >= 0 ? parseDateCell(cells[iDob]) : null,
      payFrequency: iPayFreq >= 0 ? cellStr(cells[iPayFreq]) || null : null,
      reportsToName: iReports >= 0 ? cellStr(cells[iReports]) || null : null,
    })
  }

  if (rows.length === 0) return { rows: [], skipped, source: 'employee_directory' }
  return dedupeImportRows(rows, skipped)
}

/**
 * Auto-detect Staff Status Report vs Employee Directory format.
 */
export function parseEmployeeWorkbook(buffer: ArrayBuffer): StaffImportParseResult {
  const directory = parseEmployeeDirectoryWorkbook(buffer)
  if (directory && directory.rows.length > 0) return directory
  return parseStaffStatusWorkbook(buffer)
}

/**
 * Parse Staff_Status_Report workbook (first sheet).
 * Expects columns: Sr#, Device PIN, Name, CNIC, Designation, Department, Branch, device, Mobile, Salary, Address.
 */
export function parseStaffStatusWorkbook(buffer: ArrayBuffer): StaffImportParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
  })

  const headerIdx = findStaffStatusHeaderRow(matrix)
  const rows: StaffImportRow[] = []
  let skipped = 0

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? []
    if (isSectionRow(cells)) {
      skipped++
      continue
    }

    const fullName = cellStr(cells[2])
    const devicePin = cellNum(cells[1])
    if (!fullName) {
      skipped++
      continue
    }

    const { firstName, lastName } = splitPersonName(fullName)
    const deviceLabel = cellStr(cells[7])
    const salary = cellNum(cells[9]) ?? 0
    const rawCnic = cellStr(cells[3])
    const cnicDigits = rawCnic.replace(/\D/g, '')
    const hasRealCnic = cnicDigits.length >= 5
    const pinInt = devicePin != null ? Math.trunc(devicePin) : null

    rows.push({
      rowIndex: i + 1,
      source: 'staff_status',
      sr: cellNum(cells[0]),
      employeeCode: null,
      devicePin: pinInt,
      fullName,
      firstName,
      lastName,
      cnic: hasRealCnic ? cnicDigits.padStart(13, '0').slice(0, 13) : normalizeCnic(rawCnic, pinInt),
      hasRealCnic,
      designation: cellStr(cells[4]),
      department: cellStr(cells[5]),
      branch: cellStr(cells[6]),
      deviceLabel,
      deviceIp: extractDeviceIp(deviceLabel),
      mobile: parsePhoneCell(cells[8]) || cellStr(cells[8]),
      salary,
      allowances: 0,
      address: cellStr(cells[10]),
      dateOfJoining: null,
      dateOfBirth: null,
      payFrequency: null,
      reportsToName: null,
    })
  }

  return dedupeImportRows(rows, skipped)
}

const DEPT_ALIASES: Record<string, string[]> = {
  'c-suite': ['c-suite', 'c suite', 'c - suite', 'csuite'],
  'designs dept': ['designs dept', 'designing', 'design dept'],
  'accounts dept': ['accounts dept', 'accounts department', 'accounts'],
  'online dept': ['online dept', 'online department', 'online'],
  admin: ['admin', 'administration'],
  stiching: ['stiching', 'stitching', 'stiching dept'],
}

const BRANCH_ALIASES: Record<string, string[]> = {
  office: ['office', 'head office', 'main office', 'hq'],
}

function aliasKeys(label: string, aliases: Record<string, string[]>): string[] {
  const key = norm(label)
  const keys = new Set<string>([key])
  for (const [canonical, variants] of Object.entries(aliases)) {
    if (variants.some((v) => v === key || key.includes(v) || v.includes(key))) {
      keys.add(canonical)
      variants.forEach((v) => keys.add(v))
    }
  }
  return [...keys]
}

export function matchByName<T extends { name?: string; title?: string }>(
  label: string,
  list: (T & { id: string })[],
  field: 'name' | 'title',
  aliases?: Record<string, string[]>
): string | null {
  if (!label.trim()) return null
  const candidates = aliases ? aliasKeys(label, aliases) : [norm(label)]

  for (const key of candidates) {
    const exact = list.find((x) => norm((field === 'name' ? x.name : x.title) ?? '') === key)
    if (exact) return exact.id
  }

  for (const key of candidates) {
    const partial = list.find((x) => {
      const n = norm((field === 'name' ? x.name : x.title) ?? '')
      return n.includes(key) || key.includes(n)
    })
    if (partial) return partial.id
  }

  return null
}

export function matchDepartmentName(label: string, list: (Lookup & { id: string })[]): string | null {
  const canonical = canonicalDepartmentName(label)
  return (
    matchByName(canonical, list, 'name', DEPT_ALIASES) ??
    matchByName(label, list, 'name', DEPT_ALIASES)
  )
}

export function matchBranchName(label: string, list: (Lookup & { id: string })[]): string | null {
  return matchByName(label, list, 'name', BRANCH_ALIASES)
}

export function matchDesignationTitle(label: string, list: (Lookup & { id: string })[]): string | null {
  return matchByName(label, list, 'title')
}

export function matchEmployeeByName(
  label: string,
  employees: { id: string; full_name?: string | null; first_name: string; last_name: string | null }[]
): string | null {
  const key = norm(label)
  if (!key) return null
  for (const e of employees) {
    const full = norm(e.full_name ?? `${e.first_name} ${e.last_name ?? ''}`.trim())
    if (full === key) return e.id
  }
  for (const e of employees) {
    const full = norm(e.full_name ?? `${e.first_name} ${e.last_name ?? ''}`.trim())
    if (full.includes(key) || key.includes(full)) return e.id
  }
  const keyFirst = key.split(' ')[0]
  if (keyFirst.length >= 3) {
    const hits = employees.filter((e) => {
      const full = norm(e.full_name ?? `${e.first_name} ${e.last_name ?? ''}`.trim())
      return full.startsWith(keyFirst) || full.split(' ').some((p) => p === keyFirst)
    })
    if (hits.length === 1) return hits[0].id
  }
  return null
}

type Lookup = { id: string; name?: string; title?: string }
