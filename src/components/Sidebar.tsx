import {
  Archive,
  ArchiveRestore,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  ListFilter,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageCircleQuestion,
  NotebookPen,
  PackageOpen,
  PanelLeftClose,
  Pin,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { PROJECT_SORT_MODES, type AppMeta, type AppUpdateState, type HarnessId, type ProjectRecord, type ProjectSortMode, type SessionRecord, type WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES, HARNESS_SELECTOR_ORDER, HARNESS_SHORT_NAMES } from '@/lib/harness'
import { sortProjects } from '@/lib/project-order'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { activityNotificationSignature, activitySessionRevision, sessionAttentionSignature, signatureCleared } from '@/app/session-attention'
import { GooeyPiMark, IconButton, Modal, OmpMark, PiMark, PrimeMark, Toast, useFocusTrap } from './ui'

const PROJECT_SORT_LABEL_KEYS = { recent: 'projects.sort.recent', alphabetical: 'projects.sort.alphabetical' } as const satisfies Record<ProjectSortMode, MessageKey>

export interface SidebarProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  harnesses?: AppMeta['harnesses'] | null
  clearedAttention?: Record<string, string>
  clearedActivity?: Record<string, string>
  reviewedActivity?: Record<string, string>
  onToggleReviewed?(session: SessionRecord): void
  updateState?: AppUpdateState
  onUpdateAction?(): void | Promise<void>
  onSelectHarness?(harness: HarnessId): void
  onSelectProject(project: ProjectRecord): void
  onSelectSession(session: SessionRecord): void
  onNavigate(view: WorkspaceView): void
  onNewSession(project?: ProjectRecord): void
  onNewGlobalSession?(): void
  /** App-managed workspace directory; sessions rooted there render in the GooeyPi group. */
  globalWorkspaceDir?: string
  /** True while the active workspace is the project-less GooeyPi workspace. */
  globalActive?: boolean
  onAddProject(): void
  onRemoveProject(project: ProjectRecord): void
  projectSortMode?: ProjectSortMode
  onSetProjectSortMode?(mode: ProjectSortMode): void
  onTogglePinProject?(project: ProjectRecord): void
  onTogglePinSession?(session: SessionRecord): void
  onClose(): void
  onOpenPalette(): void
  onRenameSession(session: SessionRecord, title: string): Promise<void>
  onArchiveSession(session: SessionRecord): Promise<void>
  onRestoreSession?(session: SessionRecord): Promise<void> | void
  overlay?: boolean
  platform?: NodeJS.Platform
}

const STATUS_LABEL_KEYS = {
  idle: 'session.status.idle', running: 'session.status.running', waiting: 'session.status.waiting',
  complete: 'session.status.complete', failed: 'session.status.failed', unknown: 'session.status.unknown',
} as const satisfies Record<SessionRecord['status'], MessageKey>

const STATUS_META_KEYS = {
  running: 'session.meta.running', waiting: 'session.meta.waiting',
  failed: 'session.meta.failed',
} as const satisfies Partial<Record<SessionRecord['status'], MessageKey>>

const HOVER_CARD_DELAY_MS = 400
const HOVER_CARD_WIDTH = 264

/** Menus are popovers: pointerdown outside dismisses, Escape dismisses without
 *  reaching overlay-level handlers, and focus returns to the trigger. */
function usePopoverDismiss(open: boolean, stayInside: string, onClose: () => void, returnFocus?: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(stayInside)) closeRef.current()
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
      returnFocusRef.current?.()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [open, stayInside])
}

/** Arrow-key navigation for role="menu" popovers; Tab still passes through. */
function menuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')]
  if (!items.length) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowDown' ? (index + 1) % items.length
    : (index - 1 + items.length) % items.length
  items[next].focus()
}

/** Focus lands inside the menu so keyboard users can arrow immediately. */
function focusMenuItem(menu: HTMLElement | null) {
  menu?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitem"], [role="menuitemradio"]')?.focus()
}

interface OpenMenu {
  id: string
  returnFocus: HTMLElement | null
}


function formatSessionDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export const SIDEBAR_SESSION_LIMIT = 7
const ARCHIVED_PAGE_SIZE = 20

export interface SidebarIndexStats {
  projectPaths: number
  sessionScans: number
}

export function indexSidebarSessions(
  projects: ProjectRecord[],
  sessions: SessionRecord[],
  stats?: SidebarIndexStats,
): { activeSessions: SessionRecord[]; archivedSessions: SessionRecord[]; sessionsByProject: Map<string, SessionRecord[]> } {
  const activeSessions: SessionRecord[] = []
  const archivedSessions: SessionRecord[] = []
  const owners = new Map<string, string[]>()
  const sessionsByProject = new Map(projects.map((project) => [project.id, [] as SessionRecord[]]))
  for (const project of projects) for (const path of new Set([project.path, ...project.folders])) {
    if (stats) stats.projectPaths += 1
    const entries = owners.get(path) ?? []
    entries.push(project.id)
    owners.set(path, entries)
  }
  for (const session of sessions) {
    if (stats) stats.sessionScans += 1
    if (session.archived) { archivedSessions.push(session); continue }
    activeSessions.push(session)
    for (const projectId of owners.get(session.projectPath) ?? []) sessionsByProject.get(projectId)?.push(session)
  }
  const compareByLastUserMessage = (left: SessionRecord, right: SessionRecord) => {
    const pinnedOrder = Number(right.pinned ?? false) - Number(left.pinned ?? false)
    if (pinnedOrder) return pinnedOrder
    const difference = Date.parse(right.lastUserMessageAt ?? right.createdAt) - Date.parse(left.lastUserMessageAt ?? left.createdAt)
    return difference || right.createdAt.localeCompare(left.createdAt) || left.filePath.localeCompare(right.filePath)
  }
  activeSessions.sort(compareByLastUserMessage)
  archivedSessions.sort(compareByLastUserMessage)
  for (const projectSessions of sessionsByProject.values()) projectSessions.sort(compareByLastUserMessage)
  return { activeSessions, archivedSessions, sessionsByProject }
}

export function boundedSidebarSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, SIDEBAR_SESSION_LIMIT)
}

function SessionStatusMark({ status, attention }: { status: SessionRecord['status']; attention: boolean }) {
  const { t } = useI18n()
  const title = status === 'failed' && !attention ? t('session.status.failedCleared') : t(STATUS_LABEL_KEYS[status])
  if (status === 'running') return <span className="session-status-mark session-status-mark--running" title={title}><LoaderCircle className="spin" size={13} /></span>
  if (status === 'waiting') return <span className="session-status-mark session-status-mark--waiting" title={title}><MessageCircleQuestion size={12} /></span>
  if (status === 'complete') return <span className="session-status-mark session-status-mark--complete" title={title} />
  return <span className={`session-status-mark session-status-mark--${status}`} title={title}><span /></span>
}

const HARNESS_MARKS: Record<HarnessId, (props: { size?: number }) => ReactElement> = { omp: OmpMark, prime: PrimeMark, pi: PiMark }

function HarnessMark({ harness, size }: { harness: HarnessId; size: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
}

function updateControlCopy(state: AppUpdateState): { label: string; title: string } {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'checking': return { label: 'Checking for updates', title: 'Checking GitHub Releases for a new GooeyPi version' }
    case 'available': return { label: `Download${version}`, title: `Download and restart GooeyPi${version}` }
    case 'downloading': return {
      label: state.percent === undefined ? `Downloading${version}` : `Downloading${version} · ${state.percent}%`,
      title: `Downloading GooeyPi${version}`,
    }
    case 'downloaded': return { label: `Restart for${version}`, title: `Restart GooeyPi and install version${version}` }
    case 'not-available': return { label: 'GooeyPi is up to date', title: 'Check again for a new GooeyPi release' }
    case 'error': return { label: version ? `Retry update${version}` : 'Retry update', title: state.message ?? 'Update failed — try checking again' }
    case 'unsupported': return { label: 'Automatic updates', title: state.message ?? 'Automatic updates are available in installed builds' }
    default: return { label: 'Release updates', title: 'Check for a new GooeyPi release' }
  }
}

/** Announced without the percentage so progress ticks do not spam assistive tech. */
function updateAnnouncement(state: AppUpdateState): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'available': return `GooeyPi update${version} is available`
    case 'downloading': return `Downloading GooeyPi update${version}`
    case 'downloaded': return `GooeyPi update${version} is ready to install`
    case 'error': return `GooeyPi update failed. ${state.message ?? 'Try again.'}`
    default: return ''
  }
}

function updateConfirmCopy(state: AppUpdateState): { title: string; body: string } {
  if (state.phase === 'downloaded') return {
    title: 'Restart GooeyPi to install the update?',
    body: 'GooeyPi will close and restart to finish installing the update.',
  }
  return {
    title: 'Download and Restart GooeyPi?',
    body: 'GooeyPi will download the update, close, and restart when it is ready.',
  }
}

async function copySessionUuid(id: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(id)
      return
    } catch {
      // Fall back to the document copy command when clipboard permission is unavailable.
    }
  }
  const input = document.createElement('textarea')
  input.value = id
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.focus()
  input.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected')
  } finally {
    input.remove()
  }
}
function SidebarView({ projects, sessions, activeProjectId, activeSessionId, activeView, activeHarness = 'omp', harnesses, clearedAttention = {}, clearedActivity = {}, reviewedActivity = {}, onToggleReviewed, updateState = { phase: 'unsupported' }, onUpdateAction, onSelectHarness, onSelectProject, onSelectSession, onNavigate, onNewSession, onNewGlobalSession, globalWorkspaceDir, globalActive, onAddProject, onRemoveProject, projectSortMode = 'recent', onSetProjectSortMode = () => undefined, onTogglePinProject = () => undefined, onTogglePinSession = () => undefined, onClose, onOpenPalette, onRenameSession, onArchiveSession, onRestoreSession, overlay = false, platform = 'darwin' }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [archivedLimit, setArchivedLimit] = useState(ARCHIVED_PAGE_SIZE)
  const [rovingRow, setRovingRow] = useState<Record<string, string>>({})
  const [projectMenu, setProjectMenu] = useState<OpenMenu | null>(null)
  const [projectSortMenuOpen, setProjectSortMenuOpen] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<OpenMenu | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  // The focus trap's document-level Escape listener is registered before the
  // popovers' own listeners, so it must peel the topmost nested layer first;
  // the sidebar itself only closes when nothing nested is open. (Portaled
  // modals are outside the trap's container and handle their own Escape.)
  function handleSidebarEscape() {
    if (sessionMenu) { closeSessionMenu(); return }
    if (projectMenu) { closeProjectMenu(); return }
    if (archiveTarget) { setArchiveTarget(null); return }
    if (projectSortMenuOpen) { setProjectSortMenuOpen(false); focusSortToggle(); return }
    if (harnessMenuOpen) { setHarnessMenuOpen(false); focusBrandTrigger(); return }
    onClose()
  }
  const sidebarRef = useFocusTrap<HTMLElement>(overlay, handleSidebarEscape)
  const [sessionHover, setSessionHover] = useState<{ session: SessionRecord; top: number; left: number } | null>(null)
  const hoverTimerRef = useRef<number | undefined>(undefined)
  const clearSessionHover = () => {
    window.clearTimeout(hoverTimerRef.current)
    setSessionHover(null)
  }
  const scheduleSessionHover = (session: SessionRecord, event: MouseEvent<HTMLElement> | { currentTarget: HTMLElement }) => {
    window.clearTimeout(hoverTimerRef.current)
    const rect = event.currentTarget.getBoundingClientRect()
    hoverTimerRef.current = window.setTimeout(() => {
      setSessionHover({ session, top: Math.min(rect.top, Math.max(8, window.innerHeight - 300)), left: Math.min(rect.right + 10, Math.max(8, window.innerWidth - HOVER_CARD_WIDTH - 8)) })
    }, HOVER_CARD_DELAY_MS)
  }
  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), [])
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const { activeSessions, archivedSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
  }
  const isReviewed = (session: SessionRecord) => reviewedActivity[session.id] === activitySessionRevision(session)
  const hasUnreviewedActivity = (session: SessionRecord) => {
    const signature = activityNotificationSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedActivity[session.id], session.unread) && !isReviewed(session))
  }
  const unreadCount = activeSessions.reduce((count, session) => count + Number(needsAttention(session)), 0)
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const commandsShortcut = shortcutLabel(platform, ['Primary', 'K'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  const updateCopy = updateControlCopy(updateState)
  const updateConfirm = updateConfirmCopy(updateState)
  const updateBusy = updateState.phase === 'checking' || updateState.phase === 'downloading'
  const updateIndeterminate = updateState.phase === 'downloading' && updateState.percent === undefined
  const updateVisible = updateState.phase === 'available' || updateState.phase === 'downloading' || updateState.phase === 'downloaded' || updateState.phase === 'error'
  const [toast, setToast] = useState<string | null>(null)
  const focusBrandTrigger = () => sidebarRef.current?.querySelector<HTMLElement>('.brand-switcher__trigger')?.focus()
  const focusSortToggle = () => sidebarRef.current?.querySelector<HTMLElement>('.sidebar__sort-toggle')?.focus()
  const closeProjectMenu = () => { projectMenu?.returnFocus?.focus(); setProjectMenu(null) }
  const closeSessionMenu = () => { sessionMenu?.returnFocus?.focus(); setSessionMenu(null) }
  usePopoverDismiss(harnessMenuOpen, '.brand-switcher', () => setHarnessMenuOpen(false), focusBrandTrigger)
  usePopoverDismiss(projectMenu !== null, '.project-group', () => setProjectMenu(null), () => projectMenu?.returnFocus?.focus())
  usePopoverDismiss(projectSortMenuOpen, '.sidebar__sort-menu, .sidebar__sort-toggle', () => setProjectSortMenuOpen(false), focusSortToggle)
  usePopoverDismiss(sessionMenu !== null, '.session-row-wrap', () => setSessionMenu(null), () => sessionMenu?.returnFocus?.focus())
  usePopoverDismiss(archiveTarget !== null, '[data-archive-confirming="true"]', () => setArchiveTarget(null))
  const sessionMeta = (session: SessionRecord) => session.status in STATUS_META_KEYS ? t(STATUS_META_KEYS[session.status as keyof typeof STATUS_META_KEYS]) : formatRelative(session.updatedAt)
  const normalized = query.trim().toLowerCase()
  const visibleProjects = useMemo(() => sortProjects(projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || (sessionsByProject.get(project.id) ?? []).some((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))), projectSortMode), [projects, sessionsByProject, normalized, projectSortMode])
  const visibleArchived = useMemo(() => archivedSessions.filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized)), [archivedSessions, normalized])
  const globalSessions = useMemo(() => globalWorkspaceDir
    ? activeSessions.filter((session) => session.projectPath === globalWorkspaceDir)
    : [], [activeSessions, globalWorkspaceDir])
  const visibleGlobalSessions = useMemo(() => globalSessions.filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized)), [globalSessions, normalized])
  // A fresh filter should not keep a stale pagination window.
  useEffect(() => setArchivedLimit(ARCHIVED_PAGE_SIZE), [normalized])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const openArchivedSession = (session: SessionRecord) => {
    restoreArchivedSession(session)
    onSelectSession(session)
  }
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null)
  // Restoring unmounts the focused row. Once the session leaves the archived
  // list, move focus to the next surviving row (or the section heading) —
  // unless the user already moved focus somewhere else.
  useEffect(() => {
    if (!restoringSessionId) return
    if (archivedSessions.some((session) => session.id === restoringSessionId)) return
    setRestoringSessionId(null)
    if (document.activeElement !== document.body) return
    const target = sidebarRef.current?.querySelector<HTMLElement>('.session-list--archived .session-row')
      ?? sidebarRef.current?.querySelector<HTMLElement>(`.session-row-wrap[data-session-id="${restoringSessionId}"] .session-row`)
      ?? sidebarRef.current?.querySelector<HTMLElement>('.sidebar__archived-toggle')
    target?.focus()
  }, [archivedSessions, restoringSessionId])
  const restoreArchivedSession = (session: SessionRecord) => {
    if (!onRestoreSession) return
    setRestoringSessionId(session.id)
    void onRestoreSession(session)
  }
  /** Roving tabindex per .session-list: one tab stop, arrows move between rows. */
  const sessionRowKey = (listId: string, key: string) => `${listId}:${key}`
  const rovingKeyFor = (listId: string, keys: string[]) => {
    const remembered = rovingRow[listId]
    return remembered && keys.includes(remembered) ? remembered : keys[0]
  }
  const sessionListKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.session-row')]
    if (!rows.length) return
    const index = rows.findIndex((row) => (row.closest('.session-row-wrap') ?? row).contains(document.activeElement))
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1)
      : Math.max(index - 1, 0)
    rows[next].focus()
  }
  const renderSessionRow = (listId: string, keys: string[]) => (session: SessionRecord) => (
    <div key={session.id} data-session-id={session.id} className={`session-row-wrap ${needsAttention(session) ? 'has-attention' : ''} ${activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''}`}>
      <button type="button" className="session-row" tabIndex={rovingKeyFor(listId, keys) === sessionRowKey(listId, session.id) ? 0 : -1} aria-describedby={sessionHover?.session.id === session.id ? 'session-hover-card' : undefined} onClick={() => { closeSessionMenu(); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); clearSessionHover(); setSessionMenu({ id: session.id, returnFocus: event.currentTarget }) }} onMouseEnter={(event) => scheduleSessionHover(session, event)} onMouseLeave={clearSessionHover} onFocus={(event) => { setRovingRow((current) => ({ ...current, [listId]: sessionRowKey(listId, session.id) })); scheduleSessionHover(session, event) }} onBlur={clearSessionHover}>
        <SessionStatusMark status={session.status} attention={needsAttention(session)} />
        <span className="session-row__text"><span className="session-row__heading"><span className="session-row__title">{session.title}</span>{hasUnreviewedActivity(session) ? <span className="session-row__unread" title="Unreviewed activity" aria-hidden="true" /> : null}{session.pinned ? <Pin className="session-row__pin" size={10} fill="currentColor" aria-hidden="true" /> : null}</span><span className="session-row__meta">{sessionMeta(session)}</span></span>
      </button>
      <div className="session-row__actions">
      {onToggleReviewed ? <IconButton
        size="small"
        className="session-row__review"
        label={isReviewed(session) ? `Mark ${session.title} as not reviewed` : `Mark ${session.title} as reviewed`}
        onClick={() => { closeSessionMenu(); onToggleReviewed(session) }}
      >{isReviewed(session) ? <Mail size={13} /> : <MailOpen size={13} />}</IconButton> : null}
      <IconButton
        size="small"
        className={`session-row__archive ${archiveTarget?.id === session.id ? 'is-confirming' : ''}`}
        label={archiveTarget?.id === session.id ? `Confirm archive ${session.title}` : `Archive ${session.title}`}
        data-archive-confirming={archiveTarget?.id === session.id}
        onClick={() => {
          closeSessionMenu()
          if (archiveTarget?.id !== session.id) { setArchiveTarget(session); return }
          setArchiveTarget(null)
          void onArchiveSession(session)
        }}
      >{archiveTarget?.id === session.id ? <Check size={13} /> : <Archive size={13}/>}</IconButton>
      </div>
      {sessionMenu?.id === session.id ? <div className="session-row__menu" role="menu" aria-label="Session options" ref={focusMenuItem} onKeyDown={menuKeyDown}><button type="button" role="menuitem" onClick={() => { closeSessionMenu(); onTogglePinSession(session) }}><Pin size={12}/> {t(session.pinned ? 'sessions.unpin' : 'sessions.pin')}</button><button type="button" role="menuitem" onClick={() => { closeSessionMenu(); void copySessionUuid(session.id).then(() => setToast(t('sidebar.copied')), () => setToast(t('sidebar.copyFailed'))) }}><Copy size={12}/> Copy session UUID</button><button type="button" role="menuitem" onClick={() => { closeSessionMenu(); setRenameTarget(session); setRenameValue(session.title) }}><SquarePen size={12}/> Rename</button>{onToggleReviewed ? <button type="button" role="menuitem" onClick={() => { closeSessionMenu(); onToggleReviewed(session) }}>{isReviewed(session) ? <Mail size={12}/> : <MailOpen size={12}/>} {isReviewed(session) ? 'Mark as not reviewed' : 'Mark as reviewed'}</button> : null}</div> : null}
    </div>
  )


  return (
    <aside ref={sidebarRef} className="sidebar" aria-label="Project and session navigation" tabIndex={overlay ? -1 : undefined}>
      <div className="sidebar__titlebar drag-region">
        <div className="traffic-light-clearance" aria-hidden="true" />
        <div className="sidebar__brand brand-switcher no-drag">
          <button
            type="button"
            className="brand-switcher__trigger"
            aria-haspopup="menu"
            aria-expanded={harnessMenuOpen}
            aria-label={`${HARNESS_PRODUCT_NAMES[activeHarness]} — switch harness`}
            title={`${HARNESS_PRODUCT_NAMES[activeHarness]} — switch harness`}
            onClick={() => setHarnessMenuOpen((open) => !open)}
          >
            <HarnessMark harness={activeHarness} size={24} />
            <span className="brand-switcher__name"><strong>{HARNESS_SHORT_NAMES[activeHarness]}</strong><small>Work</small></span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {harnessMenuOpen ? (
            <div className="brand-switcher__menu" role="menu" aria-label="Harness" ref={focusMenuItem} onKeyDown={menuKeyDown}>
              {HARNESS_SELECTOR_ORDER.filter((harness) => Boolean(harnesses?.[harness]?.path)).map((harness) => (
                  <button
                    type="button"
                    key={harness}
                    role="menuitemradio"
                    aria-checked={harness === activeHarness}
                    className={harness === activeHarness ? 'is-active' : ''}
                    onClick={() => { setHarnessMenuOpen(false); focusBrandTrigger(); if (harness !== activeHarness) onSelectHarness?.(harness) }}
                  >
                    <HarnessMark harness={harness} size={20} />
                    <span className="brand-switcher__option"><strong>{HARNESS_PRODUCT_NAMES[harness]}</strong></span>
                    {harness === activeHarness ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton label={`Hide sidebar (${sidebarShortcut})`} onClick={onClose}><PanelLeftClose size={16} /></IconButton>
        </div>
      </div>

      <nav className="sidebar__primary" aria-label="Primary">
        <button type="button" title={`New session (${newSessionShortcut})`} onClick={() => onNewSession()}><NotebookPen size={15} /><span>New session</span><kbd>{newSessionShortcut}</kbd></button>
        <button type="button" title="Search" onClick={() => { if (searchOpen) setQuery(''); else window.setTimeout(() => document.getElementById('session-search')?.focus(), 0); setSearchOpen((open) => !open) }} className={searchOpen ? 'is-active' : ''}><Search size={15} /><span>Search</span></button>
        {searchOpen ? (
          <div className="sidebar-search">
            <Search size={13} />
            <input id="session-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projects, chats, branches" aria-label="Search projects and sessions" />
            {query ? <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}>×</button> : null}
          </div>
        ) : null}
        <button type="button" title={t('nav.projects')} className={activeView === 'projects' ? 'is-active' : ''} onClick={() => onNavigate('projects')}><Folder size={15} /><span>{t('nav.projects')}</span></button>
        <button type="button" title={t('nav.activity')} className={activeView === 'activity' ? 'is-active' : ''} onClick={() => onNavigate('activity')}><Bell size={15} /><span>{t('nav.activity')}</span>{unreadCount ? <span className="nav-count">{unreadCount}</span> : null}</button>
        <button type="button" title={t('nav.scheduled')} className={activeView === 'scheduled' ? 'is-active' : ''} onClick={() => onNavigate('scheduled')}><CalendarClock size={15} /><span>{t('nav.scheduled')}</span></button>
        <button type="button" title={t('nav.capabilities')} className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><PackageOpen size={15} /><span>{t('nav.capabilities')}</span></button>
      </nav>

      <div className="sidebar__scroll scroll-area" onScroll={clearSessionHover}>
        {onNewGlobalSession ? (
          <div className="project-group">
            <div className={`project-row ${globalActive && activeView === 'session' ? 'is-selected' : ''}`}>
              <button className="project-row__collapse" type="button" aria-label={`${collapsed.gooeypi ? 'Expand' : 'Collapse'} GooeyPi`} title={`${collapsed.gooeypi ? 'Expand' : 'Collapse'} GooeyPi`} onClick={() => { closeProjectMenu(); setCollapsed((value) => ({ ...value, gooeypi: !collapsed.gooeypi })) }}>
                {collapsed.gooeypi ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
              <button className="project-row__main" type="button" onClick={() => { closeProjectMenu(); if (globalSessions.length) onSelectSession(globalSessions[0]); else onNewGlobalSession() }} title="Sessions without a project, with access to every GooeyPi thread">
                <GooeyPiMark size={14} />
                <span>GooeyPi</span>
              </button>
              <IconButton size="small" className="gooeypi-row__new-session row-action" label="New GooeyPi session" onClick={() => { closeProjectMenu(); onNewGlobalSession() }}><NotebookPen size={13} /></IconButton>
              {globalSessions.some((session) => session.status === 'running') ? <span className="project-working" title="Agent working"><LoaderCircle className="spin" size={13} /></span> : null}
            </div>
            {!collapsed.gooeypi ? (
              <div className="session-list" onKeyDown={sessionListKeyDown}>
                {boundedSidebarSessions(visibleGlobalSessions).map(renderSessionRow('global', [...boundedSidebarSessions(visibleGlobalSessions).map((item) => sessionRowKey('global', item.id)), ...(visibleGlobalSessions.length === 0 ? [sessionRowKey('global', 'empty')] : [])]))}
                {visibleGlobalSessions.length === 0 ? <button type="button" title="New GooeyPi session" className="session-row session-row--empty" tabIndex={rovingKeyFor('global', [sessionRowKey('global', 'empty')]) === sessionRowKey('global', 'empty') ? 0 : -1} onClick={() => { closeProjectMenu(); onNewGlobalSession() }} onFocus={() => setRovingRow((current) => ({ ...current, global: sessionRowKey('global', 'empty') }))}><NotebookPen size={12} /> New session</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="sidebar__section-heading"><span>Projects</span><span className="sidebar__section-heading-actions"><IconButton size="small" className="sidebar__sort-toggle" aria-haspopup="menu" aria-expanded={projectSortMenuOpen} label={t('projects.sort')} onClick={() => setProjectSortMenuOpen((open) => !open)}><ListFilter size={13} /></IconButton><IconButton size="small" label="Add project" onClick={onAddProject}><FolderPlus size={13} /></IconButton>{projectSortMenuOpen ? <div className="sidebar__sort-menu" role="menu" aria-label={t('projects.sort.menu')} ref={focusMenuItem} onKeyDown={menuKeyDown}>{PROJECT_SORT_MODES.map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={projectSortMode === mode} className={projectSortMode === mode ? 'is-active' : ''} onClick={() => { setProjectSortMenuOpen(false); focusSortToggle(); onSetProjectSortMode(mode) }}>{t(PROJECT_SORT_LABEL_KEYS[mode])}{projectSortMode === mode ? <Check size={12} aria-hidden="true" /> : null}</button>)}</div> : null}</span></div>
        {visibleProjects.length === 0 ? <p className="sidebar__empty">{normalized ? t('sidebar.empty.filtered') : t('sidebar.empty.none')}</p> : null}
        {visibleProjects.map((project) => {
          const projectSessions = (sessionsByProject.get(project.id) ?? []).filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized) || project.name.toLowerCase().includes(normalized))
          const isCollapsed = collapsed[project.id] ?? false
          const running = projectSessions.some((session) => session.status === 'running')
          return (
            <div className="project-group" key={project.id}>
              <div
                className={`project-row ${activeProjectId === project.id && activeView === 'session' ? 'is-selected' : ''}`}
                onContextMenu={(event) => { event.preventDefault(); setProjectMenu({ id: project.id, returnFocus: event.currentTarget.querySelector('.project-row__main') }) }}
              >
                <button className="project-row__collapse" type="button" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} onClick={() => { closeProjectMenu(); setCollapsed((value) => ({ ...value, [project.id]: !isCollapsed })) }}>
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="project-row__main" type="button" onClick={() => { closeProjectMenu(); onSelectProject(project) }} title={project.path}>
                  {activeProjectId === project.id ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{project.name}</span>
                  {project.pinned ? <Pin className="project-row__pin" size={11} fill="currentColor" /> : null}
                </button>
                <IconButton size="small" className="project-row__new-session row-action" label={`New session in ${project.name}`} onClick={() => { closeProjectMenu(); onNewSession(project) }}><NotebookPen size={13} /></IconButton>
                {running ? <span className="project-working" title="Agent working"><LoaderCircle className="spin" size={13} /></span> : null}
                {projectMenu?.id === project.id ? <div className="project-row__menu" role="menu" aria-label={`Project options for ${project.name}`} ref={focusMenuItem} onKeyDown={menuKeyDown}>{!project.inferred ? <button type="button" role="menuitem" onClick={() => { closeProjectMenu(); onTogglePinProject(project) }}><Pin size={12} /> {t(project.pinned ? 'projects.unpin' : 'projects.pin')}</button> : null}<button type="button" role="menuitem" onClick={() => { closeProjectMenu(); setRemoveTarget(project) }}><Trash2 size={12} /> Remove project</button></div> : null}
              </div>
              {!isCollapsed ? (
                <div className="session-list" onKeyDown={sessionListKeyDown}>
                  {boundedSidebarSessions(projectSessions).map(renderSessionRow(project.id, [...boundedSidebarSessions(projectSessions).map((item) => sessionRowKey(project.id, item.id)), ...(projectSessions.length === 0 ? [sessionRowKey(project.id, 'empty')] : [])]))}
                  {projectSessions.length === 0 ? <button type="button" title={`New session in ${project.name}`} className="session-row session-row--empty" tabIndex={rovingKeyFor(project.id, [sessionRowKey(project.id, 'empty')]) === sessionRowKey(project.id, 'empty') ? 0 : -1} onClick={() => { closeProjectMenu(); onNewSession(project) }} onFocus={() => setRovingRow((current) => ({ ...current, [project.id]: sessionRowKey(project.id, 'empty') }))}><NotebookPen size={12} /> New session</button> : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {archivedSessions.length ? (
          <div className="sidebar__archived">
            <button type="button" className="sidebar__section-heading sidebar__archived-toggle" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((open) => !open)}>
              <span className="sidebar__archived-label">{archivedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{t('nav.archived')}<span className="nav-count">{archivedSessions.length}</span></span>
            </button>
            {archivedOpen ? (
              <div className="session-list session-list--archived" onKeyDown={sessionListKeyDown}>
                {visibleArchived.slice(0, archivedLimit).map((session) => (
                  <div key={session.id} data-session-id={session.id} className={`session-row-wrap ${activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''}`}>
                    <button type="button" className="session-row" tabIndex={rovingKeyFor('archived', [...visibleArchived.slice(0, archivedLimit).map((item) => sessionRowKey('archived', item.id)), ...(visibleArchived.length > archivedLimit ? [sessionRowKey('archived', 'more')] : [])]) === sessionRowKey('archived', session.id) ? 0 : -1} title={t('sessions.restore')} onClick={() => { closeSessionMenu(); openArchivedSession(session) }} onMouseEnter={(event) => scheduleSessionHover(session, event)} onMouseLeave={clearSessionHover} onFocus={(event) => { setRovingRow((current) => ({ ...current, archived: sessionRowKey('archived', session.id) })); scheduleSessionHover(session, event) }} onBlur={clearSessionHover}>
                      <SessionStatusMark status={session.status} attention={false} />
                      <span className="session-row__text"><span className="session-row__heading"><span className="session-row__title">{session.title}</span></span><span className="session-row__meta">{sessionMeta(session)}</span></span>
                    </button>
                    {onRestoreSession ? <div className="session-row__actions"><IconButton
                      size="small"
                      className="session-row__archive"
                      label={`${t('sessions.restore')} ${session.title}`}
                      onClick={() => { closeSessionMenu(); restoreArchivedSession(session) }}
                    ><ArchiveRestore size={13}/></IconButton></div> : null}
                  </div>
                ))}
                {visibleArchived.length > archivedLimit ? <button type="button" className="session-row session-row--empty" tabIndex={rovingKeyFor('archived', [...visibleArchived.slice(0, archivedLimit).map((item) => sessionRowKey('archived', item.id)), sessionRowKey('archived', 'more')]) === sessionRowKey('archived', 'more') ? 0 : -1} onClick={() => setArchivedLimit((limit) => limit + ARCHIVED_PAGE_SIZE)} onFocus={() => setRovingRow((current) => ({ ...current, archived: sessionRowKey('archived', 'more') }))}>Show {Math.min(ARCHIVED_PAGE_SIZE, visibleArchived.length - archivedLimit)} more of {visibleArchived.length - archivedLimit}</button> : null}
                {visibleArchived.length === 0 ? <p className="sidebar__empty">{t('sidebar.empty.filtered')}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sidebar__footer">
        <button type="button" title="Commands" onClick={onOpenPalette}><Command size={15} /><span>Commands</span><kbd>{commandsShortcut}</kbd></button>
        {updateVisible ? (
          <>
            <span className="sr-only" role="status" aria-live="polite">{updateAnnouncement(updateState)}</span>
            <button
              type="button"
              className={`sidebar-update sidebar-update--${updateState.phase} ${updateIndeterminate ? 'sidebar-update--indeterminate' : ''}`}
              title={updateCopy.title}
              aria-label={updateCopy.title}
              disabled={updateBusy}
              onClick={() => { if (updateState.phase === 'error') void onUpdateAction?.(); else setConfirmUpdate(true) }}
            >
              <span className="sidebar-update__icon" style={{ '--update-progress': `${updateState.percent ?? 0}%` } as CSSProperties}><Download size={12} /></span>
              <span>{updateCopy.label}</span>
            </button>
          </>
        ) : null}
        <button type="button" title={t('nav.settings')} className={activeView === 'settings' ? 'is-active' : ''} onClick={() => onNavigate('settings')}><Settings size={15} /><span>{t('nav.settings')}</span><kbd>{settingsShortcut}</kbd></button>
      </div>
      {renameTarget ? <Modal title="Rename session" onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>Cancel</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>Rename</button></>}><label className="field"><span>Session name</span><input data-autofocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {removeTarget ? <Modal title="Remove project" onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>Remove</button></>}><p>Remove “{removeTarget.name}” from {HARNESS_PRODUCT_NAMES[activeHarness]}? The folder and saved sessions will not be deleted.</p></Modal> : null}
      {confirmUpdate ? <Modal title={updateConfirm.title} onClose={() => setConfirmUpdate(false)} footer={<><button type="button" className="button" onClick={() => setConfirmUpdate(false)}>No</button><button type="button" className="button button--primary" onClick={() => { setConfirmUpdate(false); void onUpdateAction?.() }}>Yes</button></>}><p>{updateConfirm.body}</p></Modal> : null}
      {sessionHover ? createPortal(
        <div id="session-hover-card" className="session-hover-card" role="tooltip" style={{ top: sessionHover.top, left: sessionHover.left }}>
          <strong className="session-hover-card__title">{sessionHover.session.title}</strong>
          {sessionHover.session.preview ? <p className="session-hover-card__preview">{sessionHover.session.preview}</p> : null}
          <dl className="session-hover-card__meta">
            <div><dt>Status</dt><dd>{t(STATUS_LABEL_KEYS[sessionHover.session.status])}</dd></div>
            <div><dt>Last message</dt><dd>{formatSessionDateTime(sessionHover.session.lastUserMessageAt ?? sessionHover.session.updatedAt)} · {formatRelative(sessionHover.session.lastUserMessageAt ?? sessionHover.session.updatedAt)}</dd></div>
            <div><dt>Created</dt><dd>{formatSessionDateTime(sessionHover.session.createdAt)}</dd></div>
            {sessionHover.session.model ? <div><dt>Model</dt><dd>{sessionHover.session.model}</dd></div> : null}
            <div><dt>Session</dt><dd><code>{sessionHover.session.id}</code></dd></div>
          </dl>
        </div>,
        document.body,
      ) : null}
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </aside>
  )
}

export function areSidebarPropsEqual(previous: SidebarProps, next: SidebarProps): boolean {
  return previous.projects === next.projects
    && previous.sessions === next.sessions
    && previous.activeProjectId === next.activeProjectId
    && previous.activeSessionId === next.activeSessionId
    && previous.activeView === next.activeView
    && previous.activeHarness === next.activeHarness
    && previous.harnesses === next.harnesses
    && previous.clearedAttention === next.clearedAttention
    && previous.clearedActivity === next.clearedActivity
    && previous.reviewedActivity === next.reviewedActivity
    && previous.onToggleReviewed === next.onToggleReviewed
    && previous.updateState === next.updateState
    && previous.onUpdateAction === next.onUpdateAction
    && previous.onSelectHarness === next.onSelectHarness
    && previous.onSelectProject === next.onSelectProject
    && previous.onSelectSession === next.onSelectSession
    && previous.onNavigate === next.onNavigate
    && previous.onNewSession === next.onNewSession
    && previous.onAddProject === next.onAddProject
    && previous.onRemoveProject === next.onRemoveProject
    && previous.projectSortMode === next.projectSortMode
    && previous.onSetProjectSortMode === next.onSetProjectSortMode
    && previous.onTogglePinProject === next.onTogglePinProject
    && previous.onClose === next.onClose
    && previous.onOpenPalette === next.onOpenPalette
    && previous.onNewGlobalSession === next.onNewGlobalSession
    && previous.globalWorkspaceDir === next.globalWorkspaceDir
    && previous.globalActive === next.globalActive
    && previous.onRenameSession === next.onRenameSession
    && previous.onArchiveSession === next.onArchiveSession
    && previous.onRestoreSession === next.onRestoreSession
    && previous.overlay === next.overlay
    && previous.platform === next.platform
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
