import { memo } from 'react'
import { PanelRightClose } from 'lucide-react'
import type { BrowserAnnotationsApi } from '@/hooks/useBrowserAnnotations'
import type { AutomationScheduleRecord, GitStatus, InspectorTab, NativeHeartbeatRecord, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import { BrowserPanel } from './inspector/BrowserPanel'
import { ChangesPanel } from './inspector/ChangesPanel'
import { FilesPanel } from './inspector/FilesPanel'
import { GitPanel } from './inspector/GitPanel'
import { SummaryPanel } from './inspector/SummaryPanel'
import { IconButton, useFocusTrap } from './ui'

export interface InspectorProps {
  platform?: NodeJS.Platform
  activeTab: InspectorTab
  onTabChange(tab: InspectorTab): void
  onClose(): void
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  cwd?: string
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
  automations: AutomationScheduleRecord[]
  heartbeats: NativeHeartbeatRecord[]
  onOpenAutomation(id: string): void
  browserHome: string
  browserNavigationRequest?: { id: number; url: string }
  onBrowserNavigationRequestHandled?(id: number): void
  browserAnnotations: BrowserAnnotationsApi
  onRefreshGit(): Promise<void> | void
  onOpenExternal(url: string): void
  onRevealPath(path: string): void
  onGrantProject(): Promise<void> | void
  overlay?: boolean
}

const tabs: Array<{ id: InspectorTab; label: string }> = [{ id: 'summary', label: 'Summary' }, { id: 'changes', label: 'Changes' }, { id: 'git', label: 'Git' }, { id: 'browser', label: 'Browser' }, { id: 'files', label: 'Files' }]

/** Memoized so streaming transcript updates (which this component no longer consumes outside the Summary tab) do not re-render the inspector shell. */
export const Inspector = memo(function Inspector({ activeTab, onTabChange, onClose, agentName, shortName, project, cwd, runtime, messages, git, automations, heartbeats, onOpenAutomation, browserHome, browserNavigationRequest, onBrowserNavigationRequestHandled, browserAnnotations, onRefreshGit, onOpenExternal, onRevealPath, onGrantProject, overlay = false, platform = 'darwin' }: InspectorProps) {
  const inspectorRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const moveTab = (current: number, key: string) => {
    let next = current
    if (key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (key === 'Home') next = 0
    else if (key === 'End') next = tabs.length - 1
    else return
    const tab = tabs[next]
    onTabChange(tab.id)
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${tab.id}`)?.focus())
  }
  return <aside ref={inspectorRef} className="inspector" aria-label="Session inspector" tabIndex={overlay ? -1 : undefined}>
    <div className="inspector__tabs" role="tablist" aria-label="Inspector views">
      {tabs.map((tab, index) => <button id={`inspector-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`inspector-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? 'is-active' : ''} key={tab.id} onKeyDown={(event) => { if (['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) { event.preventDefault(); moveTab(index, event.key) } }} onClick={() => onTabChange(tab.id)}>{tab.label}{tab.id === 'changes' && git.files.length ? <span>{git.files.length}</span> : null}</button>)}
      <span className="inspector__tab-spacer"/>
      <IconButton label="Close inspector" onClick={onClose}><PanelRightClose size={15}/></IconButton>
    </div>
    <div id={`inspector-panel-${activeTab}`} className="inspector__body" role="tabpanel" aria-labelledby={`inspector-tab-${activeTab}`} tabIndex={0}>
      {activeTab === 'summary' ? <SummaryPanel agentName={agentName} shortName={shortName} project={project} runtime={runtime} messages={messages} git={git} automations={automations} heartbeats={heartbeats} onOpenAutomation={onOpenAutomation}/> : null}
      {activeTab === 'changes' ? <ChangesPanel key={cwd ?? 'no-workspace'} cwd={cwd} git={git} readOnly={project?.readOnly === true} onGrantProject={onGrantProject} onRefreshGit={onRefreshGit}/> : null}
      {activeTab === 'git' ? <GitPanel key={cwd ?? 'no-workspace'} cwd={cwd} git={git} onRefreshGit={onRefreshGit}/> : null}
      {activeTab === 'browser' ? <BrowserPanel platform={platform} home={browserHome} navigationRequest={browserNavigationRequest} onNavigationRequestHandled={onBrowserNavigationRequestHandled} onOpenExternal={onOpenExternal} annotations={browserAnnotations}/> : null}
      {activeTab === 'files' ? <FilesPanel project={project} git={git} onReveal={onRevealPath}/> : null}
    </div>
  </aside>
})
