// =============================================================================
// Phase 6.12 (TASK 2) — PROJECT LEAD MEETING REQUESTS
//
// WHY THIS FILE EXISTS (and why it is not a second meeting module):
//   The meeting system is already complete and lives in ONE place -
//   CalendarEvent documents with `type: 'meeting'`, a `clientId`, a `projectId`
//   and a Pending/Approved/Rejected/Cancelled `meetingStatus`. The client
//   portal writes them (POST /client/meetings) and reads them
//   (features/client/ClientMeetings.jsx); staff read and action them from the
//   internal Calendar. What did NOT exist was a view of that data scoped to a
//   SINGLE project, on the project page, for the person who actually runs the
//   engagement - the Project Lead.
//
//   So this file adds no model, no collection, no endpoint and no state of its
//   own. It is a project-scoped VIEW over the existing calendar API:
//     • calendarApi.range         — existing, already RBAC-scoped server-side
//     • calendarApi.create        — existing
//     • calendarApi.updateMeetingStatus — existing (Accept / Reject)
//     • calendarApi.reschedule    — Phase 6.12 narrow start/end action
//     • MEETING_STATUS_META       — existing calendar presentation constants
//   The request form deliberately mirrors RequestMeetingModal in
//   features/client/ClientMeetings.jsx field for field, so a lead-created
//   request and a client-created request are the same kind of record.
//
// RBAC:
//   This panel is only MOUNTED for the project lead (see ProjectDetail.jsx),
//   but that is a UX affordance, never the boundary. The server decides:
//     • GET /calendar/range applies meetingVisibilityFilter(), so a user only
//       ever receives meetings for projects they can access.
//     • PATCH /calendar/:id/meeting-status and /:id/reschedule both call
//       assertCanManageMeeting(), which allows Admin/Manager/HR or the lead of
//       the meeting's project and 403s everyone else.
//   Nothing here can widen either rule.
//
// REALTIME:
//   Status and reschedule writes emit `calendar:meeting-status` to the client
//   portal from the existing controller. On this side the mutations invalidate
//   the shared ['calendar-meetings', projectId] key, and the app's existing
//   realtime sync already busts calendar queries, so both portals converge
//   without any new socket plumbing.
// =============================================================================
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiVideo, FiClock, FiPlus, FiMapPin, FiFileText, FiCheck, FiX, FiCalendar, FiExternalLink,
} from 'react-icons/fi'
import { calendarApi, leaveApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import {
  Card, Badge, Loader, EmptyState, Button, Modal, Input, Textarea,
} from '@/components/ui'
import { MEETING_STATUS_META } from '@/features/calendar/constants'
import { MeetingRescheduleModal } from '@/features/calendar/MeetingRescheduleModal'
// Phase 6.21 (TASK 2): the ONE shared meeting date/time field (calendar +
// explicit OK). It composes the existing GlassCalendar rather than adding a
// second picker - see that file's header.
import { MeetingDateTimePicker } from '@/features/calendar/MeetingDateTimePicker'
import { formatDate } from '@/utils'

// Meetings are scheduled well ahead and reviewed well after, so the panel pulls
// a generous window rather than paginating - the same approach the calendar
// itself takes. Kept as a constant so the two bounds cannot drift apart.
const WINDOW_MONTHS_BACK = 6
const WINDOW_MONTHS_FORWARD = 12

function windowBounds() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - WINDOW_MONTHS_BACK, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + WINDOW_MONTHS_FORWARD, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

const fmtDateTime = (v) => (v ? formatDate(v, 'DD MMM YYYY, hh:mm A') : '—')

// --- Create a meeting request, as the lead -----------------------------------
// Same fields and the same CalendarEvent shape the client portal submits; the
// only differences are the ones the server needs to attribute the record to
// this project and client.
// Phase 6.14 (TASK 6) ROOT CAUSE - "Path is required":
//   The message was Mongoose's DEFAULT ValidatorError text, surfaced verbatim
//   from the API. CalendarEvent declares `end: { type: Date, required: true }`
//   (server/src/models/calendarModels.js) with no custom message, so a failed
//   cast/absence produces exactly "Path `end` is required.".
//
//   This modal posted title / start / location / description / type /
//   meetingStatus / projectId / clientId - and NEVER an `end`. So every single
//   submission failed schema validation at the model layer, 100% of the time.
//   It was not a form-layout problem and not a partially-hidden control: the
//   payload was structurally invalid. (The client portal's equivalent handler
//   never hit this because it derives `end` server-side.)
//
//   Two things are therefore fixed, both at the cause:
//     1. The form now captures a real End date & time, auto-filled to
//        start + MEETING_DEFAULT_DURATION_MINUTES the moment a start is picked,
//        so the required field is always populated and the lead can still
//        override the duration.
//     2. Client-side validation now checks `end` too, and that it is after
//        `start`, so an invalid range is reported in the user's own language
//        instead of being bounced back as a raw Mongoose path error.
//
//   `clientId` is also dropped from the payload. Project has NO clientId field
//   (server/src/models/projectModels.js links to a client by company NAME via
//   `client`), so `project?.clientId` was permanently undefined - a dead
//   property that silently produced client-less meetings. The server now
//   resolves the real owning client itself (see calendarController), which is
//   the authoritative place for it and is what TASK 7 depends on.
//
// Phase 6.21 (TASK 2) - the End field is REMOVED from this form.
//   The 6.14 note below explains why an `end` had to exist at all: the model
//   declares `end: { type: Date, required: true }`. That constraint has NOT
//   been relaxed - removing a required DB field to satisfy a UI request would
//   be the wrong layer to change. Instead the derivation moved DOWN to the
//   server (calendarController.create), which now fills a missing meeting
//   `end` from the SAME default-duration mechanism the client portal's
//   createMeetingRequest already uses. So the contract is unchanged, the lead
//   is no longer asked for a value they never really chose, and a request that
//   arrives without an `end` from ANY caller is completed rather than rejected.
function LeadRequestMeetingModal({ open, onClose, projectId, onSaved, holidays }) {
  const EMPTY = { title: '', start: '', location: '', description: '' }
  const [form, setForm] = useState(EMPTY)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const createMut = useMutation({
    mutationFn: () => calendarApi.create({
      title: form.title.trim(),
      start: form.start,
      // No `end`: derived server-side from MEETING_DEFAULT_DURATION_MINUTES.
      allDay: false,
      location: form.location.trim(),
      description: form.description.trim(),
      type: 'meeting',
      meetingStatus: 'Pending',
      projectId,
    }),
    onSuccess: () => {
      toast.success('Meeting request sent')
      setForm(EMPTY)
      onSaved()
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.message || err?.message || 'Could not request meeting'),
  })

  const submit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Meeting title is required'); return }
    if (!form.start) { toast.error('Meeting date & time is required'); return }
    createMut.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a meeting"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={createMut.isPending}>Send request</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Input label="Meeting title" value={form.title} onChange={set('title')} required />
        {/* One date/time field, committed only on OK. The Sunday / company
            holiday rules are the SAME ones the server enforces. */}
        <MeetingDateTimePicker
          label="Meeting date & time"
          value={form.start}
          onChange={(next) => setForm((f) => ({ ...f, start: next }))}
          holidays={holidays}
          required
        />
        <Input label="Location or link (optional)" value={form.location} onChange={set('location')} icon={FiMapPin} />
        <Textarea label="Agenda / notes (optional)" value={form.description} onChange={set('description')} />
      </form>
    </Modal>
  )
}

// Phase 6.17 (TASK 1 / TASK 7) CLEANUP: the inline RescheduleModal that used
// to be defined here is now the ONE shared MeetingRescheduleModal component
// (features/calendar/MeetingRescheduleModal.jsx), reused by both this panel
// and the Client Portal's new Reschedule action - removing this duplicate
// definition per the NON-NEGOTIABLE "Do NOT duplicate Components" rule.

// Phase 6.21 (TASK 2): `canRequestMeeting` is supplied by ProjectDetail from
// the SAME `isLead` / `canWrite` facts it already computes for the rest of the
// page - no new permission concept, and no second source of truth. It only
// hides an action the server would refuse anyway (see calendarController).
export function MeetingRequestsPanel({ projectId, project, canRequestMeeting = true }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [requestOpen, setRequestOpen] = useState(false)
  const [rescheduling, setRescheduling] = useState(null)
  const bounds = useMemo(() => windowBounds(), [])

  const queryKey = ['calendar-meetings', projectId]

  const { data: events = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => calendarApi.range(bounds.from, bounds.to),
    enabled: !!projectId,
  })

  // Narrow the RBAC-scoped calendar feed down to THIS project's meeting
  // requests. Filtering client-side is safe because the server has already
  // removed everything this user may not see.
  const meetings = useMemo(() => {
    const list = Array.isArray(events) ? events : (events?.data || [])
    return list
      .filter((e) => e?.type === 'meeting' && e?.meetingStatus)
      .filter((e) => String(e.projectId || '') === String(projectId))
      .sort((a, b) => new Date(b.start) - new Date(a.start))
  }, [events, projectId])

  const refresh = () => {
    qc.invalidateQueries({ queryKey, refetchType: 'active' })
    // The main Calendar renders the same CalendarEvent rows.
    qc.invalidateQueries({ queryKey: ['calendar'], refetchType: 'active' })
  }

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => calendarApi.updateMeetingStatus(id, status),
    onSuccess: (_r, v) => { toast.success(`Meeting ${String(v.status).toLowerCase()}`); refresh() },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not update this meeting'),
  })

  const setStatus = (m, status) => statusMut.mutate({ id: m.id || m._id, status })

  // Phase 6.15 (TASK 5B) ROOT CAUSE: Accept/Reject/Reschedule were rendered
  // for ANY writer/lead viewing this panel regardless of who raised the
  // request, so a staff member who requested their own meeting still saw
  // action buttons that only make sense for the recipient (the other party).
  // This reuses the SAME `createdBy` field the server now stamps on every
  // calendar write (see calendarController.create) - no new field.
  const isOwnMeeting = (m) => Boolean(m.createdBy) && (m.createdBy === user?.name || m.createdBy === user?.email)

  // Only the project lead (and full-access roles) may raise a request, so a
  // normal member simply never sees the control - matching how every other
  // write action on this page is hidden rather than shown-and-disabled.
  const requestButton = canRequestMeeting
    ? <Button icon={FiPlus} onClick={() => setRequestOpen(true)}>Request meeting</Button>
    : null

  // Reuses the existing holiday endpoint (and its existing cache key) rather
  // than adding a meeting-specific one. Only fetched when the form can open.
  const { data: holidayData } = useQuery({
    queryKey: ['leave-holidays'],
    queryFn: () => leaveApi.holidays(),
    enabled: canRequestMeeting,
    staleTime: 5 * 60 * 1000,
  })
  const holidays = useMemo(() => {
    const list = Array.isArray(holidayData) ? holidayData : (holidayData?.data || [])
    return Array.isArray(list) ? list : []
  }, [holidayData])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Meeting requests for this project — yours and the client&apos;s.
        </p>
        {requestButton}
      </div>

      {isLoading ? <Loader label="Loading meeting requests…" /> : meetings.length === 0 ? (
        <EmptyState
          title="No meeting requests yet"
          description="Request a meeting with the client and it will appear here, along with anything they request."
          action={requestButton}
        />
      ) : (
        <div className="space-y-4">
          {meetings.map((m) => {
            const meta = MEETING_STATUS_META[m.meetingStatus] || MEETING_STATUS_META.Pending
            const pending = m.meetingStatus === 'Pending'
            const busy = statusMut.isPending
            return (
              <Card key={m.id || m._id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FiVideo className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{m.title}</p>
                      <p className="flex items-center gap-1 text-xs text-muted"><FiClock /> {fmtDateTime(m.start)}</p>
                      {m.createdBy && <p className="text-xs text-muted">Requested by {m.createdBy}</p>}
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>

                {m.description && (
                  <div className="text-sm">
                    <p className="flex items-center gap-1 text-muted"><FiFileText /> Agenda / notes</p>
                    <p>{m.description}</p>
                  </div>
                )}

                {m.location && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="ghost" icon={FiExternalLink} onClick={() => window.open(m.location, '_blank')}>Join / view location</Button>
                    <span className="truncate text-xs text-muted">{m.location}</span>
                  </div>
                )}

                {/* Accept / Reject are only meaningful while the request is
                    still open; Reschedule stays available so a confirmed
                    meeting can still be moved. The server re-checks both.
                    Phase 6.15 (TASK 5B): none of the three are shown to the
                    person who raised the request - see isOwnMeeting above.
                    Phase 6.19 (TASK 5) ROOT CAUSE FIX: isOwnMeeting alone only
                    ever hid these buttons from the ONE staff member who
                    happened to create the request - every OTHER staff viewer
                    (e.g. Admin/Manager looking at a request HR raised) still
                    saw Accept/Reject/Reschedule for a meeting that was
                    actually requested FROM staff TO the client, even though
                    the server's assertCanManageMeeting already 403s that case
                    for every staff caller regardless of role or authorship
                    (see calendarController.js). The UI now also checks the
                    SAME `requestedBy` field the server rule reads, so no
                    staff member is ever shown an action the server will
                    reject - the existing visibility rule is extended to match
                    the existing authorization rule, not a new rule. */}
                {(m.requestedBy === 'staff' || isOwnMeeting(m)) ? (
                  <p className="mt-3 border-t border-app pt-3 text-xs text-muted">
                    Awaiting a response from the other party.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-app pt-3">
                    {pending && (
                      <>
                        <Button icon={FiCheck} disabled={busy} onClick={() => setStatus(m, 'Approved')}>Accept</Button>
                        <Button variant="ghost" icon={FiX} disabled={busy} onClick={() => setStatus(m, 'Rejected')}>Reject</Button>
                      </>
                    )}
                    <Button variant="ghost" icon={FiCalendar} onClick={() => setRescheduling(m)}>Reschedule</Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Not merely hidden: a non-lead cannot even mount the form. The
          server refuses the POST regardless (calendarController.create). */}
      {canRequestMeeting && (
        <LeadRequestMeetingModal
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          projectId={projectId}
          onSaved={refresh}
          holidays={holidays}
        />
      )}
      {rescheduling && (
        <MeetingRescheduleModal
          meeting={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={refresh}
          submitFn={(id, start) => calendarApi.reschedule(id, { start })}
          successMessage="Meeting rescheduled — the client has been notified"
        />
      )}
    </div>
  )
}
