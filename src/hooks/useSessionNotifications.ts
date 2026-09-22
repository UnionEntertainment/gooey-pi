import { useEffect, useRef } from 'react'
import { sessionSystemNotification } from '@/app/session-attention'
import type { SessionRecord } from '@/types/api'

// A provider auto-retry resumes the turn right after agent_end; the delay lets
// a follow-up lifecycle event cancel a banner that would have lied.
const SYSTEM_NOTIFICATION_DELAY_MS = 1_500

interface UseSessionNotificationsOptions {
  sessions: SessionRecord[]
  onOpen(session: SessionRecord): void
  notify?: (title: string, body: string) => Notification
  delayMs?: number
}

/**
 * Emits a macOS notification when a session settles. Signatures are seeded on
 * the first populated catalog (and after a full catalog swap such as a harness
 * switch) so already-finished sessions never storm banners; only a signature
 * change notifies.
 */
export function useSessionNotifications({
  sessions,
  onOpen,
  notify = (title, body) => new Notification(title, { body }),
  delayMs = SYSTEM_NOTIFICATION_DELAY_MS,
}: UseSessionNotificationsOptions): void {
  const seenRef = useRef<Map<string, string> | null>(null)
  const pendingRef = useRef<Map<string, number>>(new Map())
  const callbacksRef = useRef({ notify, onOpen })
  callbacksRef.current = { notify, onOpen }

  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])

  useEffect(() => {
    if (!sessions.length) return
    const seen = seenRef.current
    if (!seen || !sessions.some((session) => seen.has(session.id))) {
      // '' marks a member with no notifiable signature; a real signature
      // always carries a status prefix, so it can never collide.
      seenRef.current = new Map(sessions.map((session) => [session.id, sessionSystemNotification(session)?.signature ?? ''] as const))
      return
    }
    for (const session of sessions) {
      const notification = sessionSystemNotification(session)
      const signature = notification?.signature ?? ''
      if (seen.get(session.id) === signature) continue
      seen.set(session.id, signature)
      const existing = pendingRef.current.get(session.id)
      if (existing !== undefined) {
        window.clearTimeout(existing)
        pendingRef.current.delete(session.id)
      }
      if (!notification) continue
      pendingRef.current.set(session.id, window.setTimeout(() => {
        pendingRef.current.delete(session.id)
        const banner = callbacksRef.current.notify(notification.title, notification.body)
        banner.onclick = () => callbacksRef.current.onOpen(session)
      }, delayMs))
    }
  }, [delayMs, sessions])
}
