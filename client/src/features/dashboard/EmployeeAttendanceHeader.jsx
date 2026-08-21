import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FiLogIn, FiLogOut, FiCoffee, FiPlay, FiClock, FiBriefcase, FiHash } from 'react-icons/fi'
import { Avatar, Badge, Button } from '@/components/ui'
import { useAttendanceSession } from '@/features/attendance/CheckInCard'

const fmtHM = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function EmployeeAttendanceHeader({ user }) {
  const [clock, setClock] = useState(() => new Date())
  const { anchors, checkInMut, checkOutMut, breakMut } = useAttendanceSession()

  const {
    checkedIn, checkInAt, checkOutAt, onBreak,
    checkInEpochMs, closedBreakSecs, breakStartedAtMs, finalWorkSecs,
  } = anchors

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const nowMs = clock.getTime()
  const breakSecs = closedBreakSecs + (breakStartedAtMs ? Math.max(0, Math.floor((nowMs - breakStartedAtMs) / 1000)) : 0)
  const workSecs = finalWorkSecs != null
    ? finalWorkSecs
    : (checkInEpochMs ? Math.max(0, Math.floor((nowMs - checkInEpochMs) / 1000) - breakSecs) : 0)

  const dateLabel = clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeLabel = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

  const empId = user?.empCode || '\u2014'
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
