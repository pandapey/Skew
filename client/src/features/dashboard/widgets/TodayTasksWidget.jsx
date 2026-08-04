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
  // Show ONLY tasks assigned to this employee that are due today.
  // Phase 6.2 (Task 6) VERIFIED, not changed: useMyTasks() requests
  // projectApi.tasks({ assignee: user.name }) and the server additionally scopes
  // task reads to projects the caller can access, so no organization-wide task
  // can ever reach this widget.
  const { today } = groupMyTasks(rows)
  const combined = today.slice(0, 5)

  return (
    <GlassWidget>
      <CardHeader
        title="Today's Tasks"
        action={
          // Phase 6.2 (Task 6): was navigate('/my-work') labelled "My Work".
          // /my-work was a duplicate task page built on this very same
          // useMyTasks() hook; it is deleted and this now opens My Tasks.
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/my-tasks')}>
            My Tasks
          </Button>
        }
      />
      {!combined.length ? (
        <EmptyState title="You have no tasks for today" description="Tasks assigned to you and due today will appear here." />
      ) : (
        <div className="space-y-2.5">
          {/* Phase 6.9 (Task 20): this list is sourced from groupMyTasks(rows).today,
              which by definition already excludes overdue tasks (see
              features/mywork/taskBuckets.js: `overdue` and `today` are two
              mutually exclusive buckets). A local `isOverdue = false` constant
              previously stood in for real overdue detection and could never
              become true here, leaving the danger styling/icon as unreachable
              dead code. Removed rather than wired to real data, because wiring
              "overdue" into a widget titled "Today's Tasks" would just be
              re-introducing fake state under a different name. Genuine overdue
              tasks already have their own real data path via
              groupMyTasks(...).overdue on the My Tasks page. */}
          {combined.map((t) => (
            <div
              key={t._id || t.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-app p-3 transition hover:border-primary/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-8 w-1.5 flex-none rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="flex items-center gap-1 text-xs text-muted">Due {formatDate(t.dueDate)}</p>
                </div>
              </div>
              <Badge>{t.priority}</Badge>
            </div>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
