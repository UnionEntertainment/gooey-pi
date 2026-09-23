import { Check, ChevronDown, FolderGit2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CheckoutAction, CheckoutCatalog } from '@/types/api'

interface CheckoutPickerProps {
  catalog?: CheckoutCatalog
  fallbackLabel?: string
  loading?: boolean
  onExecute?(action: CheckoutAction): Promise<void> | void
}

function checkoutLabel(catalog: CheckoutCatalog | undefined, fallback: string | undefined): string {
  if (!catalog) return fallback ?? 'Checkout'
  if (catalog.strategy === 'branch') return catalog.activeName || fallback || 'Checkout'
  const active = catalog.checkouts.find((worktree) => worktree.path === catalog.activePath)
    ?? catalog.checkouts.find((worktree) => worktree.current)
  return active?.branch ?? active?.name ?? fallback ?? 'Checkout'
}

export function CheckoutPicker({ catalog, fallbackLabel, loading = false, onExecute }: CheckoutPickerProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [branch, setBranch] = useState('')
  const [error, setError] = useState('')
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const strategy = catalog?.strategy ?? 'worktree'

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  // Opening lands focus on the checked item (or the first option) so the next
  // keystroke acts on a visible menu item instead of the document body.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const selected = menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
      ?? menu?.querySelector<HTMLElement>('input')
    selected?.focus()
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = current < 0
        ? direction > 0 ? 0 : items.length - 1
        : (current + direction + items.length) % items.length
      items[next].focus()
    }
    // Home/End keep their native caret behavior inside the branch field.
    else if (!(event.target instanceof HTMLInputElement) && items.length) {
      if (event.key === 'Home') { event.preventDefault(); items[0].focus() }
      else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus() }
    }
  }

  const execute = async (action: CheckoutAction): Promise<boolean> => {
    if (!onExecute) return false
    setError('')
    try {
      await onExecute(action)
      close(true)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change checkout')
      return false
    }
  }

  const create = async (): Promise<void> => {
    const name = branch.trim()
    if (!name || creating || !onExecute) return
    setCreating(true)
    try {
      // Keep the typed name when the create fails so the error isn't shown
      // next to an emptied field.
      if (await execute({ strategy, operation: 'create', branch: name })) setBranch('')
    } finally {
      setCreating(false)
    }
  }

  const enabled = Boolean(onExecute && catalog && (catalog.checkouts.length > 0 || strategy === 'branch'))
  const label = checkoutLabel(catalog, fallbackLabel)
  return (
    <div className="worktree-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="permissions-chip worktree-picker__trigger"
        aria-label={`Checkout: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!enabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <FolderGit2 size={12} />
        <span className="worktree-picker__label">{label}</span>
        <ChevronDown className="worktree-picker__chevron" size={11} />
      </button>
      {open && catalog ? (
        <div className="worktree-picker__menu" id={menuId} role="menu" aria-label={strategy === 'worktree' ? 'Git worktrees' : 'Git branches'} ref={menuRef} onKeyDown={onMenuKeyDown}>
          <div className="worktree-picker__heading">Checkouts</div>
          <div className="worktree-picker__options">
            {loading ? <span className="worktree-picker__empty">Loading…</span> : catalog.checkouts.length === 0 ? <span className="worktree-picker__empty">No checkouts found</span> : catalog.strategy === 'worktree'
              ? catalog.checkouts.map((worktree) => {
                  const selected = worktree.path === catalog.activePath
                  return (
                    <button type="button" role="menuitemradio" aria-checked={selected} className={`worktree-picker__option ${selected ? 'is-active' : ''}`} key={worktree.path} onClick={() => { if (selected) close(true); else void execute({ strategy: 'worktree', operation: 'open', path: worktree.path }) }}>
                      <span className="worktree-picker__check">{selected ? <Check size={13} /> : null}</span>
                      <span className="worktree-picker__option-copy"><strong>{worktree.branch ?? worktree.name}</strong><span title={worktree.path}>{worktree.path}</span></span>
                    </button>
                  )
                })
              : catalog.checkouts.map((localBranch) => (
                  <button type="button" role="menuitemradio" aria-checked={localBranch.current} className={`worktree-picker__option ${localBranch.current ? 'is-active' : ''}`} key={localBranch.name} onClick={() => { if (localBranch.current) close(true); else void execute({ strategy: 'branch', operation: 'switch', branch: localBranch.name }) }}>
                    <span className="worktree-picker__check">{localBranch.current ? <Check size={13} /> : null}</span>
                    <span className="worktree-picker__option-copy"><strong>{localBranch.name}</strong><span>{localBranch.current ? 'Current branch' : 'Local branch'}</span></span>
                  </button>
                ))}
          </div>
          <form className="worktree-picker__create" onSubmit={(event) => { event.preventDefault(); void create() }}>
            <label htmlFor={`${menuId}-branch`}>Create {strategy}</label>
            <div>
              <input id={`${menuId}-branch`} value={branch} placeholder="New branch name" onChange={(event) => { setBranch(event.target.value); setError('') }} />
              <button type="submit" disabled={!branch.trim() || creating}>{creating ? 'Creating…' : 'Create'}</button>
            </div>
            {error ? <span role="alert">{error}</span> : null}
          </form>
        </div>
      ) : null}
    </div>
  )
}
