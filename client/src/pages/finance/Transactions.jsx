import { TransactionManager } from '@/features/finance/TransactionManager'
import { financeApi } from '@/api/services'

export default function Transactions() {
  return (
    <TransactionManager
      mode="all"
      title="Transactions"
      subtitle="Complete income & expense ledger."
      api={financeApi.transactions}
      queryKey="fin-transactions"
    />
  )
}
