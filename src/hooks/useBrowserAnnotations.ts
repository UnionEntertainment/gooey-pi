import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addAnnotation, type BrowserAnnotationInput, createAnnotation, MAX_BROWSER_ANNOTATIONS, reconcileAnnotationsForUrl, removeAnnotation } from '@/lib/browser-annotations'
import { readComposerDraft, saveComposerDraft } from '@/lib/composer-draft'
import type { BrowserAnnotation } from '@/types/api'

export interface BrowserAnnotationsApi {
  annotations: BrowserAnnotation[]
  atCapacity: boolean
  /** Returns false when the 20-annotation cap blocks the add. */
  add(input: BrowserAnnotationInput): boolean
  remove(id: string): void
  clear(): void
  /** Replaces the set wholesale when the workspace scope changes; capped at the annotation limit. */
  restore(annotations: BrowserAnnotation[]): void
  /** Marks annotations from other pages stale after a full navigation; returning to a page revives its markers. */
  handleNavigation(url: string): void
  /** Monotonic counter; each bump asks the composer to send the current draft immediately. */
  sendSignal: number
  /** Requests an immediate composer send (used by Ctrl/Cmd+Enter in the annotation popover). */
  requestSend(): void
}

/** Owns the browser annotation set shared by the inspector BrowserPanel (capture, markers) and the Composer (attachment, prompt payload). */
export function useBrowserAnnotations(): BrowserAnnotationsApi {
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([])
  const [sendSignal, setSendSignal] = useState(0)
  const requestSend = useCallback(() => setSendSignal((current) => current + 1), [])
  const annotationsRef = useRef(annotations)
  const commit = useCallback((next: BrowserAnnotation[]) => {
    annotationsRef.current = next
    setAnnotations(next)
  }, [])

  const add = useCallback(
    (input: BrowserAnnotationInput) => {
      const result = addAnnotation(annotationsRef.current, createAnnotation(input, crypto.randomUUID(), Date.now()))
      if (!result.ok) return false
      commit(result.annotations)
      return true
    },
    [commit],
  )
  const remove = useCallback((id: string) => commit(removeAnnotation(annotationsRef.current, id)), [commit])
  const clear = useCallback(() => commit([]), [commit])
  const restore = useCallback((restored: BrowserAnnotation[]) => commit(restored.length > MAX_BROWSER_ANNOTATIONS ? restored.slice(0, MAX_BROWSER_ANNOTATIONS) : restored), [commit])
  const handleNavigation = useCallback((url: string) => commit(reconcileAnnotationsForUrl(annotationsRef.current, url)), [commit])

  // Stable container identity so memoized consumers (Inspector, Composer) do
  // not re-render while an agent streams; fields update independently.
  return useMemo(() => ({ annotations, atCapacity: annotations.length >= MAX_BROWSER_ANNOTATIONS, add, remove, clear, restore, handleNavigation, sendSignal, requestSend }), [add, annotations, clear, handleNavigation, remove, requestSend, restore, sendSignal])
}

/**
 * Keeps the annotation set scoped to the active workspace draft: restores the
 * scope's saved annotations on switch, then persists every later change back.
 * One effect so a scope switch never writes the outgoing scope's annotations
 * into the incoming scope's draft.
 */
export function useScopedBrowserAnnotations(scope: string | undefined, api: BrowserAnnotationsApi): void {
  const syncedRef = useRef<{ scope?: string; annotations: BrowserAnnotation[] }>({ annotations: [] })
  const annotations = api.annotations

  useEffect(() => {
    if (!scope) return
    if (syncedRef.current.scope !== scope) {
      const restored = readComposerDraft(scope)?.annotations ?? []
      syncedRef.current = { scope, annotations: restored }
      api.restore(restored)
      return
    }
    if (annotations === syncedRef.current.annotations) return
    syncedRef.current = { scope, annotations }
    saveComposerDraft(scope, { annotations })
  }, [api, annotations, scope])
}
