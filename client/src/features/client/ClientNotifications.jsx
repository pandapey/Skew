// =============================================================================
// Phase 6.10 (TASK 4) — CLIENT NOTIFICATIONS PAGE
//
// WHY A PAGE AND NOT A NEW SYSTEM:
//   The client notification stack already existed end to end and is NOT
//   duplicated here. What was missing was only a full-screen surface: the sole
//   entry point was the navbar bell (ClientNotificationBell.jsx), which slices
//   the list to `.slice(0, 6)`, so anything older than the six most recent
//   notifications was unreachable in the portal and there was no Notifications
//   navigation item at all.
//
// EVERYTHING BELOW IS REUSED — nothing new was introduced:
//   • Model        ClientNotification (server/src/models/clientModels.js)
//   • API          GET  /client/notifications
//                  PATCH /client/notifications/:id/read
//                  POST /client/notifications/read-all
//   • Service      clientService.getNotifications / markNotificationRead /
//                  markAllNotificationsRead  (no new service methods)
//   • Query        the SAME ['client-notifications'] React Query key the bell
//                  uses, so page and bell share ONE cache entry: marking read
//                  here instantly updates the bell's badge and vice versa, with
//                  no second fetch and no divergent state.
//   • Realtime     the existing 'client:notification' socket event, already
//                  wired in features/realtime/useRealtimeSync.jsx to bust
//                  ['client-notifications']. Because this page reads that exact
//                  key, realtime works here with ZERO new socket code.
//   • Icon/tone/category maps are imported from the bell rather than
//                  re-declared — one definition, every surface.
//
// Phase 6.18 (TASK 2) ROOT CAUSE FIX — "Mark All Read empties the Notification
// page too / the page cannot show read history":
//   Phase 6.11 made this page behave EXACTLY like the bell dropdown on
//   purpose (see the old comment this replaces) — it rendered only
//   `list.filter(n => !n.read)`. That was correct for the bell, but the brief
//   now splits the two surfaces on purpose: the bell stays an unread inbox
//   (unchanged, see ClientNotificationBell.jsx), while this PAGE must be the
//   permanent history — read AND unread, unaffected by Mark All Read. The
//   actual defect was that one component was being asked to serve both
//   contracts; the fix is to stop filtering by read state here at all, add
//   the category filters the brief asks for (computed from the SAME `icon`
//   field the bell already reads — no new notification metadata), and keep
//   using the identical cache key / mutations so realtime and Mark All Read
//   keep working exactly as before, just without hiding anything on this page.
//
// RBAC: the route is registered with [ROLES.CLIENT] like every other /client/*
// page, and all three endpoints sit behind `protect, authorize('Client')` and
// re-derive the caller's own clientId server-side. A client can only ever see
// and mutate their own notifications; staff notifications are a separate model
// (Notification) reached through the untouched staff /notifications page.
// =============================================================================
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FiBell, FiCheck } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { NOTIFICATION_ICONS, NOTIFICATION_TONES, NOTIFICATION_ROUTES, categorizeNotification } from './ClientNotificationBell'
import { PageHeader, Card, Loader, EmptyState, Button } from '@/components/ui'
import { fmtTimeAgo } from './constants'
import { cn } from '@/utils'

// Phase 6.18 (TASK 2): filter tabs required by the brief. 'unread'/'read' key
// off the model's own `read` boolean; the category tabs key off
// categorizeNotification (icon-derived, see ClientNotificationBell.jsx) — both
// are existing, already-stored fields, so no new metadata is introduced.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
  { key: 'meeting', label: 'Meetings' },
  { key: 'task', label: 'Tasks' },
  { key: 'project', label: 'Projects' },
  { key: 'document', label: 'Documents' },
  { key: 'billing', label: 'Billing' },
]

export default function ClientNotifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filter, setFilter] = useState('all')

  // Same key as the bell => one shared cache entry, one fetch, one truth.
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['client-notifications'],
    queryFn: () => clientService.getNotifications(user),
  })

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['client-notifications'], refetchType: 'active' })

  // Same optimistic cache seeding as the bell, against the SAME
  // ['client-notifications'] entry - so marking read on this page updates the
  // navbar badge on the same tick, and vice versa, with no page refresh and
  // without either surface keeping private state.
  const seedAllRead = () =>
    qc.setQueryData(['client-notifications'], (old) =>
      Array.isArray(old) ? old.map((n) => ({ ...n, read: true })) : old
    )
  const seedOneRead = (id) =>
    qc.setQueryData(['client-notifications'], (old) =>
      Array.isArray(old) ? old.map((n) => (n.id === id ? { ...n, read: true } : n)) : old
    )

  const markOne = useMutation({
    mutationFn: (id) => clientService.markNotificationRead(id),
    onMutate: (id) => seedOneRead(id),
    onSuccess: refresh,
    onError: () => {
      refresh()
      toast.error('Could not mark that notification as read')
    },
  })

  const markAll = useMutation({
    mutationFn: () => clientService.markAllNotificationsRead(),
    onMutate: seedAllRead,
    onSuccess: (res) => {
      refresh()
      toast.success(res?.updated ? `Marked ${res.updated} as read` : 'All caught up')
    },
    onError: () => {
      refresh()
      toast.error('Could not mark notifications as read')
    },
  })

  // Phase 6.18 (TASK 2): this page is the PERMANENT history, so it starts from
  // every notification the client has ever received — read and unread alike —
  // and only narrows that set when the client explicitly picks a filter tab.
  // Mark All Read (above) only flips `read` on the shared cache entry; it never
  // removes rows, so it cannot empty this list the way it empties the bell.
  const filtered = useMemo(() => {
    if (filter === 'all') return list
    if (filter === 'unread') return list.filter((n) => !n.read)
    if (filter === 'read') return list.filter((n) => n.read)
    return list.filter((n) => categorizeNotification(n) === filter)
  }, [list, filter])

  const unreadCount = useMemo(() => list.filter((n) => !n.read).length, [list])

  // Identical behaviour to the bell's openItem: opening clears unread state and
  // routes to the relevant portal area, using the shared route map.
  const openItem = (n) => {
    if (!n.read && n.id) markOne.mutate(n.id)
    navigate(NOTIFICATION_ROUTES[n.icon] || '/client')
  }

  if (isLoading) return <Loader label="Loading notifications…" />

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={`${list.length} total · ${unreadCount} unread`}
        actions={unreadCount > 0 ? (
          <Button icon={FiCheck} onClick={() => markAll.mutate()} loading={markAll.isPending}>
            Mark all as read
          </Button>
        ) : null}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
              filter === f.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-app text-muted hover:bg-black/5 dark:hover:bg-white/10',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {/* Phase 6.11: kept verbatim — a client with literally zero notifications
            ever still sees this. list.length is the correct gate for THAT case;
            an empty FILTERED view (e.g. no Billing notifications yet) gets its
            own message below instead of this one. */}
        {list.length === 0 ? (
          <EmptyState title="No New Notifications" description="Updates about your projects, invoices, meetings and documents will appear here." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing here" description="No notifications match this filter yet." />
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => {
              const Icon = NOTIFICATION_ICONS[n.icon] || FiBell
              const tone = NOTIFICATION_TONES[n.icon] || 'bg-primary/10 text-primary'
              return (
                <div
                  key={n.id}
                  className={cn(
                    'flex flex-wrap items-start gap-3 rounded-xl border border-app p-3 transition',
                    !n.read && 'border-primary/30 bg-primary/[0.03]',
                  )}
                >
                  <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-xl', tone)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <button onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                    <p className={cn('truncate text-sm', n.read ? 'font-normal text-muted' : 'font-semibold')}>{n.title}</p>
                    <p className="text-xs text-muted">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{fmtTimeAgo(n.at)}</p>
                  </button>
                  {!n.read && (
                    <button
                      onClick={() => markOne.mutate(n.id)}
                      disabled={markOne.isPending}
                      className="flex items-center gap-1 rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      <FiCheck /> Mark as read
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
