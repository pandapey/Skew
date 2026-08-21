import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { notificationService } from './notificationService'
import { NOTIF_TYPES } from './constants'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const isClient = user?.role === ROLES.CLIENT
  const canQueryInternalNotifications = Boolean(isAuthenticated && user) && !isClient
  const [pushed, setPushed] = useState([])

  const query = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: () => notificationService.list({}),
    refetchInterval: 15000,
    enabled: canQueryInternalNotifications,
  })

  const settingsQuery = useQuery({
    queryKey: ['notification-settings', user?.email],
    queryFn: notificationService.getSettings,
    enabled: canQueryInternalNotifications,
  })

  const markReadMut = useMutation({ mutationFn: (id) => notificationService.markRead(id) })
  const markAllMut = useMutation({ mutationFn: () => notificationService.markAllRead() })
  const settingsMut = useMutation({ mutationFn: (patch) => notificationService.updateSettings(patch) })

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

  const notify = useCallback((notif) => {
    if (!notif?.title) return
    if (!canQueryInternalNotifications) return
    const settings = settingsQuery.data
    const type = notif.type || 'announcement'
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
    notificationService
      .create(enriched)
      .then((saved) => {
        if (saved && saved.id) {
          setPushed((p) => p.map((item) => (item.id === enriched.id ? { ...item, ...saved } : item)))
        }
      })
      .catch(() => {})
    toast(enriched.title, { icon: '🔔', duration: 3500 })
  }, [settingsQuery.data, user, canQueryInternalNotifications])

  const markRead = useCallback((id) => {
    setPushed((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)))
    if (!canQueryInternalNotifications) return
    qc.setQueryData(['notifications', user?.email], (old) =>
      Array.isArray(old) ? old.map((n) => (n.id === id ? { ...n, read: true } : n)) : old)
    markReadMut.mutate(id, { onSuccess: () => query.refetch() })
  }, [markReadMut, query, canQueryInternalNotifications, qc, user?.email])

  const markAllRead = useCallback(() => {
    setPushed((p) => p.map((n) => ({ ...n, read: true })))
    if (!canQueryInternalNotifications) return
    qc.setQueryData(['notifications', user?.email], (old) =>
      Array.isArray(old) ? old.map((n) => ({ ...n, read: true })) : old)
    markAllMut.mutate(undefined, { onSuccess: () => query.refetch() })
  }, [markAllMut, query, canQueryInternalNotifications, qc, user?.email])

  const updateSettings = useCallback((patch) => {
    if (!canQueryInternalNotifications) return
    settingsMut.mutate(patch, { onSuccess: () => settingsQuery.refetch() })
  }, [settingsMut, settingsQuery, canQueryInternalNotifications])

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
