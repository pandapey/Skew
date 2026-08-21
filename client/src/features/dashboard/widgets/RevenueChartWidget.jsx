import { useNavigate } from 'react-router-dom'
import { FiTrendingUp, FiArrowRight } from 'react-icons/fi'
import { Badge, Button, CardSkeleton } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { GlassChartContainer } from '@/components/glass'
import { RevenueChart } from '@/components/charts/Charts'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

export default function RevenueChartWidget() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, isLoading } = useDashboardStats()
  const trend = data?.trends?.revenue

  const canOpenFinance = user?.role === ROLES.ADMIN || user?.role === ROLES.MANAGER

  return (
    <GlassChartContainer
      title="Revenue vs Expense"
      subtitle="Monthly cash flow"
      action={
        <div className="flex items-center gap-2">
          {typeof trend === 'number' && Number.isFinite(trend) ? (
            <Badge tone={trend >= 0 ? 'success' : 'danger'}>
              <FiTrendingUp className="mr-1" />
              {trend >= 0 ? '+' : ''}{trend}%
            </Badge>
          ) : null}
          {canOpenFinance && (
            <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/finance/charts')}>
              Finance
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? <CardSkeleton /> : <RevenueChart data={data?.revenue || []} />}
    </GlassChartContainer>
  )
}
