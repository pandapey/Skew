import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FiLogIn, FiLogOut, FiCoffee, FiPlay, FiClock, FiBriefcase, FiHash } from 'react-icons/fi'
import { Avatar, Badge, Button } from '@/components/ui'
import { useAttendanceSession } from '@/features/attendance/CheckInCard'

// HH:MM:SS format helper. Work/break durations below are DERIVED from
// absolute timestamps supplied by useAttendanceSession() (see that hook's
// Phase 6.9 (TASK 1) notes) - this only formats a second count, it does not
// itself keep any running counter.
const fmtHM = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// Premium Employee-only daily work header (rendered ONLY inside
// EmployeeWorkspaceDashboard, which pages/Dashboard.jsx shows exclusively to the
// Employee role). It merges the attendance check-in workflow into the dashboard
// so an employee can see who they are, today's live attendance, and act
// (Check In / Break / Check Out) without opening the Attendance page.
//
// ---------------------------------------------------------------------------
// Phase 6.19 (TASK 1) ROOT CAUSE FIX - BREAK TIMER RESET ON NAVIGATION
//
// ROOT CAUSE: this component used to keep its OWN `checkedIn` / `onBreak` /
// `workSecs` / `breakSecs` useState values and its own setInterval counters,
// entirely separate from the shared attendance state in
// features/attendance/CheckInCard.jsx. Because this header is rendered by a
// route-level dashboard page, navigating to another page and back UNMOUNTS it,
// discarding that local component state - which is exactly why the break
// timer reset to 00:00 even though the backend break session was still open
// (the backend was always correct, matching the reported symptom that Stop
// Break showed the right elapsed time).
//
// FIX (no new timer, no duplicated attendance state): this header now
// consumes the SAME useAttendanceSession() hook <CheckInCard/> uses. That
// hook holds today's record in the shared ['attendance-today'] react-query
// cache (survives navigation/unmount) and derives every duration from
// absolute timestamps already in MongoDB (checkInSeconds, breaks[].start/
// end), so re-entering the Dashboard resumes from the real, currently-open
// break session instead of restarting a local counter. There is still
// exactly ONE attendance/timer implementation; this component only renders it
// in its own 3-column layout.
// ---------------------------------------------------------------------------
export function EmployeeAttendanceHeader({ user }) {
  const [clock, setClock] = useState(() => new Date())
  const { anchors, checkInMut, checkOutMut, breakMut } = useAttendanceSession()

  const {
    checkedIn, checkInAt, checkOutAt, onBreak,
    checkInEpochMs, closedBreakSecs, breakStartedAtMs, finalWorkSecs,
  } = anchors

  // Single wall-clock tick, exactly like CheckInCard - drives the displayed
  // time and the derived work/break durations below. This is the only
  // interval in this component; it never increments a duration directly.
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const nowMs = clock.getTime()
  // Break = every closed session + the live elapsed time of the open one.
  const breakSecs = closedBreakSecs + (breakStartedAtMs ? Math.max(0, Math.floor((nowMs - breakStartedAtMs) / 1000)) : 0)
  // Work = wall time since check-in minus all break time. After check-out the
  // server's stored `durationSecs` is authoritative and the clock stops.
  const workSecs = finalWorkSecs != null
    ? finalWorkSecs
    : (checkInEpochMs ? Math.max(0, Math.floor((nowMs - checkInEpochMs) / 1000) - breakSecs) : 0)

  const dateLabel = clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeLabel = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

  const empId = user?.empCode || (user?._id ? `EMP-${String(user._id).slice(-6).toUpperCase()}` : '\u2014')
  const statusTone = checkOutAt ? 'default' : onBreak ? 'warning' : checkedIn ? 'success' : 'default'
  const statusText = checkOutAt ? 'Shift Complete' : onBreak ? 'On Break' : checkedIn ? 'Checked In' : 'Not Checked In'

  return (
    <section className="overflow-hidden rounded-card border border-app shadow-floating-sm" aria-label="Daily attendance">
      <div className="grid grid-cols-1 gap-px bg-app lg:grid-cols-3">
        {/* LEFT \u2014 Employee information */}
        <div className="flex items-center gap-4 bg-gradient-to-br from-primary to-accent p-6 text-white">
          <Avatar name={user?.name} src={user?.avatar} size={64} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{user?.name || 'Employee'}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-white/85"><FiHash className="h-3 w-3" />Employee ID: {empId}</p>
            {user?.designation && <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/85"><FiBriefcase className="h-3 w-3" />{user.designation}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {user?.role && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">{user.role}</span>}
              {user?.department && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">{user.department}</span>}
            </div>
          </div>
        </div>

        {/* CENTER \u2014 Today's attendance (live) */}
        <div className="bg-card p-6">
          <p className="text-xs text-muted">{dateLabel}</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums">{timeLabel}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <p className="flex items-center gap-1 text-[11px] text-muted"><FiClock className="h-3 w-3" />Working Time</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{fmtHM(workSecs)}</p>
            </div>
            <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <p className="flex items-center gap-1 text-[11px] text-muted"><FiCoffee className="h-3 w-3" />Break Time</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{fmtHM(breakSecs)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <span>Status</span>
            <Badge tone={statusTone}>{statusText}</Badge>
            {checkInAt && <span className="ml-auto">In {checkInAt}{checkOutAt ? ` \u00b7 Out ${checkOutAt}` : ''}</span>}
          </div>
        </div>

        {/* RIGHT \u2014 Attendance actions */}
        <div className="flex flex-col justify-center gap-3 bg-card p-6">
          {!checkedIn ? (
            <Button size="lg" glow icon={FiLogIn} loading={checkInMut.isPending} onClick={() => checkInMut.mutate()} className="w-full justify-center">
              Check In
            </Button>
          ) : checkOutAt ? (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-2 text-center">
              <Badge tone="success">Shift Complete \u2713</Badge>
              <p className="text-xs text-muted">See you tomorrow!</p>
            </motion.div>
          ) : (
            <>
              <Button size="lg" variant={onBreak ? 'success' : 'ghost'} icon={onBreak ? FiPlay : FiCoffee} loading={breakMut.isPending} onClick={() => breakMut.mutate()} className="w-full justify-center">
                {onBreak ? 'Break End' : 'Break Start'}
              </Button>
              <Button size="lg" variant="danger" icon={FiLogOut} loading={checkOutMut.isPending} onClick={() => checkOutMut.mutate()} className="w-full justify-center">
                Check Out
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
