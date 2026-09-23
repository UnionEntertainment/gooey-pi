import { ArrowDown, ArrowUp, Bell, CheckCircle2, CircleAlert, Clock3, LayoutGrid, LoaderCircle, Rows3, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { ProjectRecord, SessionRecord, SessionStatus } from '@/types/api'
import { activityNotificationSignature, activitySessionRevision, signatureCleared } from '@/app/session-attention'
import { formatRelative } from '@/lib/data'
import { EmptyState, IconButton, Segmented } from '@/components/ui'
import { useVirtualRows } from '@/hooks/useVirtualRows'

export type ActivityFilter = 'all' | 'attention' | 'running'
export type ActivityMode = 'table' | 'kanban'
export const ACTIVITY_BATCH = 250
const ACTIVITY_ROW_HEIGHT = 53
const ACTIVITY_MODE_KEY = 'prime-work.activity-mode'

export interface ActivityViewState {
  filter: ActivityFilter
  query: string
  visibleLimit: number
}

export function updateActivityCriteria(state: ActivityViewState, criteria: Partial<Pick<ActivityViewState, 'filter' | 'query'>>): ActivityViewState {
  return { ...state, ...criteria, visibleLimit: ACTIVITY_BATCH }
}

export function growActivityBatch(state: ActivityViewState, total: number): ActivityViewState {
  return { ...state, visibleLimit: Math.min(total, state.visibleLimit + ACTIVITY_BATCH) }
}

function readActivityMode(): ActivityMode {
  return typeof window !== 'undefined' && window.localStorage?.getItem(ACTIVITY_MODE_KEY) === 'kanban' ? 'kanban' : 'table'
}



function statusLabel(status: SessionStatus): string {
  return status === 'waiting' ? 'Needs attention' : status === 'complete' ? 'Finished' : status
}

function StatusIcon({ status }: { status: SessionStatus }) {
  if (status === 'running') return <LoaderCircle className="spin" size={13} />
  if (status === 'failed' || status === 'waiting') return <CircleAlert size={13} />
  return <CheckCircle2 size={13} />
}

type SortKey = 'updated' | 'title' | 'project' | 'status'
const STATUS_ORDER: Record<SessionStatus, number> = { waiting: 0, failed: 1, running: 2, complete: 3, idle: 4, unknown: 5 }

const KANBAN_COLUMNS: Array<{ key: string; label: string; statuses: SessionStatus[]; dot: string }> = [
  { key: 'attention', label: 'Needs attention', statuses: ['waiting', 'failed'], dot: 'var(--warning)' },
  { key: 'running', label: 'Running', statuses: ['running'], dot: 'var(--prime)' },
  { key: 'finished', label: 'Finished', statuses: ['complete'], dot: 'var(--success)' },
  { key: 'idle', label: 'Idle', statuses: ['idle', 'unknown'], dot: 'var(--text-tertiary)' },
]

interface ActivityPageProps {
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  clearedActivity: Record<string, string>
  reviewedActivity: Record<string, string>
  onToggleReviewed(session: SessionRecord): void
  onOpen(session: SessionRecord): void
  onClear(sessions: SessionRecord[]): void
}

export function ActivityPage({ sessions, projects, clearedActivity, reviewedActivity, onToggleReviewed, onOpen, onClear }: ActivityPageProps) {
  const [viewState, setViewState] = useState<ActivityViewState>({ filter: 'all', query: '', visibleLimit: ACTIVITY_BATCH })
  const [mode, setMode] = useState<ActivityMode>(readActivityMode)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 })
  const { filter, query, visibleLimit } = viewState
  useEffect(() => { try { window.localStorage?.setItem(ACTIVITY_MODE_KEY, mode) } catch { /* storage unavailable */ } }, [mode])
  const projectNames = useMemo(() => new Map(projects.flatMap((project) => [...new Set([project.path, ...project.folders])].map((path) => [path, project.name] as const))), [projects])
  const normalized = query.trim().toLowerCase()
  const clearable = useMemo(() => sessions.filter((session) => {
    const signature = activityNotificationSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedActivity[session.id], session.unread))
  }), [clearedActivity, sessions])
  const visible = useMemo(() => sessions.filter((session) => {
    const signature = activityNotificationSignature(session)
    const statusMatches = !session.archived && (!signature || !signatureCleared(signature, clearedActivity[session.id], session.unread)) && (
      filter === 'all'
      || filter === 'attention' && (session.unread || session.status === 'waiting' || session.status === 'failed')
      || filter === 'running' && session.status === 'running'
    )
    const project = projectNames.get(session.projectPath) ?? session.projectPath.split('/').at(-1) ?? ''
    return statusMatches && (!normalized || `${session.title} ${session.preview ?? ''} ${project}`.toLowerCase().includes(normalized))
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [clearedActivity, sessions, filter, normalized, projectNames])
  const displayed = visible.slice(0, visibleLimit)
  const projectName = (path: string) => projectNames.get(path) ?? path.split('/').at(-1)
  const isReviewed = (session: SessionRecord) => reviewedActivity[session.id] === activitySessionRevision(session)
  const seenDot = (session: SessionRecord) => {
    const checked = isReviewed(session)
    return <button
      type="button"
      className={`seen-dot${checked ? ' is-checked' : ''}`}
      aria-label={checked ? `Mark ${session.title} as not reviewed` : `Mark ${session.title} as reviewed`}
      aria-pressed={checked}
      title={checked ? 'Mark as not reviewed' : 'Mark as reviewed'}
      onClick={(event) => { event.stopPropagation(); onToggleReviewed(session) }}
    />
  }

  const sorted = useMemo(() => [...visible].sort((a, b) => {
    let result = 0
    if (sort.key === 'updated') result = Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    else if (sort.key === 'title') result = a.title.localeCompare(b.title)
    else if (sort.key === 'project') result = (projectName(a.projectPath) ?? '').localeCompare(projectName(b.projectPath) ?? '')
    else result = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    return sort.dir === 1 ? result : -result
  }), [visible, sort, projectNames])
  const tableRows = useVirtualRows(sorted.length, ACTIVITY_ROW_HEIGHT)
  const isFiltered = filter !== 'all' || normalized !== ''
  const resetActivityFilters = () => setViewState((current) => updateActivityCriteria(current, { filter: 'all', query: '' }))
  const toggleSort = (key: SortKey) => setSort((current) => current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: key === 'updated' ? -1 : 1 })
  const arrow = (key: SortKey) => sort.key === key ? (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null

  const clearButton = (session: SessionRecord, className: string) => activityNotificationSignature(session)
    ? <button type="button" className={className} aria-label={`Clear ${session.title} activity`} title="Clear activity" onClick={(event) => { event.stopPropagation(); onClear([session]) }}><X size={15} /></button>
    : null

  return <div className="page scroll-area"><div className={mode === 'kanban' ? 'page-container' : 'page-container page-container--narrow'}>
    <header className="page-header"><div><h1>Activity</h1><p>Work in progress and sessions that need your attention.</p></div></header>
    <div className="page-tools page-tools--activity">
      <Segmented value={filter} label="Activity filter" onChange={(value) => setViewState((current) => updateActivityCriteria(current, { filter: value as ActivityFilter }))} options={[{ value: 'all', label: 'All' }, { value: 'attention', label: 'Needs attention' }, { value: 'running', label: 'Running' }]}/>
      <div className="activity-tools__right">
        <label className="page-search page-search--small"><Search size={13}/><input value={query} onChange={(event) => setViewState((current) => updateActivityCriteria(current, { query: event.target.value }))} placeholder="Filter by session or project"/></label>
        <div className="activity-mode" role="group" aria-label="Activity layout">
          <IconButton size="small" label="Table view" className={mode === 'table' ? 'is-active' : ''} onClick={() => setMode('table')}><Rows3 size={14} /></IconButton>
          <IconButton size="small" label="Board view" className={mode === 'kanban' ? 'is-active' : ''} onClick={() => setMode('kanban')}><LayoutGrid size={14} /></IconButton>
        </div>
        <button type="button" className="button button--compact activity-clear-all" disabled={!clearable.length} onClick={() => onClear(clearable)}>Clear all</button>
      </div>
    </div>
    {visible.length ? mode === 'table' ? (
      <table className="atable">
        <thead>
          <tr>
            <th className="atable__seen" aria-label="Reviewed" />
            <th className="atable__status"><button type="button" onClick={() => toggleSort('status')}>Status{arrow('status')}</button></th>
            <th><button type="button" onClick={() => toggleSort('title')}>Session{arrow('title')}</button></th>
            <th className="atable__project"><button type="button" onClick={() => toggleSort('project')}>Project{arrow('project')}</button></th>
            <th className="atable__time"><button type="button" onClick={() => toggleSort('updated')}>Updated{arrow('updated')}</button></th>
            <th className="atable__actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody ref={tableRows.listRef as unknown as RefObject<HTMLTableSectionElement>}>
          {tableRows.paddingTop ? <tr className="atable-spacer"><td colSpan={6} style={{ height: tableRows.paddingTop, padding: 0, border: 0 }} /></tr> : null}
          {sorted.slice(tableRows.start, tableRows.end).map((session) => (
            <tr key={session.id} className={`atable-row${isReviewed(session) ? ' is-checked' : ''}`} role="button" tabIndex={0} aria-label={`Open ${session.title}`} onClick={() => onOpen(session)} onKeyDown={(event) => { if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(session) } }}>
              <td className="atable__seen">{seenDot(session)}</td>
              <td><span className={`atable-status atable-status--${session.status}`}><StatusIcon status={session.status} />{statusLabel(session.status)}</span></td>
              <td className="atable__session">
                <span className="atable__title"><strong>{session.title}</strong>{session.unread ? <i className="activity-new">New</i> : null}</span>
                <span className="atable__preview">{session.preview ?? ''}</span>
              </td>
              <td className="atable__project">{projectName(session.projectPath)}</td>
              <td className="atable__time">{formatRelative(session.updatedAt)}</td>
              <td className="atable__actions">{clearButton(session, 'atable__clear')}</td>
            </tr>
          ))}
          {tableRows.paddingBottom ? <tr className="atable-spacer"><td colSpan={6} style={{ height: tableRows.paddingBottom, padding: 0, border: 0 }} /></tr> : null}
        </tbody>
      </table>
    ) : (
      <div className="kanban">
        {KANBAN_COLUMNS.map((column) => {
          const columnSessions = displayed.filter((session) => column.statuses.includes(session.status))
          return <section className="kanban-col" key={column.key} aria-label={`${column.label}, ${columnSessions.length}`}>
            <h2 className="kanban-col__heading">
              <span className="kanban-col__dot" style={{ background: column.dot }} />
              <span>{column.label}</span>
              <span className="kanban-col__count">{columnSessions.length}</span>
            </h2>
            <div className="kanban-col__cards">
              {columnSessions.length ? columnSessions.map((session) => (
                <div className={`kcard${isReviewed(session) ? ' is-checked' : ''}`} key={session.id}>
                  {seenDot(session)}
                  <button type="button" className="kcard__main" aria-label={`Open ${session.title}`} onClick={() => onOpen(session)}>
                    <span className="kcard__top">
                      <span className={`activity-icon activity-icon--${session.status} kcard__icon`}><StatusIcon status={session.status} /></span>
                      <strong className="kcard__title">{session.title}</strong>
                      {session.unread ? <i className="activity-new">New</i> : null}
                    </span>
                    {session.preview ? <span className="kcard__preview">{session.preview}</span> : null}
                    <span className="kcard__meta">
                      <span>{projectName(session.projectPath)}</span>
                      {session.status === 'failed' ? <span className="kcard__flag">Failed</span> : null}
                      <span className="kcard__time"><Clock3 size={10} />{formatRelative(session.updatedAt)}</span>
                    </span>
                  </button>
                  {clearButton(session, 'kcard__clear')}
                </div>
              )) : <p className="kanban-col__empty">Nothing here</p>}
            </div>
          </section>
        })}
      </div>
    ) : isFiltered ? (
      <EmptyState icon={<Search size={24}/>} title="No matching activity" action={<button type="button" className="button button--compact" onClick={resetActivityFilters}>Clear search and filters</button>}>Nothing matches the current filter or search.</EmptyState>
    ) : (
      <EmptyState icon={<Bell size={24}/>} title="You’re all caught up">Running sessions and new results will appear here.</EmptyState>
    )}
    {mode === 'kanban' && visible.length > displayed.length ? <button type="button" className="page-show-more" onClick={() => setViewState((current) => growActivityBatch(current, visible.length))}>Show {Math.min(ACTIVITY_BATCH, visible.length - displayed.length)} more sessions</button> : null}
  </div></div>
}
