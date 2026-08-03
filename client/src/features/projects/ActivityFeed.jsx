import { FiActivity, FiPlusCircle, FiUpload, FiMessageSquare, FiMove } from 'react-icons/fi'
import { Avatar } from '@/components/ui'
import { formatDate } from '@/utils'

// Pick an icon from the action text.
const iconFor = (action = '') => {
  if (action.includes('created')) return FiPlusCircle
  if (action.includes('uploaded')) return FiUpload
  if (action.includes('comment')) return FiMessageSquare
  if (action.includes('moved')) return FiMove
  return FiActivity
}

// Project activity feed — a vertical timeline of who did what.
export function ActivityFeed({ activity = [], empty = 'No activity yet' }) {
  if (!activity.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>

  return (
    <div className="space-y-3">
      {activity.map((a) => {
        const Icon = iconFor(a.action)
        return (
          <div key={a.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{a.actor}</span> {a.action}
                {a.target ? <span className="text-muted"> · {a.target}</span> : null}
              </p>
              <p className="text-xs text-muted">{formatDate(a.createdAt, 'DD MMM YYYY')}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
