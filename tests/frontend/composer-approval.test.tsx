// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/components/Composer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function props(overrides: Record<string, unknown> = {}) {
  return {
    busy: false,
    model: '',
    effort: 'medium' as const,
    modelsByProvider: new Map(),
    providers: [],
    reasoningLevels: ['medium' as const],
    fast: false,
    fastSupported: false,
    fastAvailable: false,
    imageInputSupported: true,
    skills: [],
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    onFastChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

describe('composer approval mode control', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.sessionStorage.clear()
  })

  it('shows the current mode on the trigger and lists every mode with its permissions', () => {
    act(() => root.render(<Composer {...props({ harness: 'omp', approvalMode: 'always-ask', onApprovalModeChange: vi.fn() })} />))

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Approval mode: Always ask"]')
    expect(trigger?.textContent).toContain('Always ask')

    act(() => trigger!.click())

    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    expect(options.map((option) => option.querySelector('strong')?.textContent)).toEqual(['Inherit omp config', 'Always ask', 'Write', 'YOLO'])
    expect(options.find((option) => option.getAttribute('aria-checked') === 'true')?.textContent).toContain('Always ask')
    // Each option explains what it permits, not just its name.
    expect(options[3].textContent).toContain('Never prompts')
  })

  it('reports the chosen mode and closes the menu', () => {
    const onApprovalModeChange = vi.fn()
    act(() => root.render(<Composer {...props({ harness: 'omp', approvalMode: 'inherit', onApprovalModeChange })} />))

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Approval mode: omp default"]')!.click())
    const yolo = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((option) => option.textContent?.includes('YOLO'))!
    act(() => yolo.click())

    expect(onApprovalModeChange).toHaveBeenCalledWith('yolo')
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('hides the control for harnesses without an approval system', () => {
    act(() => root.render(<Composer {...props({ harness: 'prime', approvalMode: 'yolo', onApprovalModeChange: vi.fn() })} />))
    expect(container.querySelector('.approval-picker')).toBeNull()

    act(() => root.render(<Composer {...props({ harness: 'pi', approvalMode: 'yolo', onApprovalModeChange: vi.fn() })} />))
    expect(container.querySelector('.approval-picker')).toBeNull()
  })
})
