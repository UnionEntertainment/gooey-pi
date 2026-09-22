import type { ComposerImage, ComposerTextFile } from '@/hooks/useComposerAttachments'
import type { BrowserAnnotation } from '@/types/api'

export interface ComposerDraftSnapshot {
  text: string
  model?: string
  effort?: string
  fast?: boolean
  images?: ComposerImage[]
  textFiles?: ComposerTextFile[]
  annotations?: BrowserAnnotation[]
}

const COMPOSER_DRAFT_PREFIX = 'prime-work.composer-draft.v2:'
const ACTIVE_SCOPE_KEY = 'prime-work.composer-draft.active-scope'

export function composerDraftStorageKey(scope: string): string {
  return `${COMPOSER_DRAFT_PREFIX}${scope}`
}

/**
 * Snapshot the composer's current DOM value into the active scope's draft so a
 * crash-and-reload keeps the draft. Scoped drafts already persist on every
 * keystroke; this only covers state that never reached React.
 */
export function saveComposerDraftFromDom(): void {
  try {
    const scope = window.sessionStorage.getItem(ACTIVE_SCOPE_KEY)
    if (!scope) return
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea')
    if (!textarea?.value) return
    saveComposerDraft(scope, { text: textarea.value })
  } catch { /* storage unavailable */ }
}

export function saveComposerDraft(scope: string, snapshot: Partial<ComposerDraftSnapshot>): void {
  try {
    // The active scope lets a crash snapshot find the draft it belongs to.
    window.sessionStorage.setItem(ACTIVE_SCOPE_KEY, scope)
    const key = composerDraftStorageKey(scope)
    const previous = readComposerDraft(scope)
    const next: ComposerDraftSnapshot = {
      text: snapshot.text ?? previous?.text ?? '',
      model: snapshot.model || previous?.model,
      effort: snapshot.effort ?? previous?.effort,
      fast: snapshot.fast ?? previous?.fast,
      images: snapshot.images ?? previous?.images,
      textFiles: snapshot.textFiles ?? previous?.textFiles,
      annotations: snapshot.annotations ?? previous?.annotations,
    }
    // Model, effort, and fast mode ride along with typed text; alone they are not a draft.
    if (!next.text && !next.images?.length && !next.textFiles?.length && !next.annotations?.length) {
      window.sessionStorage.removeItem(key)
      return
    }
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Attachment payloads can exceed the sessionStorage quota; keep the text.
      window.sessionStorage.setItem(key, JSON.stringify({ ...next, images: undefined, textFiles: undefined }))
    }
  } catch { /* storage unavailable */ }
}

export function readComposerDraft(scope: string): ComposerDraftSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(composerDraftStorageKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && typeof (parsed as ComposerDraftSnapshot).text === 'string') {
      return parsed as ComposerDraftSnapshot
    }
    return null
  } catch {
    return null
  }
}

export function clearComposerDraft(scope: string): void {
  try {
    window.sessionStorage.removeItem(composerDraftStorageKey(scope))
  } catch { /* storage unavailable */ }
}
