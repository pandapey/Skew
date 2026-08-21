import { TransactionManager } from '@/features/finance/TransactionManager'
import { financeApi } from '@/api/services'

export default function Income() {
  return (
    <TransactionManager
      mode="Income"
      title="Income"
      subtitle="Revenue, receipts and other earnings."
      api={financeApi.income}
      queryKey="fin-income"
      categoryType="Income"
    />
  )
}
