import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { FiLogIn, FiLogOut, FiClock, FiCoffee, FiPlay } from 'react-icons/fi'
import { attendanceApi } from '@/api/services'
import { Card, Button, Badge } from '@/components/ui'

const fmtDur = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Phase 6.9 (TASK 1) - BREAK TIMER PERSISTENCE
//
// REAL ROOT CAUSE (traced UI -> state -> API -> service -> MongoDB):
//
//   1. STATE LIVED IN THE COMPONENT, NOT IN A STORE.
//      `onBreak`, `breakSecs` and `workSecs` were plain useState values inside
//      this component. <CheckInCard/> is rendered by pages/Attendance.jsx and
//      by features/dashboard/widgets/CheckInWidget.jsx, both of which are
//      route-level children. Navigating to another page UNMOUNTS the component,
//      so React discards all three values. That is why the timer "reset to
//      00:00" - nothing was preserved anywhere.
//
//   2. THE TIMER WAS A COUNTER, NOT A CLOCK.
//      The old effect did `setInterval(() => setBreakSecs((s) => s + 1), 1000)`.
//      A +1-per-tick counter only advances while the component is mounted AND
//      the tab is foregrounded (browsers throttle background timers to ~1/min),
//      so it drifted below real elapsed time even without navigation.
//
//   3. HYDRATION IGNORED THE OPEN BREAK SESSION.
//      On mount the old code read `rec.breakSecs` / `rec.breakMins * 60`. In
//      attendanceService.toggleBreak() those fields are recomputed as
//      `(doc.breaks || []).reduce((s, b) => s + (b.seconds || 0), 0)` and a
//      break session only receives `seconds` when it is CLOSED. So while a
//      break is running the persisted total still holds the value from BEFORE
//      the break started, and the currently-open `breaks[last].start` anchor
//      was never read. Returning to the page therefore restored the stale
//      pre-break total. When Stop Break was finally pressed the server closed
//      the session correctly (hence "the backend stores the correct duration")
//      while the UI showed the drifted counter - exactly the reported symptom.
//
// FIX (no duplicated component, no new API):
//   * Today's attendance record is now held in the SHARED react-query cache
//     under ['attendance-today']. The QueryClient is app-level, so the record
//     survives navigation and is available synchronously on remount.
//   * Every timer is DERIVED from absolute timestamps that already exist in
//     MongoDB (`checkInSeconds` and the `breaks[].start` / `breaks[].end`
//     session anchors) instead of being incremented. A derived clock cannot
//     drift, cannot be throttled and cannot desynchronise from the backend.
//   * `breakStartedAt` is read from the open break session, so an in-progress
//     break keeps counting from its real start instant.
//   * Mutations write the server's authoritative response straight back into
//     the cache, so Stop Break snaps to the stored duration.
// ---------------------------------------------------------------------------

// Shared cache key. Exported so any other surface can reuse the SAME cached
// record rather than issuing a second /attendance/today request.
export const ATTENDANCE_TODAY_KEY = ['attendance-today']

// Pure helper: turn a stored attendance record into the timer anchors.
// Exported for reuse/testing; it performs no I/O.
export function readTimerAnchors(rec) {
  if (!rec || !rec.checkIn) {
    return { checkedIn: false, checkInAt: null, checkOutAt: null, onBreak: false, checkInEpochMs: null, closedBreakSecs: 0, breakStartedAtMs: null, finalWorkSecs: null }
  }
  const breaks = Array.isArray(rec.breaks) ? rec.breaks : []
  // Sum only CLOSED sessions - an open session has no `seconds` yet.
  const closedFromSessions = breaks.reduce((s, b) => s + (b && b.end ? (b.seconds || 0) : 0), 0)
  // Fall back to the persisted totals for records written before `breaks[]`
  // existed (backward compatibility with pre-Phase-4 documents).
  const persistedTotal = typeof rec.breakSecs === 'number' ? rec.breakSecs : (rec.breakMins || 0) * 60
  const closedBreakSecs = breaks.length ? closedFromSessions : persistedTotal

  const openSession = [...breaks].reverse().find((b) => b && b.start && !b.end)
  let breakStartedAtMs = null
  if (openSession) {
    const t = new Date(openSession.start).getTime()
    if (!Number.isNaN(t)) breakStartedAtMs = t
  } else if (rec.onBreak && rec.breakStartedAt) {
    // Additive server field (see attendanceService.getToday / toggleBreak).
    const t = new Date(rec.breakStartedAt).getTime()
    if (!Number.isNaN(t)) breakStartedAtMs = t
  }

  return {
    checkedIn: true,
    checkInAt: rec.checkIn,
    checkOutAt: rec.checkOut || null,
    onBreak: Boolean(rec.onBreak) && !rec.checkOut,
    checkInEpochMs: rec.checkInSeconds ? rec.checkInSeconds * 1000 : (rec.checkInAt ? new Date(rec.checkInAt).getTime() : null),
    closedBreakSecs,
    breakStartedAtMs: rec.checkOut ? null : breakStartedAtMs,
    finalWorkSecs: rec.checkOut ? (rec.durationSecs || 0) : null,
  }
}

// Live check-in / check-out card with a real-time clock (date + current time
// updating every second) and running work + break timers. Check-in/out and
// every break session persist to MongoDB via the attendance API. No location /
// geolocation is requested - attendance works purely on time.
// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 1) - SINGLE SOURCE OF ATTENDANCE LOGIC
//
// ROOT CAUSE addressed here: the Manager dashboard needed a "Check In" action,
// but every piece of attendance logic (the ATTENDANCE_TODAY_KEY query, the
// check-in / check-out / break mutations, the cache patching and the dependent
// list invalidations) lived INSIDE the <CheckInCard/> render function and was
// therefore unreachable without either rendering the whole gradient card or
// re-implementing the calls - i.e. a second attendance flow.
//
// Rather than duplicating that logic, it is lifted verbatim into this hook.
// <CheckInCard/> below now consumes the hook, so the card behaves EXACTLY as
// before (same query key, same endpoints, same toasts, same cache writes), and
// any other surface can obtain the identical behaviour by calling the hook.
// There is still exactly ONE attendance flow in the codebase.
export function useAttendanceSession() {
  const qc = useQueryClient()

  // Local IANA timezone of the user's machine, sent to the backend on check-in.
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  // Phase 6.9 (TASK 1): today's record lives in the SHARED query cache, so it
  // is already present when a consumer remounts after navigation. Refetching on
  // window focus keeps the UI synchronised with the backend if the break was
  // toggled from another tab or device.
  const { data: record } = useQuery({
    queryKey: ATTENDANCE_TODAY_KEY,
    queryFn: () => attendanceApi.today(),
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    staleTime: 0,
  })

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['attendance-me'] })
    qc.invalidateQueries({ queryKey: ['attendance-calendar'] })
    qc.invalidateQueries({ queryKey: ['attendance-stats'] })
    qc.invalidateQueries({ queryKey: ['attendance-my-summary'] })
  }

  const anchors = readTimerAnchors(record)

  // Phase 6.19 (TASK 2) ROOT CAUSE FIX - "Could not update break":
  // every mutation's onSuccess below calls `patchRecord(res)`, but
  // `patchRecord` was never defined anywhere in this file. That is a plain
  // ReferenceError thrown inside onSuccess, which TanStack Query surfaces as
  // the mutation's error path - so breakMut's onError fired with a generic
  // Error (no .response.data.message), falling back to exactly the reported
  // "Could not update break" toast, even though attendanceService had already
  // persisted the break correctly server-side (confirmed separately by Stop
  // Break reporting the right elapsed time - the backend was never at fault).
  // This restores the merge this file's own comments already describe:
  // write the server's authoritative record straight into the SAME shared
  // ['attendance-today'] cache entry every consumer of this hook reads, so
  // Dashboard and Attendance immediately see the identical break state.
  const patchRecord = (patch) => {
    qc.setQueryData(ATTENDANCE_TODAY_KEY, (prev) => ({ ...(prev || {}), ...(patch || {}) }))
  }

  const checkInMut = useMutation({
    mutationFn: () => attendanceApi.checkIn({ timezone }),
    onSuccess: (res) => {
      patchRecord(res)
      toast.success(`Checked in at ${res.checkIn}`); refreshLists()
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Check-in failed'),
  })

  const checkOutMut = useMutation({
    mutationFn: () => attendanceApi.checkOut(),
    onSuccess: (res) => {
      patchRecord(res)
      toast.success(`Checked out at ${res.checkOut}`); refreshLists()
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Check-out failed'),
  })

  const breakMut = useMutation({
    mutationFn: () => attendanceApi.toggleBreak({ onBreak: !anchors.onBreak }),
    onSuccess: (res) => {
      const nowOnBreak = !anchors.onBreak
      // The service returns { onBreak, breakMins, breakSecs, breaks, breakStartedAt }.
      // Writing `breaks` back gives the derived clock its new open-session
      // anchor on start, and the closed totals on stop - no local counter.
      patchRecord(res)
      toast(nowOnBreak ? 'Break started' : 'Break ended', { icon: '\u2615' })
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Could not update break'),
  })

  return { record, timezone, anchors, checkInMut, checkOutMut, breakMut }
}

// Phase 6.14 (TASK 1): the compact header variant of the check-in control.
// It renders ONLY a button and delegates 100% of its behaviour to
// useAttendanceSession() above, which is the same hook <CheckInCard/> uses.
// Pressing it therefore hits the identical attendanceApi endpoints, writes the
// identical cache entry and fires the identical toasts as the Attendance page
// and the dashboard Check-In widget. No second attendance flow exists.
export function CheckInButton(props) {
  const { anchors, checkInMut, checkOutMut } = useAttendanceSession()
  const { checkedIn, checkOutAt } = anchors

  // Shift already closed for today - nothing left to action, so the control
  // reports state instead of offering an invalid mutation.
  if (checkedIn && checkOutAt) {
    return <Badge tone="success">Shift Complete ✓</Badge>
  }

  if (checkedIn) {
    return (
      <Button icon={FiLogOut} glow loading={checkOutMut.isPending} onClick={() => checkOutMut.mutate()} {...props}>
        Check Out
      </Button>
    )
  }

  return (
    <Button icon={FiLogIn} glow loading={checkInMut.isPending} onClick={() => checkInMut.mutate()} {...props}>
      Check In
    </Button>
  )
}

export function CheckInCard() {
  const [clock, setClock] = useState(() => new Date())
  const { timezone, anchors, checkInMut, checkOutMut, breakMut } = useAttendanceSession()

  // Single wall-clock tick. It drives BOTH the displayed time and the derived
  // work/break durations, so there is exactly one interval in this component
  // instead of the previous two (one of which mutated counters).
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const {
    checkedIn, checkInAt, checkOutAt, onBreak,
    checkInEpochMs, closedBreakSecs, breakStartedAtMs, finalWorkSecs,
  } = anchors

  const nowMs = clock.getTime()
  // Break = every closed session + the live elapsed time of the open one.
  const breakSecs = closedBreakSecs + (breakStartedAtMs ? Math.max(0, Math.floor((nowMs - breakStartedAtMs) / 1000)) : 0)
  // Work = wall time since check-in minus all break time. After check-out the
  // server's stored `durationSecs` is authoritative and the clock stops.
  const workSecs = finalWorkSecs != null
    ? finalWorkSecs
    : (checkInEpochMs ? Math.max(0, Math.floor((nowMs - checkInEpochMs) / 1000) - breakSecs) : 0)

  const dateLabel = clock.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const timeLabel = clock.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  })

  return (
    <Card className="bg-gradient-to-r from-primary to-accent text-white">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-white/20">
            <FiClock className="h-8 w-8" />
          </div>
          <div>
            {/* Live date + current time (updates every second) */}
            <p className="text-sm text-white/80">{dateLabel}</p>
            <p className="text-3xl font-bold tabular-nums">{timeLabel}</p>
            <p className="text-xs text-white/70">{timezone}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/80">
              {checkInAt && <span className="flex items-center gap-1"><FiLogIn className="h-3 w-3" />In {checkInAt}</span>}
              {checkOutAt && <span className="flex items-center gap-1"><FiLogOut className="h-3 w-3" />Out {checkOutAt}</span>}
              {checkedIn && (
                <>
                  <span className="flex items-center gap-1 tabular-nums"><FiClock className="h-3 w-3" />Worked {fmtDur(workSecs)}</span>
                  <span className="flex items-center gap-1 tabular-nums"><FiCoffee className="h-3 w-3" />Break {fmtDur(breakSecs)}</span>
                </>
              )}
              {onBreak && <Badge tone="warning" className="text-warning">On Break</Badge>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!checkedIn ? (
            <Button variant="ghost" className="bg-white text-primary" icon={FiLogIn} loading={checkInMut.isPending} onClick={() => checkInMut.mutate()}>
              Check In
            </Button>
          ) : checkOutAt ? (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
              <Badge tone="success" className="bg-white text-success">Shift Complete ✓</Badge>
            </motion.div>
          ) : (
            <>
              <Button variant="ghost" className="bg-white/20 text-white hover:bg-white/30" icon={onBreak ? FiPlay : FiCoffee} loading={breakMut.isPending} onClick={() => breakMut.mutate()}>
                {onBreak ? 'Resume' : 'Break'}
              </Button>
              <Button variant="ghost" className="bg-white text-danger" icon={FiLogOut} loading={checkOutMut.isPending} onClick={() => checkOutMut.mutate()}>
                Check Out
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
