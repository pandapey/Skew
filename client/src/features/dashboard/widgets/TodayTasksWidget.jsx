import { useNavigate } from 'react-router-dom'
import { FiArrowRight } from 'react-icons/fi'
import { CardHeader, Badge, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { useMyTasks } from '@/hooks/queries/useMyTasks'
import { groupMyTasks } from '@/features/mywork/taskBuckets'
import { formatDate } from '@/utils'

export default function TodayTasksWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useMyTasks()

  if (isLoading) return <CardSkeleton />

  const rows = Array.isArray(data) ? data : data?.data || []
  const { today } = groupMyTasks(rows)
  const combined = today.slice(0, 5)

  return (
    <GlassWidget>
      <CardHeader
        title="Today's Tasks"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/my-tasks')}>
            My Tasks
          </Button>
        }
      />
      {!combined.length ? (
        <EmptyState title="You have no tasks for today" description="Tasks assigned to you and due today will appear here." />
      ) : (
        <div className="space-y-2.5">
          {combined.map((t) => (
            <button
              type="button"
              key={t._id || t.id}
              onClick={() => navigate(t.project ? `/projects/${t.project}` : '/my-tasks')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-app p-3 text-left transition hover:border-primary/40 focus-visible:border-primary"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-8 w-1.5 flex-none rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="flex items-center gap-1 text-xs text-muted">Due {formatDate(t.dueDate)}</p>
                </div>
              </div>
              <Badge>{t.priority}</Badge>
            </button>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
