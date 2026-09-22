// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearComposerDraft,
  composerDraftStorageKey,
  readComposerDraft,
  saveComposerDraft,
} from '../../src/lib/composer-draft'

afterEach(() => {
  window.sessionStorage.clear()
})

describe('composer draft storage', () => {
  it('round-trips text and model selection for a workspace scope', () => {
    saveComposerDraft('project:new', { text: 'Ship the sidebar', model: 'openai:gpt-5.2', effort: 'high', fast: true })
    expect(readComposerDraft('project:new')).toEqual({
      text: 'Ship the sidebar',
      model: 'openai:gpt-5.2',
      effort: 'high',
      fast: true,
    })
    expect(window.sessionStorage.getItem(composerDraftStorageKey('other'))).toBeNull()
  })

  it('clears a sent draft without leaking another workspace', () => {
    saveComposerDraft('project:new', { text: 'keep me', model: 'openai:gpt-5.2' })
    saveComposerDraft('project:session', { text: 'other' })
    clearComposerDraft('project:new')
    expect(readComposerDraft('project:new')).toBeNull()
    expect(readComposerDraft('project:session')).toEqual({ text: 'other' })
  })

  it('does not leak a draft into a scope that has none', () => {
    saveComposerDraft('project-a:new', { text: 'project A draft' })
    expect(readComposerDraft('project-b:new')).toBeNull()
  })

  it('round-trips attachments with the draft', () => {
    const images = [{ id: 'img-1', name: 'shot.png', size: 4, type: 'image' as const, mimeType: 'image/png', data: 'aGk=' }]
    const textFiles = [{ id: 'file-1', name: 'notes.txt', size: 10, mimeType: 'text/plain', text: 'plain text', truncated: false }]
    saveComposerDraft('project:new', { text: '', images, textFiles })
    expect(readComposerDraft('project:new')).toEqual({ text: '', images, textFiles })
  })

  it('keeps the text draft when attachments exceed the storage quota', () => {
    // jsdom's sessionStorage uses its own Storage class, not the global one.
    const proto = Object.getPrototypeOf(window.sessionStorage) as Storage
    const originalSetItem = proto.setItem
    const setItem = vi.spyOn(proto, 'setItem')
    setItem.mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === composerDraftStorageKey('project:new') && value.includes('aGk=')) {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    })
    try {
      saveComposerDraft('project:new', {
        text: 'keep the text',
        images: [{ id: 'img-1', name: 'shot.png', size: 4, type: 'image', mimeType: 'image/png', data: 'aGk=' }],
      })
    } finally {
      setItem.mockRestore()
    }
    expect(readComposerDraft('project:new')).toEqual({ text: 'keep the text' })
  })
})
