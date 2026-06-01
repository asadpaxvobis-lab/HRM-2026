const STORAGE_KEY = 'hrm_zkt_agent_url'

const DEFAULT_AGENT_URL = import.meta.env.VITE_ZKT_AGENT_URL ?? 'http://127.0.0.1:17880'

export function getZktAgentUrl(): string {
  const saved = localStorage.getItem(STORAGE_KEY)?.trim()
  return saved || DEFAULT_AGENT_URL
}

export function setZktAgentUrl(url: string) {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''))
}

export type ZktSyncProgress = {
  running: boolean
  percent: number
  phase: string
  message: string
  deviceName?: string | null
  logsRead: number
  punchesSent: number
  punchesInserted: number
  lines: string[]
  done: boolean
  ok: boolean
  results?: string[] | null
  error?: string | null
}

export type ZktSyncStartResult = {
  ok: boolean
  started?: boolean
  alreadyRunning?: boolean
  progress?: ZktSyncProgress
  error?: string
}

function baseUrl(agentUrl: string) {
  return agentUrl.replace(/\/$/, '')
}

export async function fetchZktAgentSyncStatus(agentUrl = getZktAgentUrl()): Promise<ZktSyncProgress> {
  const res = await fetch(`${baseUrl(agentUrl)}/sync/status`)
  if (!res.ok) {
    throw new Error(`Agent status returned ${res.status}`)
  }
  return (await res.json()) as ZktSyncProgress
}

export async function resetZktAgentSync(agentUrl = getZktAgentUrl()): Promise<void> {
  const res = await fetch(`${baseUrl(agentUrl)}/sync/reset`, { method: 'POST' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `Agent reset returned ${res.status}`)
  }
}

export async function startZktAgentSync(agentUrl = getZktAgentUrl()): Promise<ZktSyncStartResult> {
  const res = await fetch(`${baseUrl(agentUrl)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = (await res.json()) as ZktSyncStartResult & { error?: string }
  if (res.status === 409 && data.alreadyRunning) {
    return data
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error ?? `Agent returned ${res.status}`)
  }
  return data
}

/** Start sync and poll until done (or timeout). */
export async function runZktAgentSyncWithProgress(
  agentUrl = getZktAgentUrl(),
  onProgress: (p: ZktSyncProgress) => void,
  options?: { pollMs?: number; timeoutMs?: number }
): Promise<ZktSyncProgress> {
  const pollMs = options?.pollMs ?? 500
  const timeoutMs = options?.timeoutMs ?? 15 * 60 * 1000
  const startedAt = Date.now()

  const start = await startZktAgentSync(agentUrl)
  if (!start.ok && !start.alreadyRunning) {
    throw new Error(start.error ?? 'Could not start sync')
  }

  let last = start.progress ?? (await fetchZktAgentSyncStatus(agentUrl))
  onProgress(last)

  while (last.running || !last.done) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Sync is taking longer than expected — check the agent PowerShell window.')
    }
    await new Promise((r) => setTimeout(r, pollMs))
    last = await fetchZktAgentSyncStatus(agentUrl)
    onProgress(last)
  }

  if (!last.ok) {
    throw new Error(last.error ?? last.message ?? 'Sync failed')
  }

  return last
}

export type ZktAgentHealth = {
  ok: boolean
  service?: string
  zkemkeeper?: boolean
  hint?: string | null
}

export async function fetchZktAgentHealth(agentUrl = getZktAgentUrl()): Promise<ZktAgentHealth | null> {
  try {
    const res = await fetch(`${baseUrl(agentUrl)}/health`)
    if (!res.ok) return null
    return (await res.json()) as ZktAgentHealth
  } catch {
    return null
  }
}

export async function pingZktAgent(agentUrl = getZktAgentUrl()): Promise<boolean> {
  const h = await fetchZktAgentHealth(agentUrl)
  return h?.ok === true
}

export type ZktDeviceLanStatus = {
  id: string
  name: string
  ip: string | null
  connected: boolean
  message?: string | null
}

export async function fetchZktDeviceLanStatuses(
  agentUrl = getZktAgentUrl()
): Promise<ZktDeviceLanStatus[]> {
  try {
    const res = await fetch(`${baseUrl(agentUrl)}/devices/status`)
    if (!res.ok) return []
    const data = (await res.json()) as { devices?: ZktDeviceLanStatus[] }
    return data.devices ?? []
  } catch {
    return []
  }
}
