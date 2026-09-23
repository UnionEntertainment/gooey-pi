import { ArrowLeft, ArrowRight, ExternalLink, History, MessageCirclePlus, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { annotationMarkersScript, annotationPickerScript, annotationTakeScript } from '@/lib/annotation-picker'
import { MAX_BROWSER_ANNOTATIONS, sanitizeCapturedElement } from '@/lib/browser-annotations'
import { detectRendererPlatform, shortcutLabel } from '@/lib/platform-shortcuts'
import type { BrowserAnnotationsApi } from '@/hooks/useBrowserAnnotations'
import { BROWSER_PARTITION, type BrowserAnnotationElement } from '@/types/api'
import { IconButton } from '../ui'

type WebviewElement = HTMLElement & {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  getWebContentsId(): number
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  reload(): void
  stop(): void
  executeJavaScript(code: string): Promise<unknown>
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

/**
 * Electron's webview.executeJavaScript throws synchronously (not a rejected
 * promise) until the guest emits dom-ready, so a bare call from a mount
 * effect crashes the renderer. Route every call through this guard.
 */
function runInPage(view: WebviewElement, code: string): Promise<unknown> {
  try {
    return view.executeJavaScript(code).catch(() => undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return 'about:blank'
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('about:')) return trimmed
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(trimmed)) return `http://${trimmed}`
  if (trimmed.includes('.') && !trimmed.includes(' ')) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

interface BrowserPanelProps {
  navigationRequest?: { id: number; url: string }
  onNavigationRequestHandled?(id: number): void
  platform?: NodeJS.Platform
  home: string
  onOpenExternal(url: string): void
  annotations: BrowserAnnotationsApi
  /** Test hook: how often to poll the page for a clicked element while picking. */
  pollIntervalMs?: number
}

export function BrowserPanel({ home, navigationRequest, onNavigationRequestHandled, onOpenExternal, annotations, pollIntervalMs = 350, platform = detectRendererPlatform() }: BrowserPanelProps) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(home)
  const [currentUrl, setCurrentUrl] = useState(home)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [picking, setPicking] = useState(false)
  const [domReady, setDomReady] = useState(false)
  const [pendingElement, setPendingElement] = useState<BrowserAnnotationElement | null>(null)
  const [annotationText, setAnnotationText] = useState('')
  const [notice, setNotice] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(() => [home])
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const noticeTimerRef = useRef<number | null>(null)
  const lastMarkersRef = useRef('')
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const annotateButtonRef = useRef<HTMLButtonElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const annotationTextareaRef = useRef<HTMLTextAreaElement>(null)

  const showNotice = (text: string) => {
    setNotice(text)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null
      setNotice('')
    }, 5_000)
  }
  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const view = webviewRef.current
    if (!view) return
    const sync = () => {
      try {
        const url = view.getURL() || home
        setCurrentUrl(url)
        setAddress(url)
        setCanBack(view.canGoBack())
        setCanForward(view.canGoForward())
        setHistory((items) => (items.at(-1) === url ? items : [...items.slice(-19), url]))
      } catch {
        /* webview not ready */
      }
    }
    const didStart = () => setLoading(true)
    const didStop = () => {
      setLoading(false)
      sync()
    }
    // A full navigation replaces the document: the injected picker and markers
    // are gone, and annotations captured on other pages become stale.
    const didNavigate = () => {
      sync()
      lastMarkersRef.current = ''
      setPicking(false)
      setPendingElement(null)
      setAnnotationText('')
      try {
        annotationsRef.current.handleNavigation(view.getURL())
      } catch {
        /* webview not ready */
      }
    }
    // dom-ready is the earliest point at which executeJavaScript is legal;
    // it fires again for every subsequent document, so markers re-apply.
    const onDomReady = () => {
      setDomReady(true)
      lastMarkersRef.current = ''
    }
    view.addEventListener('dom-ready', onDomReady)
    view.addEventListener('did-start-loading', didStart)
    view.addEventListener('did-stop-loading', didStop)
    view.addEventListener('did-navigate', didNavigate)
    view.addEventListener('did-navigate-in-page', sync)
    return () => {
      view.removeEventListener('dom-ready', onDomReady)
      view.removeEventListener('did-start-loading', didStart)
      view.removeEventListener('did-stop-loading', didStop)
      view.removeEventListener('did-navigate', didNavigate)
      view.removeEventListener('did-navigate-in-page', sync)
    }
  }, [home])

  // While annotation mode is on, the picker runs inside the page; poll it for
  // the element the user clicked. Stopping cleans up the page-side listeners.
  useEffect(() => {
    const view = webviewRef.current
    if (!picking || !view || !domReady) return
    let disposed = false
    let inFlight = false
    void runInPage(view, annotationPickerScript('start'))
    const interval = window.setInterval(() => {
      if (inFlight) return
      inFlight = true
      runInPage(view, annotationTakeScript())
        .then((payload) => {
          inFlight = false
          if (disposed || typeof payload !== 'string') return
          let parsed: unknown
          try {
            parsed = JSON.parse(payload)
          } catch {
            return
          }
          const element = Array.isArray(parsed) ? sanitizeCapturedElement(parsed[0]) : null
          if (!element) return
          setPendingElement(element)
          setAnnotationText('')
          setPicking(false)
        })
        .catch(() => {
          inFlight = false
        })
    }, pollIntervalMs)
    return () => {
      disposed = true
      window.clearInterval(interval)
      void runInPage(view, annotationPickerScript('stop'))
    }
  }, [picking, pollIntervalMs, domReady])

  // Persistent numbered markers for every live annotation on the current page.
  const markers = annotations.annotations.flatMap((annotation, index) => (annotation.stale ? [] : [{ selector: annotation.element.selector, index: index + 1 }]))
  const markerSignature = `${currentUrl}|${markers.map((marker) => `${marker.index}:${marker.selector}`).join('|')}`
  useEffect(() => {
    const view = webviewRef.current
    if (!view || !domReady || loading || lastMarkersRef.current === markerSignature) return
    lastMarkersRef.current = markerSignature
    void runInPage(view, annotationMarkersScript(markers))
  }, [markerSignature, loading, domReady])

  const navigate = useCallback((value: string) => {
    const url = normalizeUrl(value)
    setAddress(url)
    setCurrentUrl(url)
    void webviewRef.current?.loadURL(url).catch((error: unknown) => {
      if (!String(error).includes('ERR_ABORTED')) console.error('Browser navigation failed', error)
    })
  }, [])
  useEffect(() => {
    if (!navigationRequest || !domReady) return
    navigate(navigationRequest.url)
    onNavigationRequestHandled?.(navigationRequest.id)
  }, [domReady, navigate, navigationRequest, onNavigationRequestHandled])

  const closeHistory = (restoreFocus = true) => {
    setHistoryOpen(false)
    if (restoreFocus) historyButtonRef.current?.focus()
  }

  const discardAnnotation = (restoreFocus = true) => {
    setPendingElement(null)
    setAnnotationText('')
    if (restoreFocus) annotateButtonRef.current?.focus()
  }

  // Dismiss the innermost overlay first. Listening on window capture runs
  // before the inspector's own document-level Escape handler, so an overlay
  // never closes the whole panel.
  useEffect(() => {
    if (!historyOpen && !pendingElement && !picking) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.target instanceof HTMLElement && event.target.closest('.modal-backdrop')) return
      event.preventDefault()
      event.stopPropagation()
      if (historyOpen) closeHistory()
      else if (pendingElement) discardAnnotation()
      else setPicking(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [historyOpen, pendingElement, picking])

  useEffect(() => {
    if (!historyOpen) return
    const popover = historyRef.current
    const first = popover?.querySelector<HTMLElement>('.browser-history__entry') ?? popover?.querySelector<HTMLElement>('button')
    first?.focus()
  }, [historyOpen])

  useEffect(() => {
    if (pendingElement) annotationTextareaRef.current?.focus()
  }, [pendingElement])

  const toggleAnnotation = () => {
    if (picking) {
      setPicking(false)
      return
    }
    if (pendingElement) {
      discardAnnotation()
      return
    }
    if (annotationsRef.current.atCapacity) {
      showNotice(`Prime keeps at most ${MAX_BROWSER_ANNOTATIONS} annotations. Remove one from the composer attachment to add more.`)
      return
    }
    setNotice('')
    setPicking(true)
  }

  const saveAnnotation = (refocus = true) => {
    const view = webviewRef.current
    if (!pendingElement || !annotationText.trim()) return
    let pageTitle = ''
    let pageUrl = currentUrl
    try {
      pageTitle = view?.getTitle() ?? ''
      pageUrl = view?.getURL() || currentUrl
    } catch {
      /* webview not ready */
    }
    if (!annotationsRef.current.add({ comment: annotationText, element: pendingElement, pageUrl, pageTitle })) {
      showNotice(`Prime keeps at most ${MAX_BROWSER_ANNOTATIONS} annotations. Remove one from the composer attachment to add more.`)
      return
    }
    setPendingElement(null)
    setAnnotationText('')
    if (refocus) annotateButtonRef.current?.focus()
  }

  const webview = createElement('webview' as never, {
    ref: (node: WebviewElement | null) => {
      webviewRef.current = node
    },
    src: home,
    className: 'browser-webview',
    partition: BROWSER_PARTITION,
    webpreferences: 'contextIsolation=yes,sandbox=yes,nodeIntegration=no',
  })

  const count = annotations.annotations.length
  const staleCount = annotations.annotations.filter((annotation) => annotation.stale).length

  return (
    <div className="browser-panel">
      <div className="browser-preview">
      <div className="browser-toolbar">
        <IconButton label="Back" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          <ArrowLeft size={14} />
        </IconButton>
        <IconButton label="Forward" disabled={!canForward} onClick={() => webviewRef.current?.goForward()}>
          <ArrowRight size={14} />
        </IconButton>
        <IconButton label={loading ? 'Stop loading' : 'Reload'} onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}>
          {loading ? <X size={14} /> : <RefreshCw size={14} />}
        </IconButton>
        <form
          className="address-field"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(address)
          }}
        >
          <ShieldCheck size={12} />
          <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Browser address" spellCheck={false} />
          <button type="button" ref={historyButtonRef} aria-label="Browser history" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}>
            <History size={13} />
          </button>
        </form>
        <IconButton ref={annotateButtonRef} className={picking || pendingElement ? 'is-active annotation-active' : ''} label={picking ? 'Stop annotating' : 'Annotate page'} aria-pressed={picking} onClick={toggleAnnotation}>
          <MessageCirclePlus size={15} />
        </IconButton>
        <IconButton label="Open in default browser" onClick={() => onOpenExternal(currentUrl)}>
          <ExternalLink size={14} />
        </IconButton>
      </div>
      {historyOpen ? (
        <div className="browser-history" role="dialog" aria-label="Recent pages" ref={historyRef}>
          <div>
            <strong>Recent pages</strong>
            <button type="button" onClick={() => setHistory([])}>
              Clear
            </button>
          </div>
          {history
            .slice()
            .reverse()
            .map((url, index) => (
              <button
                type="button"
                className="browser-history__entry"
                key={`${url}-${index}`}
                onClick={() => {
                  navigate(url)
                  closeHistory()
                }}
              >
                <History size={12} />
                <span>{url}</span>
              </button>
            ))}
        </div>
      ) : null}
      <div className={`browser-viewport ${picking ? 'is-annotating' : ''}`}>
        {webview}
        {picking ? (
          <div className="annotation-hint" role="status">
            <MessageCirclePlus size={12} /> Click an element in the page to comment on it
          </div>
        ) : null}
        {pendingElement ? (
          <div className="annotation-layer">
            <div className="annotation-popover" role="dialog" aria-label="Comment on element">
              <div>
                <MessageCirclePlus size={14} />
                <strong>Comment on element {count + 1}</strong>
                <button
                  type="button"
                  aria-label="Discard annotation"
                  onClick={() => discardAnnotation()}
                >
                  <X size={13} />
                </button>
              </div>
              <textarea
                ref={annotationTextareaRef}
                data-autofocus
                value={annotationText}
                onChange={(event) => setAnnotationText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  if (!annotationText.trim()) return
                  const send = event.ctrlKey || event.metaKey
                  saveAnnotation(!send)
                  // Ctrl/Cmd+Enter also fires the composer's send with the saved annotation attached.
                  if (send) annotationsRef.current.requestSend()
                }}
                placeholder="Describe what should change…"
              />
              <p className="annotation-popover__hints">
                <span>
                  <kbd>{platform === 'darwin' ? '↩' : 'Enter'}</kbd> add to chat
                </span>
                <span>
                  <kbd>{shortcutLabel(platform, ['Primary', 'Enter'])}</kbd> send now
                </span>
              </p>
              <div>
                <button
                  type="button"
                  className="button"
                  onClick={() => discardAnnotation()}
                >
                  Cancel
                </button>
                <button type="button" className="button button--primary" disabled={!annotationText.trim()} onClick={() => saveAnnotation()}>
                  Add comment
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {count ? (
          <div className="annotation-count">
            <MessageCirclePlus size={12} /> {count} of {MAX_BROWSER_ANNOTATIONS} annotation{count === 1 ? '' : 's'}
            {staleCount ? ` · ${staleCount} from earlier pages` : ''}
          </div>
        ) : null}
        {notice ? (
          <p className="annotation-notice" role="alert">
            {notice}
          </p>
        ) : null}
      </div>
      </div>
    </div>
  )
}
