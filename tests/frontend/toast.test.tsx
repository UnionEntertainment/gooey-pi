// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/ui'
import { TOAST_DURATION_MS, useToast } from '../../src/hooks/useToast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Toast', () => {
  it('clears each notification after 2.5 seconds and restarts for a replacement', async () => {
    let setToast!: (toast: string | null) => void
    function ToastProbe() {
      const state = useToast()
      setToast = state.setToast
      return state.toast ? <Toast message={state.toast} onDismiss={() => state.setToast(null)} /> : null
    }

    await act(async () => { root.render(<ToastProbe />) })
    await act(async () => { setToast('Session archived.') })
    expect(container.textContent).toContain('Session archived.')

    await act(async () => { vi.advanceTimersByTime(TOAST_DURATION_MS - 1) })
    expect(container.textContent).toContain('Session archived.')

    await act(async () => { setToast('Session restored.') })
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(container.textContent).toContain('Session restored.')

    // Expiry plays the exit animation first, then unmounts.
    await act(async () => { vi.advanceTimersByTime(TOAST_DURATION_MS) })
    expect(container.querySelector('.toast')?.classList.contains('is-exiting')).toBe(true)
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(container.querySelector('.toast')).toBeNull()
  })
})
