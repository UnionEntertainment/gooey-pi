// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useSessionNotifications } from '../../src/hooks/useSessionNotifications'
import type { SessionRecord } from '../../src/types/api'

// React requires this flag before act() runs outside a browser test runner.
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session',
  harness: 'prime',
  filePath: '/sessions/session.jsonl',
  projectPath: '/project',
  title: 'Session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'idle',
  depth: 0,
  ...overrides,
})

interface Banner {
  title: string
  body: string
  onclick: (() => void) | null
}

function Probe({ sessions, onOpen, notify }: {
  sessions: SessionRecord[]
  onOpen: (session: SessionRecord) => void
  notify: (title: string, body: string) => Notification
}) {
  useSessionNotifications({ sessions, onOpen, notify, delayMs: 1_500 })
  return null
}

let container: HTMLDivElement
let root: Root
let banners: Banner[]
let notify: (title: string, body: string) => Notification
let onOpen: Mock<(session: SessionRecord) => void>

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  banners = []
  onOpen = vi.fn()
  notify = (title, body) => {
    const banner: Banner = { title, body, onclick: null }
    banners.push(banner)
    return banner as unknown as Notification
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const render = async (sessions: SessionRecord[]) => {
  await act(async () => {
    root.render(<Probe sessions={sessions} onOpen={onOpen} notify={notify} />)
  })
}

const flush = async () => {
  await act(async () => { vi.advanceTimersByTime(2_000) })
}

describe('session system notifications', () => {
  it('seeds the initial catalog without notifying for already-settled sessions', async () => {
    await render([session({ status: 'complete', unread: true })])
    await flush()
    expect(banners).toEqual([])
  })

  it('notifies when a session finishes', async () => {
    const running = session({ status: 'running' })
    await render([running])
    await render([{ ...running, status: 'complete', unread: true, eventRevision: 1 }])
    await flush()
    expect(banners).toEqual([{ title: 'Session', body: 'Finished', onclick: expect.any(Function) }])
  })

  it('cancels a pending banner when an auto-retry resumes the turn', async () => {
    const running = session({ status: 'running' })
    await render([running])
    await render([{ ...running, status: 'complete', unread: true, eventRevision: 1 }])
    await render([{ ...running, status: 'running', unread: false, eventRevision: 2 }])
    await flush()
    expect(banners).toEqual([])
  })

  it('opens the session when the banner is clicked', async () => {
    const running = session({ status: 'running' })
    await render([running])
    const finished = { ...running, status: 'complete' as const, unread: true, eventRevision: 1 }
    await render([finished])
    await flush()
    banners[0].onclick?.()
    expect(onOpen).toHaveBeenCalledWith(finished)
  })

  it('notifies again for a new revision but not for a re-rendered same one', async () => {
    const running = session({ status: 'running' })
    await render([running])
    const first = { ...running, status: 'complete' as const, unread: true, eventRevision: 1 }
    await render([first])
    await flush()
    await render([first])
    await render([{ ...first, status: 'waiting' as const, eventRevision: 2 }])
    await flush()
    expect(banners.map((banner) => banner.body)).toEqual(['Finished', 'Waiting for input'])
  })

  it('re-seeds instead of notifying when the whole catalog is replaced', async () => {
    await render([session({ status: 'running' })])
    await render([session({ id: 'other', filePath: '/sessions/other.jsonl', status: 'complete', unread: true })])
    await flush()
    expect(banners).toEqual([])
  })
})
