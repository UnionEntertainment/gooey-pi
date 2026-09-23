import { Check, ChevronDown, ShieldCheck } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { OMP_APPROVAL_MODES, type OmpApprovalMode } from '@/types/api'

interface ApprovalModePickerProps {
  value: OmpApprovalMode
  onChange(value: OmpApprovalMode): void
}

const TRIGGER_LABELS: Record<OmpApprovalMode, string> = {
  'inherit': 'omp default',
  'always-ask': 'Always ask',
  'write': 'Write',
  'yolo': 'YOLO',
}

// Descriptions mirror omp's own tools.approvalMode option copy.
const OPTION_COPY: Record<OmpApprovalMode, { label: string; detail: string }> = {
  'inherit': { label: 'Inherit omp config', detail: 'Use the approval mode from your omp configuration.' },
  'always-ask': { label: 'Always ask', detail: 'Auto-approve read-only tools; confirm writes and commands.' },
  'write': { label: 'Write', detail: 'Auto-approve reads and file writes; confirm commands like bash.' },
  'yolo': { label: 'YOLO', detail: 'Auto-approve every tool, including commands. Never prompts.' },
}

export function ApprovalModePicker({ value, onChange }: ApprovalModePickerProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Opening lands focus on the checked item so the next keystroke acts on a
  // visible option instead of the document body.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const selected = menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
    selected?.focus()
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    if (!items.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = current < 0
        ? direction > 0 ? 0 : items.length - 1
        : (current + direction + items.length) % items.length
      items[next].focus()
    }
    else if (event.key === 'Home') { event.preventDefault(); items[0].focus() }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus() }
  }

  const label = TRIGGER_LABELS[value] ?? TRIGGER_LABELS.inherit
  return (
    <div className="approval-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="permissions-chip approval-picker__trigger"
        aria-label={`Approval mode: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <ShieldCheck size={12} />
        <span className="approval-picker__label">{label}</span>
        <ChevronDown className="approval-picker__chevron" size={11} />
      </button>
      {open ? (
        <div className="approval-picker__menu" id={menuId} role="menu" aria-label="Tool approval modes" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <div className="approval-picker__heading">How should OMP tools be approved?</div>
          <div className="approval-picker__options">
            {OMP_APPROVAL_MODES.map((mode: OmpApprovalMode) => {
              const selected = mode === value
              const copy = OPTION_COPY[mode]
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`approval-picker__option ${selected ? 'is-active' : ''}`}
                  key={mode}
                  onClick={() => { close(true); if (!selected) onChange(mode) }}
                >
                  <span className="approval-picker__check">{selected ? <Check size={13} /> : null}</span>
                  <span className="approval-picker__option-copy"><strong>{copy.label}</strong><span>{copy.detail}</span></span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
