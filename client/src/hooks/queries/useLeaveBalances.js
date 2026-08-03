import { useQuery } from '@tanstack/react-query'
import { leaveApi } from '@/api/services'

// Current user's leave balances — shared by the Dashboard's leave-balance
// widget and My Work / Leave pages.
export function useLeaveBalances() {
  return useQuery({
    queryKey: ['leave', 'balances'],
    queryFn: () => leaveApi.balances(),
    staleTime: 60_000,
  })
}
