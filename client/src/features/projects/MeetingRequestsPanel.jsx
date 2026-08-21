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
import { MeetingDateTimePicker } from '@/features/calendar/MeetingDateTimePicker'
import { formatDate } from '@/utils'

const WINDOW_MONTHS_BACK = 6
const WINDOW_MONTHS_FORWARD = 12

function windowBounds() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - WINDOW_MONTHS_BACK, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + WINDOW_MONTHS_FORWARD, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

const fmtDateTime = (v) => (v ? formatDate(v, 'DD MMM YYYY, hh:mm A') : '—')

function LeadRequestMeetingModal({ open, onClose, projectId, onSaved, holidays }) {
  const EMPTY = { title: '', start: '', location: '', description: '' }
  const [form, setForm] = useState(EMPTY)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const createMut = useMutation({
    mutationFn: () => calendarApi.create({
      title: form.title.trim(),
      start: form.start,
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

  const meetings = useMemo(() => {
    const list = Array.isArray(events) ? events : (events?.data || [])
    return list
      .filter((e) => e?.type === 'meeting' && e?.meetingStatus)
      .filter((e) => String(e.projectId || '') === String(projectId))
      .sort((a, b) => new Date(b.start) - new Date(a.start))
  }, [events, projectId])

  const refresh = () => {
    qc.invalidateQueries({ queryKey, refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['calendar'], refetchType: 'active' })
  }

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => calendarApi.updateMeetingStatus(id, status),
    onSuccess: (_r, v) => { toast.success(`Meeting ${String(v.status).toLowerCase()}`); refresh() },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not update this meeting'),
  })

  const setStatus = (m, status) => statusMut.mutate({ id: m.id || m._id, status })

  const isOwnMeeting = (m) => Boolean(m.createdBy) && (m.createdBy === user?.name || m.createdBy === user?.email)

  const requestButton = canRequestMeeting
    ? <Button icon={FiPlus} onClick={() => setRequestOpen(true)}>Request meeting</Button>
    : null

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
