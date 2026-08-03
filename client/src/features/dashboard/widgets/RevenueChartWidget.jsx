import { FiTrendingUp } from 'react-icons/fi'
import { Badge, CardSkeleton } from '@/components/ui'
import { GlassChartContainer } from '@/components/glass'
import { RevenueChart } from '@/components/charts/Charts'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

// Org-only monthly revenue vs expense, reusing the existing RevenueChart and
// the shared dashboard-stats cache. Registry-gated to ORG_VISIBILITY_ROLES.
export default function RevenueChartWidget() {
  const { data, isLoading } = useDashboardStats()
  const trend = data?.trends?.revenue

  return (
    <GlassChartContainer
      title="Revenue vs Expense"
      subtitle="Monthly cash flow"
      action={
        typeof trend === 'number' && Number.isFinite(trend) ? (
          <Badge tone={trend >= 0 ? 'success' : 'danger'}>
            <FiTrendingUp className="mr-1" />
            {trend >= 0 ? '+' : ''}{trend}%
          </Badge>
        ) : null
      }
    >
      {isLoading ? <CardSkeleton /> : <RevenueChart data={data?.revenue || []} />}
    </GlassChartContainer>
  )
}
