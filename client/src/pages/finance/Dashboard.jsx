import { useNavigate } from 'react-router-dom'
import { FiArrowRight } from 'react-icons/fi'
import { PageHeader } from '@/components/ui'
import FinanceOverview from '@/features/finance/FinanceOverview'

export default function FinanceDashboard() {
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Finance Management"
        subtitle="Income, expenses, invoices, budgets and reports — end to end."
        actions={
          <button
            onClick={() => navigate('/finance/charts')}
            className="btn-ghost"
          >
            <FiArrowRight className="h-4 w-4" /> View Analytics
          </button>
        }
      />
      <FinanceOverview />
    </div>
  )
}
