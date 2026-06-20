import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

/** ZKTeco PUSH options — ATTLOGStamp=0 + TransFlag enables automatic POST. */
function buildZkOptions(serial: string | null): string {
  const sn = serial?.trim() || 'UNKNOWN'
  return [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=0',
    'OPERLOGStamp=0',
    'ATTPHOTOStamp=0',
    'ErrorDelay=60',
    'Delay=5',
    'TransTimes=0',
    'TransInterval=1',
    'TransFlag=111111111111',
    'Realtime=1',
    'Encrypt=0',
    'TimeZone=+05:00',
    'Timeout=60',
    'SyncTime=3600',
    'ServerVer=3.0.1',
    'PushProtVer=2.4.1',
    'SupportPing=1',
    'OK',
  ].join('\r\n')
}

const plainOk = () =>
  new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })

const okWithCount = (count: number) =>
  new Response(`OK:${count}`, { status: 200, headers: { 'Content-Type': 'text/plain' } })

function iclockRoute(pathname: string): 'cdata' | 'getrequest' | 'devicecmd' | 'registry' | 'other' {
  const p = pathname.toLowerCase()
  if (p.includes('/iclock/getrequest')) return 'getrequest'
  if (p.includes('/iclock/devicecmd')) return 'devicecmd'
  if (p.includes('/iclock/registry')) return 'registry'
  if (p.includes('/iclock/cdata')) return 'cdata'
  if (p.includes('/functions/v1/zkt') || p.includes('/functions/v1/zkteco-push')) return 'cdata'
  return 'other'
}

type DeviceRow = {
  id: string
  company_id: string
  is_active: boolean
  branch_id: string | null
}

function nextCmdId(): number {
  return (Math.floor(Date.now() / 1000) % 900000) + 100000
}

function cmdResponse(body: string): Response {
  return new Response(body.endsWith('\n') ? body : `${body}\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function extractToken(req: Request, url: URL): string | null {
  return url.searchParams.get('token') ?? req.headers.get('X-Push-Token') ?? req.headers.get('x-push-token')
}

function parseAttlogLine(line: string): { pin: number; punchAt: string; status: number } | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed.includes('\t')) {
    const parts = trimmed.split('\t')
    if (parts.length < 2) return null
    const pin = parseInt(parts[0], 10)
    if (Number.isNaN(pin)) return null
    const dt = parts[1].trim()
    const status = parts.length > 2 ? parseInt(parts[2], 10) : 0
    return { pin, punchAt: dt, status: Number.isNaN(status) ? 0 : status }
  }

  // Space-separated: PIN YYYY-MM-DD HH:MM:SS status verify workcode ...
  const spaced = trimmed.match(/^(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*(\d+)?/)
  if (spaced) {
    const pin = parseInt(spaced[1], 10)
    const status = spaced[3] ? parseInt(spaced[3], 10) : 0
    return { pin, punchAt: spaced[2], status: Number.isNaN(status) ? 0 : status }
  }

  return null
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

async function resolveEmployee(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  deviceId: string,
  pin: number,
) {
  const { data: mapped } = await admin
    .from('employee_device_pins')
    .select('employee_id')
    .eq('device_id', deviceId)
    .eq('device_pin', pin)
    .maybeSingle()
  if (mapped?.employee_id) {
    const { data: emp } = await admin
      .from('employees')
      .select('id')
      .eq('id', mapped.employee_id)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle()
    if (emp) return emp
  }

  const { data: emp } = await admin
    .from('employees')
    .select('id')
    .eq('company_id', companyId)
    .eq('device_pin', pin)
    .eq('is_active', true)
    .maybeSingle()
  return emp
}

async function shouldRequestAttlogUpload(
  admin: ReturnType<typeof createClient>,
  deviceId: string,
): Promise<boolean> {
  const { count } = await admin
    .from('attendance_punches')
    .select('id', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .eq('source', 'zkteco')
  // Keep commanding upload until device has synced a meaningful batch
  if ((count ?? 0) < 5) return true
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recent } = await admin
    .from('attendance_punches')
    .select('id', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .eq('source', 'zkteco')
    .gte('punch_at', hourAgo)
  return (recent ?? 0) === 0
}

/** SDK: C:id:DATA QUERY ATTLOG StartTime=...\tEndTime=... */
function buildAttlogPullCommand(): Response {
  const end = new Date().toISOString().slice(0, 19).replace('T', ' ')
  return cmdResponse(`C:${nextCmdId()}:DATA QUERY ATTLOG StartTime=2020-01-01 00:00:00\tEndTime=${end}`)
}

/** SDK: C:id:CHECK — device re-reads options and re-uploads per stamp. */
function buildCheckCommand(): Response {
  return cmdResponse(`C:${nextCmdId()}:CHECK`)
}

/** SDK: C:id:LOG — device immediately transmits buffered attendance. */
function buildLogCommand(): Response {
  return cmdResponse(`C:${nextCmdId()}:LOG`)
}

/** SDK: C:id:RELOAD OPTIONS — device reloads server options (ATTLOGStamp=0). */
function buildReloadOptionsCommand(): Response {
  return cmdResponse(`C:${nextCmdId()}:RELOAD OPTIONS`)
}

function pickUploadCommand(): Response {
  const slot = Math.floor(Date.now() / 30000) % 4
  if (slot === 0) return buildLogCommand()
  if (slot === 1) return buildAttlogPullCommand()
  if (slot === 2) return buildCheckCommand()
  return buildReloadOptionsCommand()
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

async function resolveDeviceAuth(
  admin: ReturnType<typeof createClient>,
  token: string | null,
  serial: string | null,
): Promise<DeviceRow | null> {
  if (token) return resolveDevice(admin, token, serial)
  if (!serial) return null
  const { data, error } = await admin
    .from('attendance_devices')
    .select('id, company_id, is_active, branch_id')
    .eq('serial_no', serial)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data as DeviceRow | null
}

async function ingestAttlogBody(
  admin: ReturnType<typeof createClient>,
  device: DeviceRow,
  body: string,
): Promise<{ inserted: number; errors: string[] }> {
  const { data: company } = await admin.from('companies').select('timezone').eq('id', device.company_id).single()
  const tz = company?.timezone ?? 'Asia/Karachi'

  let inserted = 0
  const errors: string[] = []

  for (const line of body.split(/\r?\n/)) {
    const parsed = parseAttlogLine(line)
    if (!parsed) continue

    const emp = await resolveEmployee(admin, device.company_id, device.id, parsed.pin)
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

  return { inserted, errors }
}

/** ZKTeco ADMS push handler (shared by zkteco-push and zkt edge functions). */
export async function handleZktPush(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const route = iclockRoute(url.pathname)
  const token = extractToken(req, url)
  const serial = url.searchParams.get('SN') ?? url.searchParams.get('sn')

  console.log('ADMS', { method: req.method, route, sn: serial, table: url.searchParams.get('table') })

  if (!token && !serial) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let device: DeviceRow | null
  try {
    device = await resolveDeviceAuth(admin, token, serial)
  } catch (e) {
    return new Response(`ERROR: ${String(e)}`, { status: 500 })
  }

  if (!device) {
    return new Response('Unauthorized', { status: 401 })
  }

  await admin.from('attendance_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id)

  if (route === 'getrequest') {
    if (req.method === 'GET') {
      if (await shouldRequestAttlogUpload(admin, device.id)) {
        return pickUploadCommand()
      }
      return plainOk()
    }
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (route === 'devicecmd') {
    if (req.method === 'POST') {
      const body = await req.text()
      console.log('ADMS devicecmd POST', { sn: serial, bodyLen: body.length, preview: body.slice(0, 200) })
      // Some firmware uploads ATTLOG via devicecmd after a DATA QUERY command
      if (body.includes('\t') || /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(body)) {
        const { inserted, errors } = await ingestAttlogBody(admin, device, body)
        if (errors.length) {
          console.warn('devicecmd ATTLOG import', { deviceId: device.id, inserted, errors: errors.slice(0, 10) })
        } else if (inserted > 0) {
          console.log('devicecmd ATTLOG import', { deviceId: device.id, inserted })
        }
        return okWithCount(inserted)
      }
      return plainOk()
    }
    if (req.method === 'GET') return plainOk()
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (route === 'registry') {
    if (req.method === 'GET' || req.method === 'POST') return plainOk()
    return new Response('Method Not Allowed', { status: 405 })
  }

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

  const body = await req.text()
  console.log('ADMS POST', {
    route,
    table: url.searchParams.get('table'),
    sn: serial,
    bodyLen: body.length,
    preview: body.slice(0, 200),
  })

  if (table && table !== 'ATTLOG') {
    return plainOk()
  }

  if (!body.trim()) {
    return okWithCount(0)
  }

  const { inserted, errors } = await ingestAttlogBody(admin, device, body)

  if (errors.length) {
    console.warn('ATTLOG import', { deviceId: device.id, inserted, errors: errors.slice(0, 10), bodyPreview: body.slice(0, 200) })
  } else if (inserted > 0) {
    console.log('ATTLOG import', { deviceId: device.id, inserted })
  }

  return okWithCount(inserted)
}
