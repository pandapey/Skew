import { CardSkeleton, EmptyState } from '@/components/ui'
import { GlassChartContainer } from '@/components/glass'
import { BarsChart } from '@/components/charts/Charts'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

// Org-only weekly attendance split (present vs absent), reusing the existing
// BarsChart and the shared dashboard-stats cache. Registry-gated to
// ORG_VISIBILITY_ROLES.
export default function AttendanceChartWidget() {
  const { data, isLoading } = useDashboardStats()
  const attendance = data?.attendance || []

  return (
    <GlassChartContainer title="Weekly Attendance" subtitle="Present vs Absent">
      {isLoading ? (
        <CardSkeleton />
      ) : attendance.length ? (
        <BarsChart
          data={attendance}
          xKey="day"
          bars={[
            { key: 'present', color: '#10B981' },
            { key: 'absent', color: '#EF4444' },
          ]}
        />
      ) : (
        <EmptyState title="No attendance data" description="Attendance trends will appear once records exist." />
      )}
    </GlassChartContainer>
  )
}
