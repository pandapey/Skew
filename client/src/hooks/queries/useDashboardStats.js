import { useQuery } from '@tanstack/react-query'
import { dashboardService } from '@/api/services'

// Org-wide aggregate stats (KPIs, revenue/expense trend, attendance split,
// sales pipeline, activity feed). Shared by every org-level widget
// (OrgKpis/RevenueChart/SalesPipeline/AttendanceChart/RecentActivity) so they
// all read one cached response instead of firing the same aggregate query
// four times.
export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => dashboardService.stats(),
    staleTime: 30_000,
  })
}
