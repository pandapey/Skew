import { FiActivity } from 'react-icons/fi'
import { CardHeader, Avatar, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

export default function RecentActivityWidget() {
  const { data, isLoading } = useDashboardStats()

  if (isLoading) return <CardSkeleton />

  const activities = data?.activities || []

  return (
    <GlassWidget>
      <CardHeader title="Recent Activity" />
      {!activities.length ? (
        <EmptyState title="No recent activity" description="Team updates will show up here." icon={FiActivity} />
      ) : (
        <div className="space-y-3.5">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start gap-3">
              <Avatar name={a.user} size={32} />
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{a.user}</span>{' '}
                  <span className="text-muted">{a.action}</span>
                </p>
                <p className="text-xs text-muted">{a.time}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
