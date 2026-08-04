import { useEffect, useMemo, useState } from 'react'
import { FiSliders } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { Button, PageHeader } from '@/components/ui'
import { useWorkspace } from '@/services/workspace/workspaceService'
import { WidgetGrid } from '@/features/dashboard/WidgetGrid'
import { QuickActionsGrid } from '@/features/dashboard/QuickActionsGrid'
import { EmployeeAttendanceHeader } from '@/features/dashboard/EmployeeAttendanceHeader'
import { CustomizeDashboardModal } from '@/features/dashboard/CustomizeDashboardModal'
import { WIDGET_IDS } from '@/features/dashboard/widgetRegistry'

// Time-of-day greeting. Kept as a pure helper so it's trivially testable and
// avoids pulling a date library in just for one branch.
function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Employee workspace dashboard (shown ONLY to the Employee role \u2014 see
// pages/Dashboard.jsx, which routes by role). Every other role keeps the
// original organization dashboard in pages/ClassicDashboard.jsx.
//
// This is a true "Daily Work Dashboard": the first thing an employee sees is a
// premium attendance header (who they are + today's live attendance + Check In
// / Break / Check Out actions), so they can start their day without opening the
// Attendance page. Below it are the persistent Quick Actions and the
// personalized `WidgetGrid` (leave balance, tasks, meetings, projects,
// announcements, recent activity, etc.), all gated by role in
// `widgetRegistry.js`.
export default function EmployeeWorkspaceDashboard() {
  const { user } = useAuth()
  const { layout, actions } = useWorkspace()
  const [customizing, setCustomizing] = useState(false)

  // Append any newly-registered widget ids to this user's saved order so new
  // widgets show up without wiping an existing personalized layout.
  const registerWidgetIds = actions?.registerWidgetIds
  useEffect(() => {
    registerWidgetIds?.(WIDGET_IDS)
  }, [registerWidgetIds])

  const firstName = user?.name?.split(' ')[0] || 'there'

  // The new attendance header already contains the full check-in workflow, so
  // hide the redundant 'checkin' widget from the grid \u2014 FOR THE EMPLOYEE
  // DASHBOARD ONLY. This derives a local layout override and never mutates the
  // shared workspace store or the widget registry, so other roles (which render
  // ClassicDashboard) are completely unaffected.
  const employeeLayout = useMemo(
    () => ({ ...layout, hidden: [...new Set([...(layout.hidden || []), 'checkin'])] }),
    [layout]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle="Here's your workspace for today."
        actions={
          <Button variant="ghost" icon={FiSliders} onClick={() => setCustomizing(true)} aria-label="Customize dashboard">
            Customize
          </Button>
        }
      />

      {/* Primary daily-work section: employee info | live attendance | actions */}
      <EmployeeAttendanceHeader user={user} />

      {/* Persistent, always-visible quick actions (not part of the registry) */}
      <QuickActionsGrid />

      {/* Personalized, role-aware widget grid (check-in widget hidden here) */}
      <WidgetGrid layout={employeeLayout} />

      <CustomizeDashboardModal open={customizing} onClose={() => setCustomizing(false)} />
    </div>
  )
}
