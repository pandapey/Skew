// Phase 5.8 (Task 7): Progress Dashboard shown on every project's Overview
// tab. Purely a read view over GET /client/projects/:id/progress, which is
// itself computed straight from the existing ProjectTask / Milestone /
// ClientProject.timeline / ClientProject.activity data - no second
// calculation engine, no fabricated numbers.
import { useQuery } from '@tanstack/react-query'
import { FiActivity } from 'react-icons/fi'
import { clientService } from './clientService'
import { Card, CardHeader, Badge, Loader, ProgressBar } from '@/components/ui'
import { cn } from '@/utils'
import { fmtDateTime } from './constants'

// Phase 6.11 (TASK 6): `className` passed through so a single card can widen to
// fill the last row on narrow screens (see the grid note below). The component
// itself is unchanged - no second Stat variant was introduced.
function Stat({ label, value, className }) {
  return (
    <div className={cn('rounded-xl border border-app p-3 text-center', className)}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

export default function ProjectProgressDashboard({ projectId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['client-project-progress', projectId],
    queryFn: () => clientService.getProjectProgress(projectId),
    enabled: !!projectId,
  })

  if (isLoading) return <Loader label="Loading progress..." />
  if (!data) return null

  return (
    <Card>
      <CardHeader title="Progress Dashboard" subtitle="Live status computed from your project's tasks, milestones and timeline" />
      <div className="mb-4 flex items-center gap-4">
        <div className="text-3xl font-bold">{data.overallProgress}%</div>
        <div className="flex-1"><ProgressBar value={data.overallProgress} /></div>
      </div>
      {/* Phase 6.11 (TASK 6): the "Timeline %" Stat is REMOVED.

          It was also visually misleading next to the headline figure directly
          above it: `timelinePercent` is the share of COMPLETED TIMELINE STAGES
          (doneStages / stages, clientController.js), whereas `overallProgress`
          rendered above is the task-weighted figure - two different percentages
          sitting inches apart with no explanation of the difference.

          GRID REBALANCED, NOT LEFT WITH A HOLE: the row held 6 cards in a
          4-column grid (a tidy 4 + 2). Simply deleting one would have left 5
          cards as 4 + 1, i.e. three empty cells on the second row. The grid is
          therefore switched to 5 columns so the five remaining cards fill it
          exactly on desktop, and on mobile (2 columns) the last card spans both
          so there is no half-empty cell there either. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Completed Tasks" value={data.completedTasks} />
        <Stat label="Pending Tasks" value={data.pendingTasks} />
        <Stat label="Overdue Tasks" value={data.overdueTasks} />
        <Stat label="Open Issues" value={data.openIssues} />
        <Stat label="Milestones" value={data.milestones?.length || 0} className="col-span-2 sm:col-span-1" />
      </div>

      {!!data.milestones?.length && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-muted">Milestones</p>
          <div className="space-y-2">
            {data.milestones.map((m, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-app p-2.5 text-sm">
                <span className="truncate">{m.title}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24"><ProgressBar value={m.progress || 0} /></div>
                  <Badge tone={m.status === 'Reached' ? 'success' : m.status === 'Missed' ? 'danger' : 'default'}>{m.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.latestActivity && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/10">
          <FiActivity className="mt-0.5 h-4 w-4 flex-none text-muted" />
          <div>
            <p className="font-medium">{data.latestActivity.text}</p>
            <p className="text-xs text-muted">{data.latestActivity.by} \u00b7 {fmtDateTime(data.latestActivity.at)}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
