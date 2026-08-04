import { useNavigate } from 'react-router-dom'
import { FiArrowRight, FiCheckCircle, FiUserCheck } from 'react-icons/fi'
import { CardHeader, Badge, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { usePendingApprovals } from '@/hooks/queries/usePendingApprovals'
import { formatDate } from '@/utils'

// Approver-only inbox of leave requests awaiting a decision. The query itself
// is role-gated in `usePendingApprovals` (mirrors the server `canApprove`
// guard) and the widget is registry-gated to APPROVAL_ROLES, so employees
// never see or fetch it.
export default function PendingApprovalsWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = usePendingApprovals()

  if (isLoading) return <CardSkeleton />

  const rows = Array.isArray(data) ? data : data?.data || []
  const pending = rows.slice(0, 5)

  return (
    <GlassWidget>
      <CardHeader
        title="Pending Approvals"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/leave')}>
            Review
          </Button>
        }
      />
      {!pending.length ? (
        <EmptyState title="All caught up" description="No leave requests waiting for your approval." icon={FiCheckCircle} />
      ) : (
        <div className="space-y-2.5">
          {pending.map((r) => (
            <div
              key={r._id || r.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-app p-3 transition hover:border-primary/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-warning/10 text-warning">
                  <FiUserCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.employee}</p>
                  <p className="truncate text-xs text-muted">
                    {r.type} &middot; {formatDate(r.from)} &ndash; {formatDate(r.to)}
                  </p>
                </div>
              </div>
              <Badge tone="warning">{r.days}d</Badge>
            </div>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
