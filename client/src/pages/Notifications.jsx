import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FiSettings, FiZap, FiCheck, FiBellOff } from 'react-icons/fi'
import { useNotifications } from '@/features/notifications/NotificationContext'
import {
  NOTIF_TYPES, NOTIF_ICON, NOTIF_TONE, NOTIF_LABEL, SETTINGS_META, timeAgo,
} from '@/features/notifications/constants'
import { PageHeader, Card, Button, Badge, EmptyState, Modal, Loader } from '@/components/ui'
import { cn } from '@/utils'

const FILTERS = [{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, ...NOTIF_TYPES.map((t) => ({ key: t.key, label: t.label }))]

export default function Notifications() {
  const { list, unreadCount, loading, perTypeUnread, markRead, markAllRead, settings, updateSettings } = useNotifications()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const filtered = useMemo(() => {
    if (filter === 'all') return list
    if (filter === 'unread') return list.filter((n) => !n.read)
    return list.filter((n) => n.type === filter)
  }, [list, filter])

  if (loading) return <Loader label="Loading notifications…" />

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : "You're all caught up!"}
        actions={
          <>
            <Button variant="ghost" icon={FiSettings} onClick={() => setSettingsOpen(true)}>Settings</Button>
            <Button variant="ghost" icon={FiCheck} onClick={markAllRead} disabled={!unreadCount}>Mark all read</Button>
          </>
        }
      />

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const active = f.key === filter
          const count = f.key === 'unread' ? unreadCount : f.key === 'all' ? list.length : perTypeUnread[f.key]
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition',
                active ? 'bg-primary text-white' : 'bg-black/5 text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10')}>
              {f.label}
              {count > 0 && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white/25 text-white' : 'bg-primary/15 text-primary')}>{count}</span>}
            </button>
          )
        })}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="No notifications here" description={filter === 'unread' ? 'You have no unread notifications.' : 'Nothing matches this filter yet.'} />
        ) : (
          <div className="divide-y divide-app">
            {filtered.map((n, i) => {
              const Icon = NOTIF_ICON[n.type] || FiBellOff
              const Tone = NOTIF_TONE[n.type] || 'bg-primary/10 text-primary'
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.025, 0.3) }}
                  onClick={() => { markRead(n.id); if (n.link) navigate(n.link) }}
                  className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]', !n.read && 'bg-primary/[0.03] dark:bg-primary/[0.06]')}
                >
                  <div className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-xl', Tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('truncate text-sm', n.read ? 'font-normal' : 'font-semibold')}>{n.title}</p>
                      {n.priority === 'high' && !n.read && <Badge tone="danger">Urgent</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted">{timeAgo(n.createdAt)} · {n.sender} · {NOTIF_LABEL[n.type] || 'Notification'}</p>
                  </div>
                  <div className="flex flex-none flex-col items-center gap-2">
                    {!n.read
                      ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                      : <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-success/10 text-success"><FiCheck className="h-3 w-3" /></span>}
                  </div>
                </motion.button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Real-time hint */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
        <FiZap className="h-3.5 w-3.5 text-primary" /> Real-time updates streamed from the server
      </p>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={updateSettings} />
    </div>
  )
}

/* --------------------------- Settings --------------------------- */
function SettingsModal({ open, onClose, settings, onSave }) {
  if (!settings) return null
  const master = settings.push
  return (
    <Modal open={open} onClose={onClose} title="Notification Settings"
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Toggle
          label="In-app push notifications"
          desc="Show notifications in real time across the app"
          checked={settings.push}
          onChange={(v) => onSave({ push: v })}
        />
        <Toggle
          label="Daily email digest"
          desc="A summary of unread notifications sent to your inbox"
          checked={settings.emailDigest}
          onChange={(v) => onSave({ emailDigest: v })}
        />

        <div className="border-t border-app pt-4">
          <p className="mb-2 text-sm font-semibold">Receive notifications for</p>
          <div className={cn('space-y-1', !master && 'pointer-events-none opacity-50')}>
            {SETTINGS_META.map((s) => (
              <Toggle key={s.key} label={s.label} desc={s.desc} checked={settings[s.key]} onChange={(v) => onSave({ [s.key]: v })} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 flex-none rounded-full transition', checked ? 'bg-primary' : 'bg-black/15 dark:bg-white/15')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[1.375rem]' : 'left-0.5')} />
      </button>
    </label>
  )
}
