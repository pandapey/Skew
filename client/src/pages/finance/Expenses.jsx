import { TransactionManager } from '@/features/finance/TransactionManager'
import { financeApi } from '@/api/services'

export default function Expenses() {
  return (
    <TransactionManager
      mode="Expense"
      title="Expenses"
      subtitle="Costs, bills and operational spend."
      api={financeApi.expenses}
      queryKey="fin-expenses"
      categoryType="Expense"
    />
  )
}
