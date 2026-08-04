import { useNavigate } from 'react-router-dom'
import { FiArrowRight, FiTrello } from 'react-icons/fi'
import { CardHeader, Badge, Button, CardSkeleton, EmptyState, ProgressBar } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { useMyProjects } from '@/hooks/queries/useMyProjects'

// Projects the current user leads or is a member of (active only). Reuses the
// shared `useMyProjects` cache so the dashboard and My Work never double-fetch.
export default function MyProjectsWidget() {
  const navigate = useNavigate()
  const { projects, isLoading } = useMyProjects()

  if (isLoading) return <CardSkeleton />

  const rows = (projects || [])
    .filter((p) => p.status !== 'Completed' && p.status !== 'Cancelled')
    .slice(0, 4)

  return (
    <GlassWidget>
      <CardHeader
        title="My Projects"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/projects')}>
            All Projects
          </Button>
        }
      />
      {!rows.length ? (
        <EmptyState title="No active projects" description="You're not assigned to any active projects right now." icon={FiTrello} />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <button
              key={p._id || p.id}
              type="button"
              onClick={() => navigate('/projects')}
              className="block w-full rounded-2xl border border-app p-3 text-left transition hover:border-primary/40 focus-visible:border-primary"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <Badge tone={p.status === 'Active' ? 'success' : undefined}>{p.status}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ProgressBar value={p.progress || 0} className="flex-1" height="h-1.5" animated={false} />
                <span className="text-xs tabular-nums text-muted">{p.progress || 0}%</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
