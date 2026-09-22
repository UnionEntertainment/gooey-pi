import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

type Orientation = 'vertical' | 'horizontal'

interface ResizeHandleProps {
  orientation: Orientation
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  /** 'leading' (default): panel sits after the handle, dragging toward window start grows it. 'trailing': panel sits before the handle. */
  edge?: 'leading' | 'trailing'
  /** Element the live-drag preview writes cssVariable to. Defaults to the enclosing .session-workspace. */
  targetSelector?: string
  cssVariable?: string
  onChange(value: number): void
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(min, max), Math.max(min, value)))

export function ResizeHandle({ orientation, label, value, min, max, defaultValue, edge = 'leading', targetSelector = '.session-workspace', cssVariable, onChange }: ResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const safeMax = Math.max(min, max)
  const readCoordinate = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => orientation === 'vertical' ? event.clientX : event.clientY
  const grow = edge === 'trailing' ? 1 : -1
  const variable = cssVariable ?? (orientation === 'vertical' ? '--inspector-width' : '--terminal-height')

  useEffect(() => () => cleanupRef.current?.(), [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 12
    let next: number | undefined
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = safeMax
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = value - step * grow
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = value + step * grow
    if (next === undefined) return
    event.preventDefault()
    onChange(clamp(next, min, safeMax))
  }

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    cleanupRef.current?.()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const startCoordinate = readCoordinate(event.nativeEvent)
    const startValue = value
    const workspace = target.closest<HTMLElement>(targetSelector)
    let latestValue = startValue
    target.dataset.resizing = 'true'
    document.body.classList.add(`is-resizing-${orientation}`)
    target.setPointerCapture(pointerId)

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      latestValue = clamp(startValue + (readCoordinate(moveEvent) - startCoordinate) * grow, min, safeMax)
      workspace?.style.setProperty(variable, `${latestValue}px`)
    }
    const finish = (finishEvent?: PointerEvent, commit = true) => {
      if (finishEvent && finishEvent.pointerId !== pointerId) return
      delete target.dataset.resizing
      document.body.classList.remove('is-resizing-vertical', 'is-resizing-horizontal')
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      cleanupRef.current = null
      if (commit && latestValue !== startValue) onChange(latestValue)
      else if (!commit) workspace?.style.setProperty(variable, `${startValue}px`)
    }
    const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false)
    cleanupRef.current = () => finish(undefined, false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  return (
    <div
      className={`resize-handle resize-handle--${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`${label} · double-click to reset`}
      onDoubleClick={() => onChange(clamp(defaultValue, min, safeMax))}
      onKeyDown={handleKeyDown}
      onPointerDown={beginDrag}
    ><span aria-hidden="true" /></div>
  )
}
