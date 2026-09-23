import { randomUUID } from 'node:crypto'
import { CapabilityBridge, type CapabilityClaim } from './lib/capability-bridge'
import { canonicalSessionPath } from './session-paths'
import type { TerminalService } from './terminal'
import type { AgentTerminalResult } from '../../src/types/api'
import { isPathWithin, rejectUnknownKeys, requireString } from './validation'

const AGENT_REQUEST_TIMEOUT_MS = 15_000

interface PendingAgentRequest {
  resolve(result: AgentTerminalResult): void
  timer: NodeJS.Timeout
}

export interface AgentTerminalBridgeOptions {
  terminals: Pick<TerminalService, 'readActive'>
  extensionPath: string
  /**
   * Pushes a request onto the trusted main-window renderer and returns whether
   * it was delivered. The renderer answers on `terminal:agent-result`, which
   * resolves the pending request through `resolveRequest`.
   */
  sendRequest(channel: 'terminal:agent-open' | 'terminal:agent-close', payload: Record<string, unknown>): boolean
}

/**
 * Loopback broker for the terminal capability extension. Scoped per runtime by
 * a random bearer token; the claim's session path binds every tool call to the
 * terminal drawer belonging to that thread. `terminal.read` inspects the active
 * tab; `terminal.open`/`terminal.stop` ask the renderer to mount and close
 * command tabs so agent-started processes stay visible to the user.
 */
export class AgentTerminalBridge extends CapabilityBridge {
  protected readonly rateLimit = 60
  protected readonly rateLimitError = 'Terminal API rate limit exceeded; slow down and retry shortly'
  private readonly pending = new Map<string, PendingAgentRequest>()

  constructor(private readonly options: AgentTerminalBridgeOptions) { super() }

  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return {
      PRIME_WORK_TERMINAL_URL: url,
      PRIME_WORK_TERMINAL_TOKEN: token,
      PRIME_WORK_TERMINAL_EXTENSION_PATH: this.options.extensionPath,
    }
  }

  /**
   * Runtimes started without --resume only learn their session file at
   * handshake; the manager reports it here so the claim gains its session
   * scope. An existing scope is never overwritten.
   */
  bindSession(token: string | undefined, sessionFile: string | undefined): void {
    if (!token || !sessionFile) return
    const claim = this.claimForToken(token)
    if (claim && !claim.sessionPath) claim.sessionPath = sessionFile
  }

  /** Renderer reply hook for `terminal:agent-result`; unknown ids are dropped. */
  resolveRequest(requestId: unknown, result: unknown): void {
    if (typeof requestId !== 'string') return
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    const record = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
    entry.resolve({ ok: record.ok === true, error: typeof record.error === 'string' ? record.error.slice(0, 4_000) : undefined })
  }

  override async stop(): Promise<void> {
    for (const [requestId, entry] of this.pending) {
      this.pending.delete(requestId)
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, error: 'GooeyPi is shutting down' })
    }
    await super.stop()
  }

  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    if (method === 'terminal.read') return this.readActive(claim)
    if (method === 'terminal.open') return this.openTerminal(params, claim)
    if (method === 'terminal.stop') return this.stopTerminal(params, claim)
    throw new TypeError(`Unsupported terminal method ${method}`)
  }

  private readActive(claim: CapabilityClaim): unknown {
    const sessionPath = this.requireSessionPath(claim)
    const active = this.options.terminals.readActive(sessionPath)
    if (!active) throw new Error('No active terminal is open for this task')
    return active
  }

  private async openTerminal(params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    const sessionPath = this.requireSessionPath(claim)
    rejectUnknownKeys(params, ['command', 'label', 'cwd'], 'terminal.open params')
    const command = requireString(params.command, 'command', { min: 1, max: 64 * 1024 })
    const label = params.label === undefined
      ? command.slice(0, 48)
      : requireString(params.label, 'label', { min: 1, max: 128, trim: true })
    const cwd = params.cwd === undefined ? claim.cwd : requireString(params.cwd, 'cwd', { min: 1, max: 4096 })
    if (!isPathWithin(claim.cwd, cwd)) throw new TypeError('cwd must stay inside this task\'s working directory')
    const requestId = randomUUID()
    const result = await this.request('terminal:agent-open', { requestId, sessionPath, cwd, command, label })
    if (!result.ok) throw new Error(result.error ?? 'The terminal could not be opened')
    return { id: requestId }
  }

  private async stopTerminal(params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    const sessionPath = this.requireSessionPath(claim)
    rejectUnknownKeys(params, ['id'], 'terminal.stop params')
    const id = requireString(params.id, 'id', { min: 1, max: 128, trim: true })
    const result = await this.request('terminal:agent-close', { requestId: randomUUID(), id, sessionPath })
    if (!result.ok) throw new Error(result.error ?? 'The terminal could not be stopped')
    return { stopped: true }
  }

  private requireSessionPath(claim: CapabilityClaim): string {
    if (!claim.sessionPath) throw new Error('Terminal access is not available yet for this thread; try again in a moment')
    return canonicalSessionPath(claim.sessionPath)
  }

  private request(channel: 'terminal:agent-open' | 'terminal:agent-close', payload: Record<string, unknown> & { requestId: string }): Promise<AgentTerminalResult> {
    if (!this.options.sendRequest(channel, payload)) {
      return Promise.resolve({ ok: false, error: 'The GooeyPi window is not available' })
    }
    return new Promise<AgentTerminalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.requestId)
        resolve({ ok: false, error: 'The GooeyPi window did not respond' })
      }, AGENT_REQUEST_TIMEOUT_MS)
      this.pending.set(payload.requestId, { resolve, timer })
    })
  }
}
