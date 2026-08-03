import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { notificationService } from './notificationService'
import { NOTIF_TYPES } from './constants'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  // Phase 6.9 (TASK 8): needed to apply the read-state change to the CACHED
  // server list immediately, instead of waiting for the refetch round-trip.
  const qc = useQueryClient()
  // Root cause of the Client-login 403 spam: this provider is mounted globally
  // in App.jsx, so it wrapped EVERY session including Client-role ones, and its
  // two queries fired unconditionally at /api/notifications and
  // /api/notifications/settings. Both of those routes sit behind
  // `router.use(protect, blockClient)` in server/src/routes/notificationRoutes.js,
  // which returns 403 for the Client role by design - clients live entirely in
  // the /api/client tree and have their own ClientNotificationBell backed by
  // /client/notifications. Worse, the list query carries refetchInterval:15000,
  // so the pair of 403s repeated every 15 seconds for the whole session.
  // Fix: keep the provider mounted (so useNotifications() never throws for any
  // child) but disable every internal-notification network call for clients.
  const isClient = user?.role === ROLES.CLIENT
  // Locally-injected notifications (mock real-time) so the UI updates instantly.
  const [pushed, setPushed] = useState([])

  const query = useQuery({
    // Scope the cache to the signed-in user so read state / lists are never
    // shared between accounts in the same browser session (#14). The backend is
    // already per-user (Notification.recipient = req.user.email), but a global
    // cache key could otherwise surface a previous user's cached list on switch.
    queryKey: ['notifications', user?.email],
    queryFn: () => notificationService.list({}),
    // Poll so new server notifications appear automatically.
    refetchInterval: 15000,
    // Never call the internal notifications API as a Client (403 by design).
    enabled: !isClient,
  })

  const settingsQuery = useQuery({
    queryKey: ['notification-settings', user?.email],
    queryFn: notificationService.getSettings,
    enabled: !isClient,
  })

  const markReadMut = useMutation({ mutationFn: (id) => notificationService.markRead(id) })
  const markAllMut = useMutation({ mutationFn: () => notificationService.markAllRead() })
  const settingsMut = useMutation({ mutationFn: (patch) => notificationService.updateSettings(patch) })

  // Merge server list + locally pushed items, newest first, deduplicated by id.
  const list = useMemo(() => {
    const base = query.data || []
    const merged = [...pushed, ...base]
    const seen = new Set()
    const deduped = []
    for (const n of merged) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      deduped.push(n)
    }
    return deduped.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [query.data, pushed])

  const unreadCount = useMemo(() => list.filter((n) => !n.read).length, [list])

  // Push a REAL notification, triggered by an actual action somewhere in the
  // app (e.g. a leave request, a new announcement, a calendar event). Adds it
  // to the local list instantly, persists it, and toasts it — but only if the
  // matching category (and the master push toggle) is enabled in settings.
  const notify = useCallback((notif) => {
    if (!notif?.title) return
    // Clients cannot POST /notifications either - same blockClient guard.
    if (isClient) return
    const settings = settingsQuery.data
    const type = notif.type || 'announcement'
    // Respect user preferences: skip if push is off or this category is muted.
    if (settings && (settings.push === false || settings[type] === false)) return

    const enriched = {
      id: `ntf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      type,
      title: notif.title,
      body: notif.body || '',
      sender: notif.sender || user?.name || 'System',
      createdAt: new Date().toISOString(),
      read: false,
      link: notif.link || null,
      priority: notif.priority || 'normal',
    }
    setPushed((p) => [enriched, ...p].slice(0, 40))
    // Persist to the store/backend so it survives a refetch, THEN reconcile the
    // optimistic entry's temp id with the server-assigned id. Without this, the
    // 15s poll returns the same notification under a different (Mongo) id, so the
    // dedup-by-id below cannot match it and the user sees TWO identical items.
    // Reconciling the id makes the polled copy dedup cleanly => exactly one.
    notificationService
      .create(enriched)
      .then((saved) => {
        if (saved && saved.id) {
          setPushed((p) => p.map((item) => (item.id === enriched.id ? { ...item, ...saved } : item)))
        }
      })
      .catch(() => {})
    toast(enriched.title, { icon: '🔔', duration: 3500 })
  }, [settingsQuery.data, user, isClient])

  const markRead = useCallback((id) => {
    // Always update any locally-held copy so the UI reflects the change instantly.
    setPushed((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)))
    if (isClient) return
    // Phase 6.9 (TASK 8): also flip the cached SERVER copy straight away. Only
    // the `pushed` array was being updated optimistically, so a server-sourced
    // notification stayed unread in the cache until the refetch resolved and
    // the badge lagged behind the click.
    qc.setQueryData(['notifications', user?.email], (old) =>
      Array.isArray(old) ? old.map((n) => (n.id === id ? { ...n, read: true } : n)) : old)
    // Persist to the store/backend too (locally-created ids also live there).
    // The refetch stays: it reconciles against the real stored state, so if the
    // write failed the item correctly returns to unread rather than silently
    // looking read.
    markReadMut.mutate(id, { onSuccess: () => query.refetch() })
  }, [markReadMut, query, isClient, qc, user?.email])

  const markAllRead = useCallback(() => {
    setPushed((p) => p.map((n) => ({ ...n, read: true })))
    if (isClient) return
    // Phase 6.9 (TASK 8): same optimistic cache write for "Mark all read", so
    // `unreadCount` (derived from `list`) drops to 0 on the click itself and
    // the badge disappears immediately instead of after the next round-trip.
    qc.setQueryData(['notifications', user?.email], (old) =>
      Array.isArray(old) ? old.map((n) => ({ ...n, read: true })) : old)
    markAllMut.mutate(undefined, { onSuccess: () => query.refetch() })
  }, [markAllMut, query, isClient, qc, user?.email])

  const updateSettings = useCallback((patch) => {
    if (isClient) return
    settingsMut.mutate(patch, { onSuccess: () => settingsQuery.refetch() })
  }, [settingsMut, settingsQuery, isClient])

  const value = {
    list,
    unreadCount,
    loading: query.isLoading,
    settings: settingsQuery.data,
    perTypeUnread: NOTIF_TYPES.reduce((acc, t) => {
      acc[t.key] = list.filter((n) => n.type === t.key && !n.read).length
      return acc
    }, {}),
    notify,
    markRead,
    markAllRead,
    updateSettings,
    refetch: query.refetch,
  }

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
