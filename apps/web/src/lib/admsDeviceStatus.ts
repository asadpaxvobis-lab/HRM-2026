import { pushEndpointSplitFields } from '@/lib/zktPushUrl'

export const ADMS_ONLINE_MS = 5 * 60 * 1000

export type AdmsConnection = {
  label: string
  variant: 'warm' | 'outline' | 'secondary' | 'destructive'
  detail: string
}

export type AdmsDeviceLike = {
  push_token: string | null
  last_seen_at: string | null
  is_active: boolean
}

export function formatRelative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function admsConnectionStatus(
  device: AdmsDeviceLike,
  lastPunchAt: string | null | undefined,
): AdmsConnection {
  if (!device.is_active) {
    return { label: 'Disabled', variant: 'secondary', detail: 'Enable device to use ADMS push.' }
  }
  if (!device.push_token?.trim()) {
    return {
      label: 'Not configured',
      variant: 'secondary',
      detail: 'Save a push token and paste the ADMS URL on the device.',
    }
  }
  if (!device.last_seen_at) {
    return {
      label: 'Never connected',
      variant: 'destructive',
      detail: 'Device has not reached Supabase. Check ADMS URL on the terminal.',
    }
  }
  const seenAge = Date.now() - new Date(device.last_seen_at).getTime()
  if (lastPunchAt) {
    const punchAge = Date.now() - new Date(lastPunchAt).getTime()
    if (punchAge < 7 * 24 * 60 * 60 * 1000) {
      return {
        label: 'Receiving punches',
        variant: 'warm',
        detail: `Last punch imported ${formatRelative(lastPunchAt)}.`,
      }
    }
  }
  if (seenAge < ADMS_ONLINE_MS) {
    return {
      label: 'Handshake OK',
      variant: 'outline',
      detail: 'Device reached Supabase but no punches imported yet. Punch on device and wait 1–2 min.',
    }
  }
  if (seenAge < 24 * 60 * 60 * 1000) {
    return {
      label: 'Stale',
      variant: 'outline',
      detail: `Last handshake ${formatRelative(device.last_seen_at)}. Check cloud connection on device.`,
    }
  }
  return {
    label: 'Offline',
    variant: 'secondary',
    detail: `Last handshake ${formatRelative(device.last_seen_at)}.`,
  }
}

export function lastSeenBadge(iso: string | null): {
  label: string
  variant: 'warm' | 'outline' | 'secondary'
} {
  if (!iso) return { label: 'Never', variant: 'secondary' }
  const ageMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ageMs / 60000)
  if (mins < 5) return { label: 'Online', variant: 'warm' }
  if (mins < 60) return { label: `${mins}m ago`, variant: 'outline' }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return { label: `${hrs}h ago`, variant: 'outline' }
  const days = Math.floor(hrs / 24)
  return { label: `${days}d ago`, variant: 'secondary' }
}

/** True when cloud path likely broken — show troubleshooting checklist. */
export function needsAdmsTroubleshooting(
  device: AdmsDeviceLike,
  lastPunchAt?: string | null,
): boolean {
  const status = admsConnectionStatus(device, lastPunchAt)
  return ['Never connected', 'Stale', 'Offline'].includes(status.label)
}

export const ADMS_DISCONNECT_NOTE =
  'HRM does not reset device settings. Offline means the terminal stopped contacting Supabase (usually network/DNS or wrong ADMS fields on the device).'

export const ADMS_TROUBLESHOOT_STEPS = [
  'Menu → Comm → Ethernet: DNS must be 8.8.8.8 (not 0.0.0.0); gateway must be your router (e.g. 192.168.18.1).',
  'Menu → Comm → Cloud Server → ADMS: Domain ON, HTTPS ON, port 443 — use split server + path from device edit dialog (not a full https:// URL in the server field).',
  'Save settings, then reboot the MB460 and wait 2 minutes.',
  'Do not delete/recreate the device in HRM unless you update the push token on the terminal too.',
  'After reboot, this page should show Online or Handshake OK within 5 minutes. Then punch a mapped PIN.',
] as const

export function admsSplitFieldHints(pushToken: string, serialNo: string | null) {
  const split = pushEndpointSplitFields(pushToken, serialNo)
  return {
    server: split.server,
    port: split.port,
    path: split.path,
  }
}
