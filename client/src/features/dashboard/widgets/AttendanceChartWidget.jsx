import { useNavigate } from 'react-router-dom'
import { FiArrowRight } from 'react-icons/fi'
import { Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassChartContainer } from '@/components/glass'
import { BarsChart } from '@/components/charts/Charts'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

export default function AttendanceChartWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useDashboardStats()
  const attendance = data?.attendance || []

  return (
    <GlassChartContainer
      title="Weekly Attendance"
      subtitle="Present vs Absent"
      action={
        <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/attendance/reports')}>
          Reports
        </Button>
      }
    >
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
