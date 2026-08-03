import { useEffect, useState, createContext, useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSocket, resetSocket } from '@/api/socket'
import { useAuth } from '@/hooks/useAuth'

const RealtimeContext = createContext({ connected: false })

export function useRealtime() {
  return useContext(RealtimeContext)
}

// Maps a server `resource:changed` resource name to the React Query key prefix
// the matching list is cached under, so a write in one session refreshes every
// open session. Keep in sync with the query keys used across services.js.
// Phase 6.2 (Task 3) ROOT CAUSE A - INCOMPLETE RESOURCE->KEY MAP.
// The server already broadcasts `resource:changed` for every module write (see
// server.js withEmit(...)), and this map is the ONLY thing that turns such a
// broadcast into a React Query invalidation. Any query key missing from the map
// was simply never invalidated, so its screen kept serving cached data until a
// manual browser refresh. The map covered LIST keys only and completely omitted:
//   * tasks               -> ['tasks','mine',userId], ['task-review-queue'],
//                            ['task-history'], ['my-tasks'], ['task-comments']
//   * salary              -> ['my-salary'], ['my-payslips']
//   * per-detail keys     -> ['project-detail'], ['project-comments'],
//                            ['project-activity'], ['employee-stats'],
//                            ['attendance-today'], ['leave-balances'] ...
// Tasks are served by the 'projects' resource (routes are mounted at
// /api/project), which is why task submit/approve/reject never refreshed
// anything: the emit DID fire, but no task key was listening.
const RESOURCE_QUERY_KEYS = {
  // Phase 6.5 (TASK 7) ROOT CAUSE: 'calendar-birthdays' merges Employee data
  // (dob) onto the Calendar, so an Employee create/update/delete must also
  // bust that merged view, exactly like it already busts ['employees'].
  employees: [['employees'], ['employee-stats'], ['employee'], ['projects', 'all'], ['calendar-birthdays']],
  // Phase 6.8 (TASK 9) CLEANUP: 'my-payslips' was removed - it was never an
  // actual query key anywhere in the app (the Salary Slip page used the same
  // shared ['my-salary'] key like every other salary surface), so busting it
  // did nothing. Confirmed by a repo-wide search before removal.
  hr: [['hr'], ['my-salary'], ['payroll']],
  // Phase 6.4 (TASK 5): 'attendance-holidays' added so a realtime attendance
  // event also refreshes the Calendar page's merged Holiday view for every
  // connected Employee/Manager/HR/Admin session.
  attendance: [['attendance'], ['attendance-today'], ['attendance-summary'], ['attendance-stats'], ['attendance-calendar'], ['attendance-holidays']],
  // Phase 6.5 (TASK 7): 'calendar-leave-org'/'calendar-leave-mine' are the
  // merged Leave-status views CalendarApp.jsx reads (see TASK 6). A leave
  // apply/approve/reject broadcasts resource 'leave', so both must be busted
  // here or an Approve/Reject on one screen would never repaint the Calendar
  // on another open session.
  leave: [['leave'], ['leave-requests'], ['my-leaves'], ['leave-balances'], ['leave-stats'], ['hourly-balance'], ['pending-approvals'], ['calendar-leave-org'], ['calendar-leave-mine']],
  // Projects AND tasks both live under /api/project, so one broadcast must
  // refresh project lists, project detail bundles, the task lists an employee
  // sees, the lead's review queue, task history and task comment threads.
  projects: [
    ['project'], ['projects'], ['projects-all'], ['project-stats'],
    ['project-detail'], ['project-comments'], ['project-activity'],
    ['tasks'], ['my-tasks'], ['task-review-queue'], ['task-history'],
    ['task-comments'], ['my-projects'],
  ],
  finance: [['finance'], ['finance-stats'], ['invoices'], ['transactions']],
  files: [['files'], ['storage']],
  notifications: [['notifications'], ['notification-count']],
  // Phase 6.5 (TASK 7) ROOT CAUSE (CONFIRMED BUG): server.js mounts
  // withEmit(calendarRoutes, 'calendar') so every calendar write broadcasts
  // resource 'calendar' - but CalendarApp.jsx's useQuery is keyed
  // ['calendar-events'] (see calendarApi.list usage), not ['calendar']. That
  // key was never in this map, so a Meeting/Event/Deadline/Task created via
  // the Calendar was broadcast correctly but never invalidated the query the
  // Calendar page actually reads - only a manual refresh picked it up.
  // 'today-meetings' stays for the Dashboard's separate today-meetings widget.
  // Phase 6.17 (TASK 6) ROOT CAUSE FIX: this list drives which React Query
  // caches get invalidated on every realtime 'calendar' event. It never
  // included ['calendar-meetings'] - the exact key MeetingRequestsPanel.jsx
  // (Projects -> Selected Project -> Meeting section) queries with - so a
  // meeting Accepted/Rejected/Rescheduled/Cancelled in one browser session
  // never auto-refreshed that tab in any other open session; only a manual
  // page reload picked it up. Adding the key here is the fix - no new
  // socket event, no new invalidation mechanism, just completing the
  // existing one.
  calendar: [['calendar'], ['calendar-events'], ['today-meetings'], ['calendar-meetings']],
  announcements: [['announcements']],
  clients: [['admin-clients'], ['admin-client-projects']],
  'admin-users': [['admin-users'], ['employees'], ['employee-stats']],
}

export function RealtimeProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      resetSocket()
      setConnected(false)
      return
    }
    const socket = getSocket()
    if (!socket) return

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    // Phase 6.2 (Task 3) ROOT CAUSE B - INVALIDATION WITHOUT REFETCH.
    // invalidateQueries() only marks a query stale; by default TanStack Query
    // refetches an INACTIVE query lazily (on next mount). Combined with the
    // 60s global staleTime and refetchOnWindowFocus:false (api/queryClient.js)
    // this meant a screen that was mounted but whose observer had already
    // resolved kept showing the stale value. Passing refetchType: 'active'
    // forces every CURRENTLY MOUNTED query matching the key to refetch
    // immediately, which is what makes the update visible with no page refresh.
    const bust = (queryKey) => qc.invalidateQueries({ queryKey, refetchType: 'active' })

    const onResourceChanged = ({ resource, id }) => {
      const keys = RESOURCE_QUERY_KEYS[resource]
      if (keys) {
        for (const key of keys) {
          bust(key)
          if (id) bust([...key, id])
        }
      }
      // Cross-cutting caches that aggregate many resources. Dashboard widgets
      // are fed by these keys, so every widget refreshes off the same event
      // instead of each widget needing its own socket listener.
      bust(['dashboard'])
      bust(['dashboard-stats'])
      bust(['notifications'])
    }

    // Phase 5.8 (Task 8): 'client-dashboard' was never an actual query key -
    // ClientDashboard.jsx reads 'client-projects'/'client-activity'/'client-
    // team'/'client-payments' directly, so those are the keys that must be
    // invalidated for the dashboard to "automatically reflect" changes.
    const onClientProject = ({ action }) => {
      bust(['client-projects'])
      bust(['client-project'])
      bust(['client-tasks'])
      bust(['client-activity'])
      bust(['client-project-progress'])
      toast.success('Your project was updated')
    }
    const onClientInvoice = () => {
      bust(['client-payments'])
      bust(['client-projects'])
    }
    const onClientDocument = () => {
      bust(['client-documents'])
      bust(['client-project-documents'])
      bust(['client-projects'])
      bust(['client-activity'])
    }
    // Phase 5.8 (Task 2): 'client:message' is legacy (the standalone Messages
    // thread was retired). The Project Communication Center now runs entirely
    // on 'client:project-comment', emitted by both the client-facing and
    // internal comment endpoints so every open session (client + staff) stays
    // in sync on one shared thread.
    const onClientProjectComment = ({ projectId }) => {
      bust(['client-project-comments'])
      bust(['client-project-comments', projectId])
      bust(['client-activity'])
    }
    const onClientNotification = () => bust(['client-notifications'])

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('resource:changed', onResourceChanged)
    socket.on('client:project', onClientProject)
    socket.on('client:invoice', onClientInvoice)
    socket.on('client:document', onClientDocument)
    socket.on('client:project-comment', onClientProjectComment)
    socket.on('client:notification', onClientNotification)

    if (socket.connected) setConnected(true)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('resource:changed', onResourceChanged)
      socket.off('client:project', onClientProject)
      socket.off('client:invoice', onClientInvoice)
      socket.off('client:document', onClientDocument)
      socket.off('client:project-comment', onClientProjectComment)
      socket.off('client:notification', onClientNotification)
    }
  }, [isAuthenticated, qc, user?.name])

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>
}
