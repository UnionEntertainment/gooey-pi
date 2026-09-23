import { useRef } from 'react'
import type { SidebarProps } from '@/components/Sidebar'

type SidebarActions = Pick<SidebarProps,
  | 'onSelectProject'
  | 'onSelectSession'
  | 'onNavigate'
  | 'onNewSession'
  | 'onNewGlobalSession'
  | 'onAddProject'
  | 'onRemoveProject'
  | 'onSetProjectSortMode'
  | 'onTogglePinProject'
  | 'onTogglePinSession'
  | 'onClose'
  | 'onOpenPalette'
  | 'onRenameSession'
  | 'onArchiveSession'
  | 'onRestoreSession'
>

export interface SidebarActionProxy {
  readonly callbacks: SidebarActions
  update(actions: SidebarActions): void
}

/** Stable callback identities which always dispatch to the latest App render. */
export function createSidebarActionProxy(initialActions: SidebarActions): SidebarActionProxy {
  let current = initialActions
  return {
    callbacks: {
      onSelectProject: (project) => current.onSelectProject(project),
      onSelectSession: (session) => current.onSelectSession(session),
      onNavigate: (view) => current.onNavigate(view),
      onNewSession: (project) => current.onNewSession(project),
      onNewGlobalSession: () => current.onNewGlobalSession?.(),
      onAddProject: () => current.onAddProject(),
      onRemoveProject: (project) => current.onRemoveProject(project),
      onSetProjectSortMode: (mode) => current.onSetProjectSortMode?.(mode),
      onTogglePinProject: (project) => current.onTogglePinProject?.(project),
      onTogglePinSession: (session) => current.onTogglePinSession?.(session),
      onClose: () => current.onClose(),
      onOpenPalette: () => current.onOpenPalette(),
      onRenameSession: (session, title) => current.onRenameSession(session, title),
      onArchiveSession: (session) => current.onArchiveSession(session),
      onRestoreSession: (session) => current.onRestoreSession?.(session),
    },
    update(actions) { current = actions },
  }
}

export function useSidebarActions(actions: SidebarActions): SidebarActions {
  const proxyRef = useRef<SidebarActionProxy | null>(null)
  if (proxyRef.current === null) proxyRef.current = createSidebarActionProxy(actions)
  else proxyRef.current.update(actions)
  return proxyRef.current.callbacks
}
