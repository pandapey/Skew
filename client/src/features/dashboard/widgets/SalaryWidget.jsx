import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FiCreditCard, FiArrowRight } from 'react-icons/fi'
import { CardHeader, CardSkeleton, EmptyState, Button } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { hrApi } from '@/api/services'
import { SalarySummaryCard } from '@/features/hr/SalarySummaryCard'

// Phase 5.4 (Task 2): dashboard entry point for an employee's own salary.
// Reuses the SAME react-query key (['my-salary']), the SAME endpoint
// (hrApi.payroll.mySalary) and the SAME SalarySummaryCard as the My Salary
// page - so there is no duplicated fetch, no duplicated calculation, and the
// two surfaces share one cache entry and can never drift apart.
export default function SalaryWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['my-salary'],
    queryFn: () => hrApi.payroll.mySalary(),
  })

  if (isLoading) return <CardSkeleton />

  const current = data?.current

  return (
    <GlassWidget>
      {/* Phase 6.2 (Task 7) ROOT CAUSE: this CardHeader had NO `action` prop, so
          the widget exposed no way to reach the Salary page (CardHeader renders
          the slot only when given one - compare TodayTasksWidget). Reuses the
          existing /salary route and the same ghost-Button pattern as the other
          widgets, so the design language is unchanged. */}
      <CardHeader
        title="Salary Summary"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/salary')}>
            Salary
          </Button>
        }
      />
      {!current ? (
        <EmptyState
          title="No salary data yet"
          description="Your salary details will appear here once HR has set them up."
          icon={FiCreditCard}
        />
      ) : (
        <SalarySummaryCard current={current} />
      )}
    </GlassWidget>
  )
}
