import toast from 'react-hot-toast'
import { FiCheckCircle, FiAlertTriangle, FiInfo, FiX } from 'react-icons/fi'
import { cn } from '@/utils'

const toneMap = {
  primary: { cls: 'text-primary bg-primary/10', Icon: FiInfo },
  success: { cls: 'text-success bg-success/10', Icon: FiCheckCircle },
  warning: { cls: 'text-warning bg-warning/10', Icon: FiAlertTriangle },
  danger: { cls: 'text-danger bg-danger/10', Icon: FiAlertTriangle },
}

// Glass toast body for react-hot-toast's `toast.custom`.
export function GlassToast({ t, title, message, tone = 'primary' }) {
  const { cls, Icon } = toneMap[tone] || toneMap.primary
  return (
    <div
      className={cn(
        'glass-strong pointer-events-auto flex w-80 items-start gap-3 rounded-card p-4 shadow-floating transition-all duration-200',
        t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      )}
    >
      <span className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-xl', cls)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {message && <p className="text-sm text-muted">{message}</p>}
      </div>
      <button
        onClick={() => toast.dismiss(t.id)}
        className="rounded-lg p-1 text-muted transition hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="Dismiss"
      >
        <FiX className="h-4 w-4" />
      </button>
    </div>
  )
}

// Helper to fire a glass notification from anywhere.
export function notify({ title, message, tone = 'primary', duration = 4000 }) {
  return toast.custom((t) => <GlassToast t={t} title={title} message={message} tone={tone} />, {
    duration,
  })
}
