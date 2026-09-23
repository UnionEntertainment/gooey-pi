import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

interface VirtualWindow {
  /** Ref for the element that wraps the rendered rows (the spacer). */
  listRef: RefObject<HTMLDivElement | null>
  /** First index to render. */
  start: number
  /** One past the last index to render. */
  end: number
  /** Padding that positions the rendered window inside the spacer. */
  paddingTop: number
  paddingBottom: number
}

/**
 * Fixed-row-height windowing for long lists. Renders only the rows near the
 * scrollport; the spacer keeps the full scroll height so position and keyboard
 * navigation stay stable.
 *
 * Usage: attach `listRef` to the element that contains the rows and give it
 * `position: relative` (or use the returned paddings on the first/last rows).
 * The scroll container is auto-detected as the nearest scrollable ancestor;
 * pass `scrollRef` when the scroller is not an ancestor (e.g. a shared pane).
 */
export function useVirtualRows(count: number, rowHeight: number, options?: {
  scrollRef?: RefObject<HTMLElement | null>
  /** Extra rows rendered above/below the viewport. Default 8. */
  overscan?: number
}): VirtualWindow {
  const overscan = options?.overscan ?? 8
  const listRef = useRef<HTMLDivElement | null>(null)
  const [window_, setWindow] = useState({ start: 0, end: Math.min(count, 40) })

  const recompute = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const scroller = options?.scrollRef?.current ?? nearestScroller(list)
    if (!scroller) {
      // No measurable viewport (e.g. test DOM): render everything rather than
      // leaving a stale window that hides rows as the count changes.
      setWindow((current) => (current.start === 0 && current.end === count ? current : { start: 0, end: count }))
      return
    }
    const listTop = list.getBoundingClientRect().top
    const viewTop = scroller.getBoundingClientRect().top
    const offset = listTop - viewTop + scroller.scrollTop
    const first = Math.max(0, Math.floor((scroller.scrollTop - offset) / rowHeight) - overscan)
    const visible = Math.ceil(scroller.clientHeight / rowHeight) + overscan * 2
    const last = Math.min(count, first + visible)
    setWindow((current) => (current.start === first && current.end === last ? current : { start: first, end: last }))
  }, [count, rowHeight, overscan, options?.scrollRef])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const scroller = options?.scrollRef?.current ?? nearestScroller(list)
    recompute()
    if (!scroller) return
    scroller.addEventListener('scroll', recompute, { passive: true })
    if (typeof ResizeObserver === 'undefined') {
      return () => scroller.removeEventListener('scroll', recompute)
    }
    const observer = new ResizeObserver(recompute)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', recompute)
      observer.disconnect()
    }
  }, [recompute, options?.scrollRef])

  return {
    listRef,
    start: window_.start,
    end: window_.end,
    paddingTop: window_.start * rowHeight,
    paddingBottom: Math.max(0, (count - window_.end) * rowHeight),
  }
}

function nearestScroller(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflow}`)) return node
    node = node.parentElement
  }
  return null
}
