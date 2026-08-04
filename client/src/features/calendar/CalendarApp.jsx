// Calendar module orchestrator: toolbar, sidebar, view switching, React Query
// data, drag-and-drop rescheduling and the event editor.
import { useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiChevronLeft, FiChevronRight, FiPlus, FiFilter } from 'react-icons/fi'
import { PageHeader, Button } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { cn } from '@/utils'
import { calendarApi, attendanceApi, employeeApi, leaveApi, projectApi } from '@/api/services'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { EVENT_TYPES, VIEW, VIEW_LIST } from './constants'
import { expandEvents, occStart, occEnd } from './recurrence'
import MonthView from './MonthView'
import WeekView from './WeekView'
import DayView from './DayView'
import AgendaView from './AgendaView'
import CalendarSidebar from './CalendarSidebar'
import EventModal from './EventModal'

// Visible window per view, used to expand recurring events.
function getWindow(view, current) {
  if (view === VIEW.MONTH) {
    const start = current.startOf('month')
    const leading = start.day()
    const gridStart = start.subtract(leading, 'day')
    return [gridStart, gridStart.add(41, 'day').endOf('day')]
  }
  if (view === VIEW.WEEK) {
    const s = current.startOf('week')
    return [s, s.add(6, 'day').endOf('day')]
  }
  if (view === VIEW.DAY) return [current.startOf('day'), current.endOf('day')]
  // agenda: ~2 months
  const s = current.startOf('month')
  return [s, s.add(1, 'month').endOf('month')]
}

function dateLabel(view, current) {
  if (view === VIEW.MONTH) return current.format('MMMM YYYY')
  if (view === VIEW.DAY) return current.format('dddd, MMMM D, YYYY')
  if (view === VIEW.WEEK) {
    const s = current.startOf('week')
    const e = s.add(6, 'day')
    return s.isSame(e, 'month')
      ? `${s.format('MMM D')} – ${e.format('D, YYYY')}`
      : `${s.format('MMM D')} – ${e.format('MMM D, YYYY')}`
  }
  const s = current.startOf('month')
  const e = s.add(1, 'month').endOf('month')
  return `${s.format('MMMM')} – ${e.format('MMMM YYYY')}`
}

export default function CalendarApp() {
  const today = dayjs()
  const now = dayjs()
  const [view, setView] = useState(VIEW.MONTH)
  const [current, setCurrent] = useState(() => dayjs())
  const [activeTypes, setActiveTypes] = useState(EVENT_TYPES)
  const [showFilters, setShowFilters] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [defaultStart, setDefaultStart] = useState(() => dayjs().hour(9).minute(0).second(0).millisecond(0))
  const dragRef = useRef(null)

  const qc = useQueryClient()
  const { user } = useAuth()
  // Employees get READ-ONLY calendar access (view events / holidays / meetings
  // but no create / edit / delete). Every other role keeps full access, so this
  // is a purely additive, Employee-scoped restriction — RBAC for Admin / HR /
  // Admin / Manager / etc. is unchanged.
  const canManageEvents = user?.role !== ROLES.EMPLOYEE
  const { notify } = useNotifications()
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar-events'],
    queryFn: calendarApi.list,
  })

  // Phase 6.4 (TASK 5) ROOT CAUSE FIX: Company Holidays live in a separate
  // Holiday collection (attendance module) that CalendarEvent never read, so
  // a newly-created holiday never appeared on this page even though Leave /
  // Reports / other calendars already read the same Holiday collection
  // directly. Fetching it here and merging it into the event stream (instead
  // of duplicating holiday storage) fixes the root cause everywhere this
  // component is the source of truth for what's "on the calendar".
  const { data: holidays = [] } = useQuery({
    queryKey: ['attendance-holidays'],
    queryFn: attendanceApi.holidays.all,
  })
  const holidayEvents = useMemo(
    () =>
      (holidays || []).map((h) => ({
        id: `holiday-${h._id || h.id}`,
        masterId: `holiday-${h._id || h.id}`,
        title: h.name,
        type: 'holiday',
        start: h.date,
        end: h.date,
        allDay: true,
        readOnly: true,
        recurrence: { freq: 'none' },
        done: false,
      })),
    [holidays],
  )

  // Phase 6.5 (TASK 6) ROOT CAUSE: Phase 6.4 added the birthday / training /
  // leave-status / company-event color categories to TYPE_META, but nothing
  // ever produced actual events of those types — Training and Company Events
  // were already reachable because EventModal lets any writer pick them
  // manually, but Birthdays and the three Leave-status types had NO data
  // source at all. Fixed by reusing the SAME employee and leave data (and the
  // SAME services.js APIs already used elsewhere) and merging them into the
  // event stream client-side, exactly like the Phase 6.4 holiday merge above
  // — no new storage, no second Calendar implementation.
  const { data: employeesForBirthdays = [] } = useQuery({
    queryKey: ['calendar-birthdays'],
    queryFn: () => employeeApi.query({ limit: 500 }),
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })
  const birthdayEvents = useMemo(
    () =>
      (employeesForBirthdays || [])
        .filter((e) => e.dob)
        .map((e) => ({
          id: `birthday-${e._id || e.id}`,
          masterId: `birthday-${e._id || e.id}`,
          title: `${e.name}'s Birthday`,
          type: 'birthday',
          start: e.dob,
          end: e.dob,
          allDay: true,
          readOnly: true,
          // Yearly recurrence reuses the SAME recurrence engine (recurrence.js)
          // that already powers recurring meetings/tasks — no engine change.
          recurrence: { freq: 'yearly' },
          done: false,
        })),
    [employeesForBirthdays],
  )

  // Admin/HR/Manager can approve leave, so they see the org-wide leave list
  // (already used by the Leave Requests inbox); Employee sees only their own
  // requests via the existing /leave/me endpoint — this preserves RBAC exactly
  // as leaveRoutes.js already enforces it (canApprove gates /leave/requests).
  const canViewOrgLeave = [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER].includes(user?.role)
  const { data: leaveForCalendar = [] } = useQuery({
    queryKey: canViewOrgLeave ? ['calendar-leave-org'] : ['calendar-leave-mine'],
    queryFn: () => (canViewOrgLeave ? leaveApi.query({ limit: 500 }) : leaveApi.myRequests({ limit: 500 })),
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })
  const LEAVE_STATUS_TYPE = { Approved: 'leave-approved', Pending: 'leave-pending', Rejected: 'leave-rejected' }
  const leaveEvents = useMemo(
    () =>
      (leaveForCalendar || [])
        .filter((l) => LEAVE_STATUS_TYPE[l.status])
        .map((l) => ({
          id: `leave-${l._id || l.id}`,
          masterId: `leave-${l._id || l.id}`,
          title: canViewOrgLeave ? `${l.employee} \u2014 Leave (${l.status})` : `My Leave (${l.status})`,
          type: LEAVE_STATUS_TYPE[l.status],
          start: l.from,
          end: l.to,
          allDay: true,
          readOnly: true,
          recurrence: { freq: 'none' },
          done: false,
        })),
    [leaveForCalendar, canViewOrgLeave],
  )

  // Phase 6.9 (Task 15) ROOT CAUSE FIX: ProjectCalendar.jsx was a SECOND,
  // disconnected calendar UI reading Project/Task/Milestone data directly,
  // with no RBAC scoping at all — any authenticated role (including Employee)
  // could see every project's dates. Merged here using the SAME client-side
  // pattern as the holiday/birthday/leave merges above, backed by a NEW
  // server endpoint (projectApi.calendarEvents) that reuses the existing
  // accessibleProjectFilter RBAC scope — an Employee only ever receives
  // events for projects they lead, are a member of, or have an assigned task
  // in; zero project events if none. Privileged roles are unaffected.
  const { data: projectCalendarData } = useQuery({
    queryKey: ['calendar-project-events'],
    queryFn: projectApi.calendarEvents,
  })
  const projectEvents = useMemo(() => {
    const projects = projectCalendarData?.projects || []
    const milestones = projectCalendarData?.milestones || []
    const taskDeadlines = projectCalendarData?.taskDeadlines || []
    const out = []
    for (const p of projects) {
      const pid = p._id || p.id
      if (p.startDate) {
        out.push({
          id: `project-start-${pid}`,
          masterId: `project-start-${pid}`,
          title: `${p.name} \u2014 Project Start`,
          type: 'project-start',
          start: p.startDate,
          end: p.startDate,
          allDay: true,
          readOnly: true,
          recurrence: { freq: 'none' },
          done: false,
        })
      }
      if (p.deadline) {
        out.push({
          id: `project-deadline-${pid}`,
          masterId: `project-deadline-${pid}`,
          title: `${p.name} \u2014 Project Deadline`,
          type: 'project-deadline',
          start: p.deadline,
          end: p.deadline,
          allDay: true,
          readOnly: true,
          recurrence: { freq: 'none' },
          done: false,
        })
      }
    }
    for (const m of milestones) {
      if (!m.dueDate) continue
      const mid = m._id || m.id
      out.push({
        id: `milestone-${mid}`,
        masterId: `milestone-${mid}`,
        title: `Milestone: ${m.title}`,
        type: 'milestone',
        start: m.dueDate,
        end: m.dueDate,
        allDay: true,
        readOnly: true,
        recurrence: { freq: 'none' },
        done: m.status === 'Reached',
      })
    }
    for (const t of taskDeadlines) {
      if (!t.dueDate) continue
      const tid = t._id || t.id
      out.push({
        id: `task-deadline-${tid}`,
        masterId: `task-deadline-${tid}`,
        title: `Task Due: ${t.title}`,
        type: 'task-deadline',
        start: t.dueDate,
        end: t.dueDate,
        allDay: true,
        readOnly: true,
        recurrence: { freq: 'none' },
        done: t.status === 'Done',
      })
    }
    return out
  }, [projectCalendarData])

  // Phase 6.9 (Task 17): projects the current user leads. Reuses the SAME
  // ['projects', 'all'] query key/fetcher as useMyProjects.js so this shares
  // its cache instead of firing a second project list request \u2014 needed so a
  // Project Lead (a non-privileged role) can action meeting requests tied to
  // their own project, mirroring the server's isProjectLead check in
  // calendarController.updateMeetingStatus.
  const { data: allProjectsForLead } = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectApi.all(),
  })
  const ledProjectIds = useMemo(() => {
    const rows = Array.isArray(allProjectsForLead) ? allProjectsForLead : allProjectsForLead?.data || []
    if (!user?.name) return new Set()
    return new Set(rows.filter((p) => p.lead === user.name).map((p) => String(p._id || p.id)))
  }, [allProjectsForLead, user?.name])

  // Mirrors PROJECT_FULL_ACCESS + isProjectLead on the server \u2014 this is a UI
  // affordance only; the server independently re-checks the same rule before
  // actually applying any status change.
  //
  // Phase 6.15 (TASK 5B) ROOT CAUSE: this only ever checked ROLE / lead-ship,
  // never WHO raised the request, so a privileged user (e.g. HR) who created a
  // meeting themselves still passed the role check and saw Accept/Reject/
  // Reschedule for their own request - actions that only make sense for the
  // OTHER party. The requester is now excluded first, using the SAME
  // `createdBy` field the server already stamps on every calendar write (see
  // calendarController.create / clientController.createMeetingRequest) - no
  // new field, no new rule source. The server's assertCanManageMeeting applies
  // the identical exclusion, so this is not just a UI-only hide.
  // Phase 6.19 (TASK 5) ROOT CAUSE FIX: this only ever excluded the ONE
  // person who raised the request (isRequester) and then checked role/
  // lead-ship - it never checked WHICH DIRECTION the request travels. A
  // meeting STAFF raised (o.requestedBy === 'staff') is a request TO the
  // client, so per the server's assertCanManageMeeting (calendarController.js)
  // NO staff caller may act on it, regardless of role or authorship - only
  // the client can (see ClientMeetings.jsx / assertClientCanRespond). Without
  // this check, an Admin/Manager/HR viewer who did not create the request
  // still saw Accept/Reject/Cancel for a staff-initiated meeting here, even
  // though the server would reject the attempt with a 403. This reuses the
  // SAME `requestedBy` field already introduced in Phase 6.17 - no new field,
  // no new rule.
  const canActOnMeeting = (o) => {
    const requester = o?.createdBy
    const isRequester = Boolean(requester) && (requester === user?.name || requester === user?.email)
    if (isRequester) return false
    if (o?.requestedBy === 'staff') return false
    return (
      [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER].includes(user?.role) ||
      Boolean(o?.projectId && ledProjectIds.has(String(o.projectId)))
    )
  }

  // Phase 6.9 (Task 15): "Sundays" as a single synthetic weekly-recurring
  // all-day marker, expanded by the SAME recurrence engine that already
  // powers every other recurring event — no new engine, no stored data.
  const sundayEvents = useMemo(
    () => [
      {
        id: 'sunday-recurring',
        masterId: 'sunday-recurring',
        title: 'Sunday',
        type: 'sunday',
        start: dayjs().day(0).format('YYYY-MM-DD'),
        end: dayjs().day(0).format('YYYY-MM-DD'),
        allDay: true,
        readOnly: true,
        recurrence: { freq: 'weekly', byWeekday: [0] },
        done: false,
      },
    ],
    [],
  )

  const allEvents = useMemo(
    () => [...events, ...holidayEvents, ...birthdayEvents, ...leaveEvents, ...projectEvents, ...sundayEvents],
    [events, holidayEvents, birthdayEvents, leaveEvents, projectEvents, sundayEvents],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['calendar-events'] })
    // Phase 6.4 (TASK 5): keep the merged Holiday view fresh alongside regular
    // calendar events whenever anything on the calendar changes.
    qc.invalidateQueries({ queryKey: ['attendance-holidays'] })
    // Phase 6.5 (TASK 6): keep the merged Birthday / Leave-status views fresh
    // for the same reason — a calendar write should not desync the other
    // merged sources on this same page.
    qc.invalidateQueries({ queryKey: ['calendar-birthdays'] })
    qc.invalidateQueries({ queryKey: ['calendar-leave-org'] })
    qc.invalidateQueries({ queryKey: ['calendar-leave-mine'] })
    // Phase 6.9 (Task 15): keep the merged Project Start/Deadline/Milestone/
    // Task Deadline view fresh for the same reason.
    qc.invalidateQueries({ queryKey: ['calendar-project-events'] })
  }

  const saveMut = useMutation({
    mutationFn: ({ masterId, payload }) =>
      masterId ? calendarApi.update(masterId, payload) : calendarApi.create(payload),
    onSuccess: (_r, { masterId, payload }) => {
      invalidate()
      setModalOpen(false)
      toast.success('Event saved')
      // Real notification only when a brand-new event is created (not on edits).
      if (!masterId) {
        notify({
          type: 'meeting',
          title: `New event: ${payload?.title || 'Untitled event'}`,
          body: payload?.start
            ? `Scheduled for ${dayjs(payload.start).format('MMM D, h:mm A')}.`
            : 'A new event was added to the calendar.',
          link: '/calendar',
          priority: 'normal',
        })
      }
    },
    onError: () => toast.error('Could not save event'),
  })
  const deleteMut = useMutation({
    mutationFn: (masterId) => calendarApi.remove(masterId),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
      toast.success('Event deleted')
    },
    onError: () => toast.error('Could not delete event'),
  })
  const toggleMut = useMutation({
    mutationFn: (masterId) => calendarApi.toggleDone(masterId),
    onSuccess: invalidate,
  })
  const reschedMut = useMutation({
    mutationFn: ({ masterId, patch }) => calendarApi.update(masterId, patch),
    onSuccess: invalidate,
  })
  // Phase 6.9 (Task 17): Approve/Reject/Cancel a client meeting request from
  // the event editor. Reuses the SAME invalidate() as every other calendar
  // mutation above \u2014 no separate refresh path.
  const statusMut = useMutation({
    mutationFn: ({ id, status }) => calendarApi.updateMeetingStatus(id, status),
    onSuccess: (_r, { status }) => {
      invalidate()
      setModalOpen(false)
      toast.success(`Meeting ${status.toLowerCase()}`)
    },
    onError: () => toast.error('Could not update meeting status'),
  })

  const [windowStart, windowEnd] = getWindow(view, current)
  const occurrences = useMemo(() => {
    const expanded = expandEvents(allEvents, windowStart, windowEnd)
    return expanded.filter((o) => activeTypes.includes(o.type))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEvents, view, current, activeTypes])

  // --- Navigation ---
  const goPrev = () => {
    if (view === VIEW.MONTH || view === VIEW.AGENDA) setCurrent((c) => c.subtract(1, 'month'))
    else if (view === VIEW.WEEK) setCurrent((c) => c.subtract(1, 'week'))
    else setCurrent((c) => c.subtract(1, 'day'))
  }
  const goNext = () => {
    if (view === VIEW.MONTH || view === VIEW.AGENDA) setCurrent((c) => c.add(1, 'month'))
    else if (view === VIEW.WEEK) setCurrent((c) => c.add(1, 'week'))
    else setCurrent((c) => c.add(1, 'day'))
  }

  // --- Modal helpers ---
  const openCreate = (day) => {
    if (!canManageEvents) return
    setEditing(null)
    setDefaultStart((day ? dayjs(day) : dayjs()).hour(9).minute(0).second(0).millisecond(0))
    setModalOpen(true)
  }
  const openEdit = (o) => {
    setEditing(o)
    setModalOpen(true)
  }

  // --- Drag and drop rescheduling ---
  const reschedule = (o, newStart, { allDay = false } = {}) => {
    if (!o || !canManageEvents) return
    const dur = occEnd(o).diff(occStart(o))
    reschedMut.mutate({
      masterId: o.masterId,
      patch: {
        start: newStart.toISOString(),
        end: newStart.add(dur).toISOString(),
        allDay,
      },
    })
  }
  const onDropToDay = (day) => {
    const o = dragRef.current
    if (!o) return
    const s = occStart(o)
    reschedule(o, dayjs(day).hour(s.hour()).minute(s.minute()).second(0))
    dragRef.current = null
  }
  const onDropToSlot = (day, newStart) => {
    const o = dragRef.current
    if (!o) return
    reschedule(o, newStart)
    dragRef.current = null
  }
  const onDropToAllDay = (day) => {
    const o = dragRef.current
    if (!o) return
    reschedule(o, dayjs(day).startOf('day'), { allDay: true })
    dragRef.current = null
  }

  const toggleType = (t) =>
    setActiveTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  const viewProps = {
    occurrences,
    today,
    now,
    onEventClick: openEdit,
    onToggleDone: (o) => toggleMut.mutate(o.masterId),
    onEventDragStart: (o) => {
      dragRef.current = o
    },
    onEventDragEnd: () => {
      dragRef.current = null
    },
    onDropToDay,
    onDropToSlot,
    onDropToAllDay,
    onDateClick: (day, mode) => {
      if (mode === 'create') openCreate(day)
      else {
        setCurrent(dayjs(day))
        setView(VIEW.DAY)
      }
    },
    onShowMore: (day) => {
      setCurrent(dayjs(day))
      setView(VIEW.DAY)
    },
  }

  const renderView = () => {
    if (isLoading) {
      return <div className="card flex h-[60vh] items-center justify-center text-muted">Loading calendar…</div>
    }
    if (view === VIEW.MONTH) return <MonthView current={current} {...viewProps} />
    if (view === VIEW.WEEK) return <WeekView current={current} {...viewProps} />
    if (view === VIEW.DAY) return <DayView current={current} {...viewProps} />
    return <AgendaView occurrences={occurrences} today={today} onEventClick={openEdit} onToggleDone={(o) => toggleMut.mutate(o.masterId)} />
  }

  const sidebar = (
    <CalendarSidebar
      current={current}
      today={today}
      activeTypes={activeTypes}
      onToggleType={toggleType}
      onSelectDate={(day) => setCurrent(dayjs(day))}
      onCreate={canManageEvents ? () => openCreate() : null}
    />
  )

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Meetings, tasks, events, deadlines and company holidays."
        actions={
          canManageEvents ? (
            <Button icon={FiPlus} onClick={() => openCreate()} className="hidden sm:inline-flex">
              New Event
            </Button>
          ) : null
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setCurrent(dayjs())}>Today</Button>
          <button className="btn-ghost px-2 py-2" onClick={goPrev} aria-label="Previous">
            <FiChevronLeft />
          </button>
          <button className="btn-ghost px-2 py-2" onClick={goNext} aria-label="Next">
            <FiChevronRight />
          </button>
          <h2 className="ml-1 text-lg font-semibold">{dateLabel(view, current)}</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn-ghost px-3 py-2 lg:hidden"
            onClick={() => setShowFilters((s) => !s)}
            aria-label="Toggle filters"
          >
            <FiFilter />
          </button>
          {/* View switcher */}
          <div className="flex rounded-xl border border-app p-0.5">
            {VIEW_LIST.map((v) => (
              <button
                key={v.value}
                onClick={() => setView(v.value)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  view === v.value ? 'bg-primary text-white' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile filters */}
      {showFilters && <div className="mb-4 lg:hidden">{sidebar}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">{sidebar}</aside>
        <div>{renderView()}</div>
      </div>

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        readOnly={!canManageEvents}
        event={editing}
        defaultStart={defaultStart}
        onSave={(masterId, payload) => saveMut.mutate({ masterId, payload })}
        onDelete={(masterId) => deleteMut.mutate(masterId)}
        canActOnMeeting={canActOnMeeting(editing)}
        onUpdateStatus={(id, status) => statusMut.mutate({ id, status })}
      />
    </div>
  )
}
