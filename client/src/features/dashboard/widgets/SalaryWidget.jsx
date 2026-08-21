import { useNavigate } from 'react-router-dom'
import { FiCreditCard, FiArrowRight } from 'react-icons/fi'
import { CardHeader, CardSkeleton, EmptyState, Button } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { useMySalary } from '@/features/salary/salaryDocument'

export default function SalaryWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useMySalary()

  if (isLoading) return <CardSkeleton />

  const current = data?.current

  return (
    <GlassWidget>
      <CardHeader
        title="Salary Summary"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/profile/salary')}>
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
        <EmptyState
          title={current.month || 'Current month'}
          description="Open the Salary page for your full breakdown — net monthly salary, current receivable, deductions and LOP."
          icon={FiCreditCard}
        />
      )}
    </GlassWidget>
  )
}