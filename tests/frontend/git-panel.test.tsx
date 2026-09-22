// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitPanel } from '../../src/components/inspector/GitPanel'
import type { GitHistory } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'prime')
  vi.restoreAllMocks()
})

const history: GitHistory = {
  commits: [
    { sha: 'a'.repeat(40), parents: ['b'.repeat(40)], author: 'Dev', email: 'dev@example.com', timestamp: 1_700_000_000, subject: 'tip commit', refs: [{ name: 'main', kind: 'local', head: true }], head: true },
    { sha: 'b'.repeat(40), parents: [], author: 'Dev', email: 'dev@example.com', timestamp: 1_699_000_000, subject: 'base commit', refs: [] },
  ],
  branches: [
    { name: 'main', sha: 'a'.repeat(40), remote: false, current: true },
    { name: 'origin/main', sha: 'a'.repeat(40), remote: true, current: false },
  ],
  truncated: false,
}

describe('GitPanel', () => {
  it('renders the no-repository state', async () => {
    await act(async () => {
      root.render(<GitPanel cwd="/project" git={{ isRepo: false, files: [] }} onRefreshGit={vi.fn()} />)
    })
    expect(container.textContent).toContain('No Git repository')
  })

  it('renders commits and branches from the bridge', async () => {
    const historyMock = vi.fn(async () => history)
    const commitDetail = vi.fn(async () => ({ sha: 'a'.repeat(40), parents: ['b'.repeat(40)], author: 'Dev', email: 'dev@example.com', timestamp: 1_700_000_000, body: 'tip commit', files: [{ path: 'file.ts', additions: 3, deletions: 1 }], truncated: false }))
    Object.defineProperty(window, 'prime', { configurable: true, value: { git: { history: historyMock, commitDetail } } })

    await act(async () => {
      root.render(<GitPanel cwd="/project" git={{ isRepo: true, branch: 'main', files: [] }} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
    })

    expect(historyMock).toHaveBeenCalledWith('/project')
    expect(container.textContent).toContain('tip commit')
    expect(container.textContent).toContain('base commit')
    expect(container.textContent).toContain('origin/main')
    expect(container.querySelectorAll('.git-commit-row')).toHaveLength(2)
    expect(container.querySelector('.git-graph')).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.git-commit-row')!.click()
      await Promise.resolve()
    })
    expect(commitDetail).toHaveBeenCalledWith('/project', 'a'.repeat(40))
    expect(container.textContent).toContain('file.ts')
  })
})
