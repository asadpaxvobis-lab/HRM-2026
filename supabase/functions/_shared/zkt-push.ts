import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

/** ZKTeco PUSH options — must include device SN, ATTLOGStamp=0, and ServerVer or device won't POST attendance. */
function buildZkOptions(serial: string | null): string {
  const sn = serial?.trim() || 'UNKNOWN'
  return [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=0',
    'OPERLOGStamp=0',
    'ATTPHOTOStamp=0',
    'ErrorDelay=60',
    'Delay=5',
    'TransTimes=00:00',
    'TransInterval=1',
    'TransFlag=111111111111',
    'Realtime=1',
    'Encrypt=0',
    'TimeZone=5',
    'ServerVer=3.0.1',
    'PushProtVer=2.4.1',
    'OK',
  ].join('\r\n')
}

type DeviceRow = {
  id: string
  company_id: string
  is_active: boolean
  branch_id: string | null
}

function extractToken(req: Request, url: URL): string | null {
  return url.searchParams.get('token') ?? req.headers.get('X-Push-Token') ?? req.headers.get('x-push-token')
}

function parseAttlogLine(line: string): { pin: number; punchAt: string; status: number } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const parts = trimmed.split('\t')
  if (parts.length < 2) return null
  const pin = parseInt(parts[0], 10)
  if (Number.isNaN(pin)) return null
  const dt = parts[1].trim()
  const status = parts.length > 2 ? parseInt(parts[2], 10) : 0
  return { pin, punchAt: dt, status: Number.isNaN(status) ? 0 : status }
}

function toTimestamptz(localDt: string, tz: string): string | null {
  const normalized = localDt.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)) return null
  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized
  if (tz === 'Asia/Karachi') {
    return `${withSeconds}+05:00`
  }
  return `${withSeconds}Z`
}

function punchTypeFromStatus(status: number): 'in' | 'out' | 'auto' {
  if (status === 0) return 'in'
  if (status === 1) return 'out'
  return 'auto'
}

async function resolveDevice(admin: ReturnType<typeof createClient>, token: string, serial: string | null) {
  const { data, error } = await admin
    .from('attendance_devices')
    .select('id, company_id, is_active, branch_id')
    .eq('push_token', token)
    .maybeSingle()
  if (error) throw error
  if (data?.is_active) return data as DeviceRow

  if (serial) {
    const { data: bySerial } = await admin
      .from('attendance_devices')
      .select('id, company_id, is_active, branch_id')
      .eq('serial_no', serial)
      .eq('is_active', true)
      .maybeSingle()
    if (bySerial) return bySerial as DeviceRow
  }
  return null
}

/** ZKTeco ADMS push handler (shared by zkteco-push and zkt edge functions). */
export async function handleZktPush(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const token = extractToken(req, url)
  if (!token) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const serial = url.searchParams.get('SN') ?? url.searchParams.get('sn')
  let device: DeviceRow | null
  try {
    device = await resolveDevice(admin, token, serial)
  } catch (e) {
    return new Response(`ERROR: ${String(e)}`, { status: 500 })
  }

  if (!device) {
    return new Response('Unauthorized', { status: 401 })
  }

  await admin.from('attendance_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id)

  const table = url.searchParams.get('table')?.toUpperCase() ?? ''

  if (req.method === 'GET') {
    return new Response(buildZkOptions(serial), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (table && table !== 'ATTLOG') {
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  const body = await req.text()
  if (!body.trim()) {
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  const { data: company } = await admin.from('companies').select('timezone').eq('id', device.company_id).single()
  const tz = company?.timezone ?? 'Asia/Karachi'

  const lines = body.split(/\r?\n/)
  let inserted = 0
  const errors: string[] = []

  for (const line of lines) {
    const parsed = parseAttlogLine(line)
    if (!parsed) continue

    const { data: emp } = await admin
      .from('employees')
      .select('id')
      .eq('company_id', device.company_id)
      .eq('device_pin', parsed.pin)
      .eq('is_active', true)
      .maybeSingle()

    if (!emp) {
      errors.push(`PIN ${parsed.pin} not mapped`)
      continue
    }

    const punchAt = toTimestamptz(parsed.punchAt, tz)
    if (!punchAt) {
      errors.push(`Bad datetime: ${parsed.punchAt}`)
      continue
    }

    const { error: insErr } = await admin.from('attendance_punches').insert({
      company_id: device.company_id,
      employee_id: emp.id,
      device_id: device.id,
      punch_at: punchAt,
      punch_type: punchTypeFromStatus(parsed.status),
      source: 'zkteco',
      raw_payload: { line: line.trim(), pin: parsed.pin, status: parsed.status },
    })

    if (insErr) {
      if (insErr.code === '23505') continue
      errors.push(insErr.message)
    } else {
      inserted++
    }
  }

  const suffix = errors.length ? `\r\n# ${errors.slice(0, 5).join('; ')}` : ''
  return new Response(`OK:${inserted}${suffix}`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
