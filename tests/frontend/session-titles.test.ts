import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { retitleSessionFromPrompt } from '../../src/hooks/useWorkspaceActions'
import { markSessionTitleManual } from '../../src/lib/session-titles'
import type { PrimeWorkApi, SessionRecord } from '../../src/types/api'

const session: SessionRecord = {
  id: 'session', harness: 'prime', filePath: '/sessions/session.jsonl', projectPath: '/project', title: 'Existing chat',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => store.clear(),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('manual session titles', () => {
  it('does not retitle a session the user renamed by hand', async () => {
    markSessionTitleManual(session.filePath)
    const rename = vi.fn(async () => true)

    retitleSessionFromPrompt({
      bridge: { sessions: { rename } } as unknown as PrimeWorkApi,
      sessionFile: session.filePath,
      prompt: 'A new prompt that would otherwise retitle',
      sessions: [session],
      setSessions: vi.fn(),
    })
    await Promise.resolve()

    expect(rename).not.toHaveBeenCalled()
  })

  it('retitles sessions that were never renamed by hand', async () => {
    const rename = vi.fn(async () => true)

    retitleSessionFromPrompt({
      bridge: { sessions: { rename } } as unknown as PrimeWorkApi,
      sessionFile: session.filePath,
      prompt: 'A new prompt',
      sessions: [session],
      setSessions: vi.fn(),
    })
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(session.filePath, 'A new prompt'))
  })
})
