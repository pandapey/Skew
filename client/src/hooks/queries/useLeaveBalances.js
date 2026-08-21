import { useQuery } from '@tanstack/react-query'
import { leaveApi } from '@/api/services'

export function useLeaveBalances() {
  return useQuery({
    queryKey: ['leave', 'balances'],
    queryFn: () => leaveApi.balances(),
    staleTime: 60_000,
  })
}
