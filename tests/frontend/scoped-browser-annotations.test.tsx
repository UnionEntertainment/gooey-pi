// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBrowserAnnotations, useScopedBrowserAnnotations, type BrowserAnnotationsApi } from '../../src/hooks/useBrowserAnnotations'
import { readComposerDraft } from '../../src/lib/composer-draft'
import type { BrowserAnnotationElement } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const element = (): BrowserAnnotationElement => ({
  selector: '#main > button',
  tagName: 'button',
  id: 'submit',
  classes: ['btn'],
  text: 'Sign up',
  rect: { x: 10, y: 20, width: 120, height: 32 },
})

let container: HTMLDivElement
let root: Root
let api: BrowserAnnotationsApi

function Harness({ scope }: { scope?: string }) {
  api = useBrowserAnnotations()
  useScopedBrowserAnnotations(scope, api)
  return null
}

async function render(scope?: string): Promise<void> {
  await act(async () => { root.render(<Harness scope={scope} />) })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  window.sessionStorage.clear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.sessionStorage.clear()
})

describe('useScopedBrowserAnnotations', () => {
  it('keeps annotations scoped to their workspace draft', async () => {
    await render('project-a:new')
    act(() => {
      api.add({ comment: 'fix this button', element: element(), pageUrl: 'https://a.example/', pageTitle: 'A' })
    })
    expect(api.annotations).toHaveLength(1)
    expect(readComposerDraft('project-a:new')?.annotations).toHaveLength(1)

    await render('project-b:new')
    expect(api.annotations).toHaveLength(0)
    expect(readComposerDraft('project-b:new')?.annotations ?? []).toHaveLength(0)

    await render('project-a:new')
    expect(api.annotations).toHaveLength(1)
    expect(api.annotations[0].comment).toBe('fix this button')
  })

  it('clears the stored annotations when the scope clears them', async () => {
    await render('project-a:new')
    act(() => {
      api.add({ comment: 'note', element: element(), pageUrl: 'https://a.example/', pageTitle: 'A' })
    })
    act(() => api.clear())
    expect(readComposerDraft('project-a:new')?.annotations ?? []).toHaveLength(0)
  })
})
