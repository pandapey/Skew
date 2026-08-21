import { useQuery } from '@tanstack/react-query'
import { dashboardService } from '@/api/services'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => dashboardService.stats(),
    staleTime: 30_000,
  })
}
