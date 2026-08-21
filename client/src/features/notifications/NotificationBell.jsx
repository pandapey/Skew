import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiBell, FiCheck, FiZap } from 'react-icons/fi'
import { useNotifications } from './NotificationContext'
import { NOTIF_ICON, NOTIF_TONE, timeAgo } from './constants'
import { cn } from '@/utils'

export function NotificationBell() {
  const { list, unreadCount, markAllRead, markRead } = useNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const recent = list.filter((n) => !n.read).slice(0, 6)

  const openItem = (n) => {
    markRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
    else navigate('/notifications')
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
            <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-primary hover:underline" title="Mark all as read">
              <FiCheck className="h-3.5 w-3.5" /> Mark all
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No new notifications</p>
            ) : (
              recent.map((n) => {
                const Icon = NOTIF_ICON[n.type] || FiBell
                const Tone = NOTIF_TONE[n.type] || 'bg-primary/10 text-primary'
                return (
                  <button key={n.id} onClick={() => openItem(n)} className="flex w-full items-start gap-3 border-b border-app px-4 py-3 text-left transition last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <div className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-xl', Tone)}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm', n.read ? 'font-normal text-muted' : 'font-semibold')}>{n.title}</p>
                      <p className="truncate text-xs text-muted">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{timeAgo(n.createdAt)} · {n.sender}</p>
                    </div>
                    {!n.read && <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary" />}
                  </button>
                )
              })
            )}
          </div>

          <button onClick={() => { setOpen(false); navigate('/notifications') }} className="flex w-full items-center justify-center gap-1 border-t border-app py-2.5 text-sm font-medium text-primary hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
            <FiCheck className="h-4 w-4" /> View all notifications
          </button>
        </div>
      )}
    </div>
  )
}
