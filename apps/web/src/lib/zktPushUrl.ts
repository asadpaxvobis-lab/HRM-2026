/** Short edge function slug for ADMS push (shorter device URL). */
export const ZKT_PUSH_FUNCTION = 'zkt'

export const ZKT_PUSH_LEGACY_FUNCTION = 'zkteco-push'

const ICLOCK_PATH = '/iclock/cdata'

export function supabaseProjectHost(): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? ''
  try {
    return new URL(base).host
  } catch {
    return base.replace(/^https?:\/\//, '')
  }
}

export function genDevicePushToken(): string {
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function pushEndpointUrl(
  token: string,
  serial?: string | null,
  functionName = ZKT_PUSH_FUNCTION
): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? ''
  const sn = serial?.trim() ? `&SN=${encodeURIComponent(serial.trim())}` : ''
  return `${base}/functions/v1/${functionName}${ICLOCK_PATH}?token=${encodeURIComponent(token)}${sn}`
}

export function pushEndpointUrlLegacy(token: string, serial?: string | null): string {
  return pushEndpointUrl(token, serial, ZKT_PUSH_LEGACY_FUNCTION)
}

export type ZktPushSplitFields = {
  server: string
  port: string
  https: boolean
  path: string
  fullUrl: string
}

export function pushEndpointSplitFields(token: string, serial?: string | null): ZktPushSplitFields {
  const fullUrl = pushEndpointUrl(token, serial)
  const host = supabaseProjectHost()
  const sn = serial?.trim() ? `&SN=${encodeURIComponent(serial.trim())}` : ''
  const path = `/functions/v1/${ZKT_PUSH_FUNCTION}${ICLOCK_PATH}?token=${encodeURIComponent(token)}${sn}`
  return {
    server: host,
    port: '443',
    https: true,
    path,
    fullUrl,
  }
}
