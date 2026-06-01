import * as XLSX from 'xlsx'

/** One row from "Staff Status Report" sheet (header row index 4). */
export type StaffImportRow = {
  rowIndex: number
  sr: number | null
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
  address: string
}

export type StaffImportParseResult = {
  rows: StaffImportRow[]
  skipped: number
}

const HEADER_MARKERS = ['device pin', 'name', 'cnic']

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

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

export function normalizeCnic(raw: string, devicePin: number | null): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 13) return digits.slice(0, 13)
  if (digits.length > 0) return digits.padStart(13, '0').slice(0, 13)
  const pin = devicePin != null && devicePin > 0 ? devicePin : 0
  return `9${String(pin).padStart(12, '0')}`.slice(0, 13)
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const line = matrix[i].map((c) => cellStr(c).toLowerCase()).join('|')
    if (HEADER_MARKERS.every((m) => line.includes(m))) return i
  }
  return 4
}

function isSectionRow(cells: unknown[]): boolean {
  const pin = cellNum(cells[1])
  const name = cellStr(cells[2])
  const dept = cellStr(cells[5])
  if (name) return false
  if (pin != null) return false
  return !!dept
}

/**
 * Parse Staff_Status_Report workbook (first sheet).
 * Expects columns: Sr#, Device PIN, Name, CNIC, Designation, Department, Branch, device, Mobile, Salary, Address.
 */
export function parseStaffStatusWorkbook(buffer: ArrayBuffer): StaffImportParseResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
  })

  const headerIdx = findHeaderRow(matrix)
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
      sr: cellNum(cells[0]),
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
      mobile: cellStr(cells[8]).replace(/\D/g, '').slice(0, 15) || cellStr(cells[8]),
      salary,
      address: cellStr(cells[10]),
    })
  }

  const deduped: StaffImportRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.hasRealCnic
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

  return { rows: deduped, skipped }
}

export function matchByName<T extends { name?: string; title?: string }>(
  label: string,
  list: (T & { id: string })[],
  field: 'name' | 'title'
): string | null {
  if (!label.trim()) return null
  const key = norm(label)
  const exact = list.find((x) => norm((field === 'name' ? x.name : x.title) ?? '') === key)
  if (exact) return exact.id
  const partial = list.find((x) => {
    const n = norm((field === 'name' ? x.name : x.title) ?? '')
    return n.includes(key) || key.includes(n)
  })
  return partial?.id ?? null
}
