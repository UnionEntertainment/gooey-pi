import { errorMessage } from '@/lib/errors'
import type { ProjectRecord, SessionRecord } from '@/types/api'

export interface WorkspaceSnapshot {
  generation: number
  project?: ProjectRecord
  session?: SessionRecord
  cwd?: string
  sessionFile?: string
  /** True for sessions running in GooeyPi's app-managed workspace (no project). */
  global?: boolean
}

export const requestFailureMessage = (error: unknown) => {
  const raw = errorMessage(error)
  const detail = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim()
  return detail ? `Request failed: ${detail.slice(0, 1_000)}` : 'Prime could not process the request.'
}
