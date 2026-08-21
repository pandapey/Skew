import { useNavigate } from 'react-router-dom'
import { FiArrowRight } from 'react-icons/fi'
import { CardHeader, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { BalanceCards } from '@/features/leave/BalanceCards'
import { useLeaveBalances } from '@/hooks/queries/useLeaveBalances'

export default function LeaveBalanceWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useLeaveBalances()

  if (isLoading) return <CardSkeleton />

  return (
    <GlassWidget>
      <CardHeader
        title="Leave Balance"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/attendance/leave')}>
            Apply Leave
          </Button>
        }
      />
      {data?.length ? (
        <BalanceCards balances={data} />
      ) : (
        <EmptyState title="No leave balances configured" description="HR hasn't set up leave balances for you yet." />
      )}
    </GlassWidget>
  )
}
