import { useEffect, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/ui'
import { useWorkspace } from '@/services/workspace/workspaceService'
import { WidgetGrid } from '@/features/dashboard/WidgetGrid'
import { QuickActionsGrid } from '@/features/dashboard/QuickActionsGrid'
import { EmployeeAttendanceHeader } from '@/features/dashboard/EmployeeAttendanceHeader'
import { WIDGET_IDS } from '@/features/dashboard/widgetRegistry'

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const EMPLOYEE_HIDDEN_WIDGETS = [
  'checkin', 'leave-balance', 'my-projects', 'salary-summary', 'recent-activity',
  'today-meetings', 'upcoming-holidays',
]

export default function EmployeeWorkspaceDashboard() {
  const { user } = useAuth()
  const { layout, actions } = useWorkspace()

  const registerWidgetIds = actions?.registerWidgetIds
  useEffect(() => {
    registerWidgetIds?.(WIDGET_IDS)
  }, [registerWidgetIds])

  const firstName = user?.name?.split(' ')[0] || 'there'

  const employeeLayout = useMemo(
    () => ({ ...layout, hidden: [...new Set([...(layout.hidden || []), ...EMPLOYEE_HIDDEN_WIDGETS])] }),
    [layout]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle="Here's your workspace for today."
      />

      <EmployeeAttendanceHeader user={user} />

      <QuickActionsGrid />

      <WidgetGrid layout={employeeLayout} />
    </div>
  )
}
