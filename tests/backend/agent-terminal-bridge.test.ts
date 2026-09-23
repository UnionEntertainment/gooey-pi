import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentTerminalBridge } from '../../electron/main/terminal-bridge'
import { waitUntil } from '../helpers/wait'

class TestAgentTerminalBridge extends AgentTerminalBridge {
  requestsFor(token: string): number | undefined { return this.claimForToken(token)?.requests }
}

const bridges: AgentTerminalBridge[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
})

function fakeTerminals() {
  return { readActive: vi.fn((sessionKey: string) => ({ label: 'zsh 2', cwd: '/project', content: '$ npm test\npassed', truncated: false, sessionKey })) }
}

async function fixture(scope: { cwd: string; sessionPath?: string } = { cwd: '/project', sessionPath: '/sessions/one.jsonl' }) {
  const terminals = fakeTerminals()
  const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const sendRequest = vi.fn((channel: string, payload: Record<string, unknown>) => {
    sent.push({ channel, payload })
    return true
  })
  const bridge = new TestAgentTerminalBridge({ terminals, extensionPath: '/app/extensions/omp-work-terminal.ts', sendRequest })
  await bridge.start()
  bridges.push(bridge)
  const environment = bridge.environmentFor(scope)
  const call = async (method: string, params: Record<string, unknown> = {}, token = environment.PRIME_WORK_TERMINAL_TOKEN) => {
    const response = await fetch(environment.PRIME_WORK_TERMINAL_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
    return { status: response.status, body: await response.json() as { ok: boolean; result?: unknown; error?: string } }
  }
  return { bridge, terminals, environment, call, sent, sendRequest }
}

describe('AgentTerminalBridge', () => {
  it('rejects a revoked runtime token immediately without affecting active runtimes', async () => {
    const { bridge, call, environment } = await fixture()
    const active = bridge.environmentFor({ cwd: '/project', sessionPath: '/sessions/active.jsonl' })

    expect(bridge.revoke(environment.PRIME_WORK_TERMINAL_TOKEN)).toBe(true)
    expect(bridge.revoke(environment.PRIME_WORK_TERMINAL_TOKEN)).toBe(false)

    expect(await call('terminal.read')).toMatchObject({ status: 401 })
    expect(await call('terminal.read', {}, active.PRIME_WORK_TERMINAL_TOKEN)).toMatchObject({ status: 200 })
  })

  it('returns 401 without dispatch when a claim is revoked after headers but before the full body', async () => {
    const { bridge, terminals, environment } = await fixture()
    const token = environment.PRIME_WORK_TERMINAL_TOKEN!
    const body = JSON.stringify({ method: 'terminal.read', params: {} })
    const request = httpRequest(environment.PRIME_WORK_TERMINAL_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    })
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      request.on('response', (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      })
      request.on('error', reject)
    })

    request.write(body.slice(0, -1))
    await waitUntil(() => bridge.requestsFor(token) === 1)
    expect(bridge.revoke(token)).toBe(true)
    request.end(body.slice(-1))

    await expect(response).resolves.toMatchObject({ status: 401, body: expect.stringContaining('Capability expired') })
    expect(terminals.readActive).not.toHaveBeenCalled()
  })

  it('exposes the extension path and reads only the active terminal scoped to the runtime session', async () => {
    const { terminals, environment, call } = await fixture()
    expect(environment.PRIME_WORK_TERMINAL_EXTENSION_PATH).toBe('/app/extensions/omp-work-terminal.ts')
    // The session key is canonicalized from the claim's session path, never from request params.
    const response = await call('terminal.read', { sessionKey: '/sessions/other.jsonl' })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(terminals.readActive).toHaveBeenCalledOnce()
    expect(terminals.readActive.mock.calls[0][0].endsWith('one.jsonl')).toBe(true)
    expect(response.body.result).toMatchObject({ label: 'zsh 2', content: '$ npm test\npassed' })
  })

  it('rejects missing tokens, wrong routes, browser origins, and unknown methods', async () => {
    const { environment, call } = await fixture()
    expect((await call('terminal.read', {}, 'wrong-token')).status).toBe(401)
    expect((await call('definitely_not_a_method')).status).toBe(400)
    const origin = await fetch(environment.PRIME_WORK_TERMINAL_URL!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${environment.PRIME_WORK_TERMINAL_TOKEN}`, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ method: 'terminal.read' }),
    })
    expect(origin.status).toBe(404)
    const wrongPath = await fetch(environment.PRIME_WORK_TERMINAL_URL!.replace('/v1/call', '/v1/other'), {
      method: 'POST', headers: { Authorization: `Bearer ${environment.PRIME_WORK_TERMINAL_TOKEN}` }, body: '{}',
    })
    expect(wrongPath.status).toBe(404)
  })

  it('requires a session scope and accepts one bound after start', async () => {
    const { bridge, terminals, environment, call } = await fixture({ cwd: '/project' })
    const before = await call('terminal.read')
    expect(before.status).toBe(409)
    expect(before.body.error).toContain('not available yet')
    expect(terminals.readActive).not.toHaveBeenCalled()
    bridge.bindSession(environment.PRIME_WORK_TERMINAL_TOKEN, '/sessions/late.jsonl')
    const after = await call('terminal.read')
    expect(after.status).toBe(200)
    expect(terminals.readActive.mock.calls[0][0].endsWith('late.jsonl')).toBe(true)
    // A bound session scope must never be rebound to another thread.
    bridge.bindSession(environment.PRIME_WORK_TERMINAL_TOKEN, '/sessions/other.jsonl')
    await call('terminal.read')
    expect(terminals.readActive.mock.calls[1][0].endsWith('late.jsonl')).toBe(true)
  })

  it('propagates service failures as bounded errors', async () => {
    const terminals = { readActive: vi.fn(() => { throw new Error('boom') }) }
    const bridge = new AgentTerminalBridge({ terminals, extensionPath: '/x.ts', sendRequest: vi.fn(() => false) })
    await bridge.start()
    bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd: '/project', sessionPath: '/sessions/one.jsonl' })
    const response = await fetch(environment.PRIME_WORK_TERMINAL_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${environment.PRIME_WORK_TERMINAL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'terminal.read' }),
    })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toBe('boom')
  })

  it('mints one independent claim per runtime', async () => {
    const { bridge, terminals, call } = await fixture()
    const other = bridge.environmentFor({ cwd: '/project', sessionPath: '/sessions/two.jsonl' })
    const response = await call('terminal.read', {}, other.PRIME_WORK_TERMINAL_TOKEN)
    expect(response.status).toBe(200)
    expect(terminals.readActive.mock.calls[0][0].endsWith('two.jsonl')).toBe(true)
  })

  it('opens a terminal tab through the renderer and returns its id', async () => {
    const { bridge, call, sent } = await fixture()
    const pending = call('terminal.open', { command: 'pnpm dev', label: 'backend' })
    await waitUntil(() => sent.length === 1)
    expect(sent[0].channel).toBe('terminal:agent-open')
    expect(sent[0].payload).toMatchObject({ sessionPath: '/sessions/one.jsonl', cwd: '/project', command: 'pnpm dev', label: 'backend' })
    bridge.resolveRequest(sent[0].payload.requestId, { ok: true })
    const response = await pending
    expect(response.status).toBe(200)
    expect(response.body.result).toEqual({ id: sent[0].payload.requestId })
  })

  it('rejects terminal.open outside the runtime working directory and when the window is gone', async () => {
    const { call, sendRequest } = await fixture()
    const escaped = await call('terminal.open', { command: 'pnpm dev', cwd: '/elsewhere' })
    expect(escaped.status).toBe(400)
    expect(sendRequest).not.toHaveBeenCalled()
    sendRequest.mockReturnValue(false)
    const unavailable = await call('terminal.open', { command: 'pnpm dev' })
    expect(unavailable.status).toBe(409)
    expect(unavailable.body.error).toContain('window is not available')
  })

  it('stops a terminal tab through the renderer scoped to the runtime session', async () => {
    const { bridge, call, sent } = await fixture()
    const pending = call('terminal.stop', { id: 'tab-1' })
    await waitUntil(() => sent.length === 1)
    expect(sent[0].channel).toBe('terminal:agent-close')
    expect(sent[0].payload).toMatchObject({ id: 'tab-1', sessionPath: '/sessions/one.jsonl' })
    bridge.resolveRequest(sent[0].payload.requestId, { ok: true })
    const response = await pending
    expect(response.status).toBe(200)
    expect(response.body.result).toEqual({ stopped: true })
  })

  it('surfaces renderer-reported failures from terminal.open', async () => {
    const { bridge, call, sent } = await fixture()
    const pending = call('terminal.open', { command: 'pnpm dev' })
    await waitUntil(() => sent.length === 1)
    bridge.resolveRequest(sent[0].payload.requestId, { ok: false, error: 'The terminal drawer is not ready yet' })
    const response = await pending
    expect(response.status).toBe(409)
    expect(response.body.error).toBe('The terminal drawer is not ready yet')
  })
})
