import { useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
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

function initialCursor(search) {
  const raw = new URLSearchParams(search || '').get('date')
  if (!raw) return dayjs()
  const d = dayjs(raw)
  return d.isValid() ? d : dayjs()
}

export default function CalendarApp() {
  const today = dayjs()
  const now = dayjs()
  const { search } = useLocation()
  const [view, setView] = useState(VIEW.MONTH)
  const [current, setCurrent] = useState(() => initialCursor(search))
  const [activeTypes, setActiveTypes] = useState(EVENT_TYPES)
  const [showFilters, setShowFilters] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [defaultStart, setDefaultStart] = useState(() => dayjs().hour(9).minute(0).second(0).millisecond(0))
  const dragRef = useRef(null)

  const qc = useQueryClient()
  const { user } = useAuth()
  const canManageEvents = user?.role !== ROLES.EMPLOYEE
  const { notify } = useNotifications()

  const [windowStart, windowEnd] = getWindow(view, current)
  const { data: eventsRaw = [], isLoading } = useQuery({
    queryKey: ['calendar-events', 'range', windowStart.toISOString(), windowEnd.toISOString()],
    queryFn: () => calendarApi.range(windowStart.toISOString(), windowEnd.toISOString()),
  })

  // Fix: normalize API {_id} -> {id, masterId} so edit/delete target the real id.
  // Without this, delete called DELETE /calendar/undefined and silently failed.
  const events = useMemo(
    () =>
      (Array.isArray(eventsRaw) ? eventsRaw : []).map((e) => {
        const nid = e.id || (e._id ? String(e._id) : undefined)
        return { ...e, id: nid, masterId: e.masterId || nid }
      }),
    [eventsRaw],
  )

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
          recurrence: { freq: 'yearly' },
          done: false,
        })),
    [employeesForBirthdays],
  )

  const canViewOrgLeave = [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role)
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

  const { data: allProjectsForLead } = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectApi.all(),
  })
  const ledProjectIds = useMemo(() => {
    const rows = Array.isArray(allProjectsForLead) ? allProjectsForLead : allProjectsForLead?.data || []
    if (!user?.name) return new Set()
    return new Set(rows.filter((p) => p.lead === user.name).map((p) => String(p._id || p.id)))
  }, [allProjectsForLead, user?.name])

  const canActOnMeeting = (o) => {
    const requester = o?.createdBy
    const isRequester = Boolean(requester) && (requester === user?.name || requester === user?.email)
    if (isRequester) return false
    if (o?.requestedBy === 'staff') return false
    return (
      [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role) ||
      Boolean(o?.projectId && ledProjectIds.has(String(o.projectId)))
    )
  }

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
    qc.invalidateQueries({ queryKey: ['attendance-holidays'] })
    qc.invalidateQueries({ queryKey: ['calendar-birthdays'] })
    qc.invalidateQueries({ queryKey: ['calendar-leave-org'] })
    qc.invalidateQueries({ queryKey: ['calendar-leave-mine'] })
    qc.invalidateQueries({ queryKey: ['calendar-project-events'] })
  }

  const saveMut = useMutation({
    mutationFn: ({ masterId, payload }) =>
      masterId ? calendarApi.update(masterId, payload) : calendarApi.create(payload),
    onSuccess: (_r, { masterId, payload }) => {
      invalidate()
      setModalOpen(false)
      toast.success('Event saved')
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
  const statusMut = useMutation({
    mutationFn: ({ id, status }) => calendarApi.updateMeetingStatus(id, status),
    onSuccess: (_r, { status }) => {
      invalidate()
      setModalOpen(false)
      toast.success(`Meeting ${status.toLowerCase()}`)
    },
    onError: () => toast.error('Could not update meeting status'),
  })

  const windowOcc = useMemo(() => {
    const expanded = expandEvents(allEvents, windowStart, windowEnd)
    return expanded.filter(
      (o) =>
        occStart(o).isBefore(windowEnd) &&
        occEnd(o).isAfter(windowStart),
    )
  }, [allEvents, view, current])

  const inPeriod = (s) => {
    if (view === VIEW.WEEK) return s.isSame(current, 'week')
    if (view === VIEW.DAY) return s.isSame(current, 'day')
    return s.isSame(current, 'month')
  }

  const availableTypes = useMemo(() => {
    const types = new Set()
    for (const o of windowOcc) if (inPeriod(occStart(o))) types.add(o.type)
    return types
  }, [windowOcc, view, current])

  const occurrences = useMemo(
    () => windowOcc.filter((o) => activeTypes.includes(o.type)),
    [windowOcc, activeTypes],
  )

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
      availableTypes={availableTypes}
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

      {}
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
          {}
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

      {}
      {showFilters && <div className="mb-4 lg:hidden">{sidebar}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">{sidebar}</aside>
        <div>{renderView()}</div>
      </div>

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        readOnly={!canManageEvents || Boolean(editing?.readOnly)}
        event={editing}
        defaultStart={defaultStart}
        onSave={(masterId, payload) => saveMut.mutate({ masterId, payload })}
        onDelete={(masterId) => {
          const rid = masterId || editing?.masterId || editing?.id || editing?._id
          if (!rid || String(rid).includes('holiday-') || String(rid).includes('birthday-') || String(rid).includes('leave-') || String(rid).includes('project-') || String(rid).includes('milestone-') || String(rid).includes('task-deadline-') || String(rid) === 'sunday-recurring') return
          deleteMut.mutate(rid)
        }}
        canActOnMeeting={canActOnMeeting(editing)}
        onUpdateStatus={(id, status) => statusMut.mutate({ id, status })}
      />
    </div>
  )
}
