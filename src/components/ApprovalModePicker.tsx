import { Check, ChevronDown, ShieldCheck } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { OMP_APPROVAL_MODES, type OmpApprovalMode } from '@/types/api'

interface ApprovalModePickerProps {
  value: OmpApprovalMode
  onChange(value: OmpApprovalMode): void
}

const TRIGGER_LABELS: Record<OmpApprovalMode, string> = {
  'inherit': 'Inherit',
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

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const label = TRIGGER_LABELS[value] ?? TRIGGER_LABELS.inherit
  return (
    <div className="approval-picker" ref={rootRef}>
      <button
        type="button"
        className="permissions-chip approval-picker__trigger"
        aria-label={`Approval mode: ${label}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <ShieldCheck size={12} />
        <span className="approval-picker__label">{label}</span>
        <ChevronDown className="approval-picker__chevron" size={11} />
      </button>
      {open ? (
        <div className="approval-picker__menu" id={menuId} role="menu" aria-label="Tool approval modes">
          <div className="approval-picker__heading">How should OMP tools be approved?</div>
          <div className="approval-picker__options">
            {OMP_APPROVAL_MODES.map((mode) => {
              const selected = mode === value
              const copy = OPTION_COPY[mode]
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`approval-picker__option ${selected ? 'is-active' : ''}`}
                  key={mode}
                  onClick={() => { setOpen(false); if (!selected) onChange(mode) }}
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
