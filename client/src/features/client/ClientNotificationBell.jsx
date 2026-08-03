import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiBell, FiZap, FiFileText, FiDollarSign, FiCalendar, FiMessageSquare, FiUpload, FiCheckCircle, FiRefreshCw, FiCheck } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { fmtTimeAgo } from './constants'
import { cn } from '@/utils'

// Phase 6.10 (TASK 4): exported so the new Notifications PAGE renders items
// identically without re-declaring these maps. One definition, two surfaces.
//
// Phase 6.18 (TASK 2) ROOT CAUSE FIX: 'document' (clientController.uploadDocument)
// and 'message' (clientController.adminReplyMessage) notifications are REAL,
// currently-created icon values that were never added here, so they silently
// fell back to the generic FiBell / default tone instead of their own. This
// closes that gap using the exact icon strings the server already writes —
// no new field, no new notification type.
export const NOTIFICATION_ICONS = {
  invoice: FiFileText, payment: FiDollarSign, meeting: FiCalendar,
  comment: FiMessageSquare, file: FiUpload, delivery: FiCheckCircle, update: FiRefreshCw,
  document: FiFileText, message: FiMessageSquare,
}
export const NOTIFICATION_TONES = {
  invoice: 'bg-primary/10 text-primary', payment: 'bg-warning/10 text-warning',
  meeting: 'bg-accent/10 text-accent', comment: 'bg-primary/10 text-primary',
  file: 'bg-success/10 text-success', delivery: 'bg-success/10 text-success',
  update: 'bg-primary/10 text-primary',
  document: 'bg-success/10 text-success', message: 'bg-primary/10 text-primary',
}

// Phase 6.18 (TASK 2): the Notifications PAGE needs to bucket every
// notification into one of the filter categories the brief calls for
// (Meetings / Tasks / Projects / Documents / Billing). `icon` is the ONLY
// per-notification classifier ClientNotification stores — there is no `type`
// field on the model (server/src/models/clientModels.js) — so this maps the
// real icon vocabulary above onto those five buckets rather than adding any
// new stored field. 'delivery' is created for BOTH a task being approved
// (projectService reviewSubmission) and a whole project completing
// (projectService syncClientProject); the model cannot distinguish those two
// from `icon` alone, so it is bucketed as 'task', the far more frequent of
// the two real triggers — documented as a known limitation in the phase report.
export const NOTIFICATION_CATEGORIES = {
  meeting: 'meeting',
  invoice: 'billing',
  payment: 'billing',
  document: 'document',
  file: 'document',
  comment: 'project',
  message: 'project',
  update: 'task',
  delivery: 'task',
}
export const categorizeNotification = (n) => NOTIFICATION_CATEGORIES[n?.icon] || 'project'

// Phase 6.10 (TASK 2 / TASK 6 / TASK 4): lifted out of openItem() so the bell
// and the Notifications page route identically. 'comment' and 'file' previously
// pointed at '/client/messages' and '/client/documents'; both standalone pages
// were removed once their views became Project Details tabs, so those two
// entries would now dead-end on the 404 route. They point at the project list -
// the single place those views live.
export const NOTIFICATION_ROUTES = {
  invoice: '/client/billing',
  payment: '/client/billing',
  meeting: '/client/meetings',
  comment: '/client/projects',
  file: '/client/projects',
  delivery: '/client/projects',
  update: '/client/projects',
  document: '/client/projects',
  message: '/client/projects',
}

// Client-scoped notifications bell for the portal navbar. Shows the logged-in
// client's own notifications only (never staff/company-wide data).
//
// Phase 6.3 (Task 10): this component previously had no way to mark anything
// read - opening an item only navigated - so the unread badge was permanent.
// It now calls the client-scoped mark-one / mark-all endpoints.
export function ClientNotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const { data: list = [] } = useQuery({
    queryKey: ['client-notifications'],
    queryFn: () => clientService.getNotifications(user),
  })

  // Invalidating with the same key the query uses is what makes the badge update
  // immediately - refetchType 'active' is the app-wide default in useRealtimeSync,
  // and the socket 'client:notification' event fired by the controller refreshes
  // any OTHER open tab for the same client through that same key.
  const refresh = () => qc.invalidateQueries({ queryKey: ['client-notifications'], refetchType: 'active' })

  // Phase 6.11 (TASK 4): write the new read state into the cache DIRECTLY, in
  // addition to invalidating.
  //
  // invalidateQueries only SCHEDULES a refetch; the cached array keeps its stale
  // `read: false` flags until that request comes back, so the badge and the list
  // visibly lagged behind the click (and appeared not to work at all on a slow
  // connection). Seeding the cache makes the badge and dropdown update on the
  // same tick, and the invalidate that follows still reconciles with the server
  // so nothing is left to drift. The socket 'client:notification' event the
  // controller emits continues to refresh any OTHER open tab through the same
  // key - both paths converge on one cache entry, so there is no second source
  // of truth.
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
    // The optimistic flag is not rolled back by hand: the invalidate below
    // re-reads the server, which is the authority on what is actually read.
    onError: () => refresh(),
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

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Phase 6.11 (TASK 4) ROOT CAUSE - "Mark All Read still leaves notifications
  // visible".
  //
  // The server side was never broken: markAllNotificationsRead() runs
  // updateMany({ clientId, read: false }, { read: true }) and emits
  // 'client:notification'. The bug was HERE - the dropdown listed
  // `list.slice(0, 6)`, i.e. every notification regardless of its read flag.
  // Marking all read therefore only changed the font weight and removed the
  // blue dot; the same six rows stayed on screen, so from the user's point of
  // view the button did nothing. The "You're all caught up!" message was
  // likewise gated on `list.length === 0`, which is only true for a client who
  // has never received a notification at all - it could never appear as the
  // result of marking things read.
  //
  // The dropdown is an UNREAD inbox, so it now filters on the read flag and the
  // empty state is driven by the unread count.
  const unread = list.filter((n) => !n.read)
  const unreadCount = unread.length
  const recent = unread.slice(0, 6)

  const openItem = (n) => {
    setOpen(false)
    // Opening an item also clears its unread state (persisted server-side).
    if (!n.read && n.id) markOne.mutate(n.id)
    // Route to the most relevant portal area for the notification type.
    navigate(NOTIFICATION_ROUTES[n.icon] || '/client')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn('relative rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10', open && 'bg-black/5 dark:bg-white/10')}
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        <FiBell />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card shadow-floating">
          <div className="flex items-center justify-between border-b border-app px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"><FiZap className="h-3.5 w-3.5" /></span>
              <p className="text-sm font-semibold">Notifications</p>
              {unreadCount > 0 && <span className="rounded-full bg-danger/10 px-2 text-xs font-semibold text-danger">{unreadCount} new</span>}
            </div>
            {/* Phase 6.3 (Task 10): one click, scoped to this client only. */}
            {unreadCount > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
              >
                <FiCheck className="h-3.5 w-3.5" /> Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No New Notifications</p>
            ) : (
              recent.map((n) => {
                const Icon = NOTIFICATION_ICONS[n.icon] || FiBell
                const tone = NOTIFICATION_TONES[n.icon] || 'bg-primary/10 text-primary'
                return (
                  <button key={n.id} onClick={() => openItem(n)} className="flex w-full items-start gap-3 border-b border-app px-4 py-3 text-left transition last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <div className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-xl', tone)}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm', n.read ? 'font-normal text-muted' : 'font-semibold')}>{n.title}</p>
                      <p className="truncate text-xs text-muted">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{fmtTimeAgo(n.at)}</p>
                    </div>
                    {!n.read && <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
