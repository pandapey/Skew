// Phase 6.9 (Task 17) ROOT CAUSE FIX: meetings used to live in a disconnected
// ClientMeeting table with its own 'upcoming'/'completed' vocabulary, hidden
// from the real Calendar and from Admin/HR/Manager/Project-Lead RBAC, and the
// client had no way to actually request a meeting (staff seeded them by hand).
// Meetings are now real CalendarEvent rows (type: 'meeting', clientId set)
// with a Pending/Approved/Cancelled/Rejected lifecycle shared with the
// internal Calendar - so a client's request appears instantly for staff to
// action there, and the client sees the real, live status here.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiVideo, FiExternalLink, FiClock, FiPlus, FiMapPin, FiFileText, FiCheck, FiX, FiCalendar } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { PageHeader, Card, Badge, Loader, EmptyState, Button, Modal, Input, Select, Textarea } from '@/components/ui'
import { fmtDateTime } from './constants'
import { MEETING_STATUS_META } from '../calendar/constants'
// Phase 6.17 (TASK 3 / TASK 1) ROOT CAUSE FIX: reuses the ONE shared
// reschedule modal component (also used by features/projects/
// MeetingRequestsPanel.jsx on the staff side) instead of writing a second
// copy - see that file's Phase 6.17 note for why it was extracted.
import { MeetingRescheduleModal } from '../calendar/MeetingRescheduleModal'

function RequestMeetingModal({ open, onClose, projects }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ title: '', start: '', location: '', description: '', projectId: '' })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const requestMut = useMutation({
    mutationFn: () => clientService.requestMeeting({
      title: form.title.trim(),
      start: form.start,
      location: form.location.trim(),
      description: form.description.trim(),
      projectId: form.projectId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-meetings'] })
      toast.success('Meeting request sent')
      setForm({ title: '', start: '', location: '', description: '', projectId: '' })
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.message || err?.message || 'Could not request meeting'),
  })

  // Phase 6.15 (TASK 5C) ROOT CAUSE: "General / not project-specific" let a
  // client submit a meeting with NO projectId. CalendarEvent.projectId is the
  // ONLY thing features/projects/MeetingRequestsPanel.jsx (the "Meeting
  // Requests" tab HR/Manager/the Project Lead actually read) filters on, so a
  // project-less request could never appear in that shared conversation for
  // ANY staff role - it only ever reached a one-time notification, never a
  // conversation thread either party could revisit. Requiring a project
  // whenever the client has one anchors every request to the SAME shared,
  // RBAC-scoped view every party already reads (no new module, model or
  // endpoint). Clients with zero projects still fall through to the existing
  // all-Admin/Manager/HR notification branch in
  // clientController.createMeetingRequest, and the picker itself is already
  // only rendered `{projects.length > 0 && ...}` below, so this never blocks
  // a project-less client from requesting a meeting.
  const submit = (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.start) { toast.error('Title and date/time are required'); return }
    if (projects.length > 0 && !form.projectId) { toast.error('Please select a project for this meeting'); return }
    requestMut.mutate()
  }

  const projectOptions = projects.map((p) => ({ value: p.projectId || p.id, label: p.name || p.projectId || p.id }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a meeting"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={requestMut.isPending}>Send request</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <Input label="Meeting title" value={form.title} onChange={set('title')} required />
        <Input label="Date & time" type="datetime-local" value={form.start} onChange={set('start')} required />
        {projects.length > 0 && (
          <Select label="Project" value={form.projectId} onChange={set('projectId')} options={projectOptions} placeholder="Select a project\u2026" required />
        )}
        <Input label="Location or link (optional)" value={form.location} onChange={set('location')} icon={FiMapPin} />
        <Textarea label="Agenda / notes (optional)" value={form.description} onChange={set('description')} />
      </form>
    </Modal>
  )
}

export default function ClientMeetings() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [requestOpen, setRequestOpen] = useState(false)
  const [rescheduling, setRescheduling] = useState(null)
  const { data: meetings = [], isLoading } = useQuery({ queryKey: ['client-meetings'], queryFn: () => clientService.getMeetings(user) })
  const { data: projects = [] } = useQuery({ queryKey: ['client-projects'], queryFn: () => clientService.getProjects(user) })

  // Phase 6.17 (TASK 3) ROOT CAUSE FIX: this refresh + the mutation below are
  // the Client-side mirror of MeetingRequestsPanel.jsx's `refresh`/`statusMut`
  // on the staff side - same ['client-meetings'] key this page already reads,
  // and the SAME realtime sync (useRealtimeSync.jsx) also busts this cache on
  // any 'calendar' socket event from the other side, so no manual refresh is
  // ever required either.
  const refresh = () => qc.invalidateQueries({ queryKey: ['client-meetings'], refetchType: 'active' })

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => clientService.respondToMeeting(id, status),
    onSuccess: (_r, v) => { toast.success(`Meeting ${String(v.status).toLowerCase()}`); refresh() },
    onError: (err) => toast.error(err?.response?.data?.message || err?.message || 'Could not update this meeting'),
  })

  const setStatus = (m, status) => statusMut.mutate({ id: m.id || m._id, status })

  if (isLoading) return <Loader label="Loading meetings…" />

  const requestButton = <Button icon={FiPlus} onClick={() => setRequestOpen(true)}>Request meeting</Button>

  return (
    <div>
      <PageHeader title="Meetings" subtitle="Request a meeting and track its status." actions={requestButton} />
      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          description="Request a meeting with your account manager and it will show up here once scheduled."
          action={requestButton}
        />
      ) : (
        <div className="space-y-4">
          {meetings.map((m) => {
            const meta = MEETING_STATUS_META[m.meetingStatus] || MEETING_STATUS_META.Pending
            return (
              <Card key={m.id || m._id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary"><FiVideo className="h-5 w-5" /></span>
                    <div>
                      <p className="font-semibold">{m.title}</p>
                      <p className="flex items-center gap-1 text-xs text-muted"><FiClock /> {fmtDateTime(m.start)}</p>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  {m.description && (
                    <div>
                      <p className="flex items-center gap-1 text-muted"><FiFileText /> Agenda / notes</p>
                      <p>{m.description}</p>
                    </div>
                  )}
                  {m.location && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button variant="ghost" icon={FiExternalLink} onClick={() => window.open(m.location, '_blank')}>Join / view location</Button>
                      <span className="truncate text-xs text-muted">{m.location}</span>
                    </div>
                  )}
                </div>
                {/* Phase 6.17 (TASK 3) ROOT CAUSE FIX: Accept/Reject/Reschedule only
                    ever existed on the staff side (features/projects/
                    MeetingRequestsPanel.jsx). A meeting STAFF requested
                    (m.requestedBy === 'staff') is a request TO the client, so
                    these actions belong here instead - never shown for a
                    meeting the client itself raised, mirroring isOwnMeeting()
                    on the staff panel. The server (assertClientCanRespond)
                    enforces this independently of what the UI shows. */}
                {m.requestedBy === 'staff' && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-app pt-3">
                    {m.meetingStatus === 'Pending' && (
                      <>
                        <Button icon={FiCheck} disabled={statusMut.isPending} onClick={() => setStatus(m, 'Approved')}>Accept</Button>
                        <Button variant="ghost" icon={FiX} disabled={statusMut.isPending} onClick={() => setStatus(m, 'Rejected')}>Reject</Button>
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
      <RequestMeetingModal open={requestOpen} onClose={() => setRequestOpen(false)} projects={projects} />
      {rescheduling && (
        <MeetingRescheduleModal
          meeting={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={refresh}
          submitFn={(id, start) => clientService.rescheduleMeeting(id, start)}
          successMessage="Meeting rescheduled — the team has been notified"
        />
      )}
    </div>
  )
}
