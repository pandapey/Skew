// Calendar controller — CRUD over CalendarEvent plus a range-scoped list that
// returns every master event overlapping a [from, to] window (used by the
// client to seed its recurrence expansion).
import { CalendarEvent } from '../models/calendarModels.js'
import { crudController } from './crudController.js'
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'
// Phase 6.9 (Task 17): client-meeting approval workflow additions.
import { Project } from '../models/projectModels.js'
import { ClientNotification, ClientProject, Client } from '../models/clientModels.js'
import { PROJECT_FULL_ACCESS, accessibleProjectFilter, isProjectLead } from '../services/projectService.js'
import { emitToClient } from '../realtime/index.js'
import { ApiError } from '../utils/asyncHandler.js'
// Phase 6.17 (TASK 3): reused to notify STAFF when the CLIENT responds to a
// staff-raised meeting request - the SAME notification service every other
// meeting-related notification in this codebase already goes through (see
// clientController.createMeetingRequest, which this replaces the inline copy
// of), and the SAME User model used to resolve the Admin/Manager/HR fallback
// recipient list.
import { User } from '../models/User.js'
import { notifyUsersByName, notifyUsersByEmail } from '../services/notificationService.js'
// Phase 6.21 (TASK 2): the shared meeting slot rules, lifted out of
// clientController so the internal (Project Lead) create path enforces the
// SAME Sunday / Company-Holiday restriction, and the SAME default duration.
import { meetingDateRejection, deriveMeetingEnd } from '../services/meetingRules.js'

const base = crudController(CalendarEvent)

// ---------------------------------------------------------------------------
// Phase 6.21 (TASK 2) - WHY AN EMPLOYEE PROJECT LEAD COULD NOT REQUEST A
// MEETING, AND WHY A PLAIN MEMBER COULD HAVE.
// ---------------------------------------------------------------------------
// ROOT CAUSE (traced UI -> route -> controller):
//   * routes/calendarRoutes.js gated `POST /calendar` with
//     `canWrite = authorize('Admin','HR','Manager')`. An Employee - INCLUDING
//     the project's own lead - was rejected with 403 before the controller was
//     ever reached. So "Request meeting" was a dead button for every lead.
//   * Meanwhile MeetingRequestsPanel rendered that button for anyone who could
//     see the tab. Once the route was opened up, a plain member would have
//     been able to POST directly, because `create` did no per-project check at
//     all - it spread req.body straight into CalendarEvent.create.
//
// FIX: keep ONE meeting API and move the decision into the controller, which
// is the only layer that can see WHICH project is being booked. This mirrors
// the existing precedent for /:id/meeting-status and /:id/reschedule, which
// are likewise ungated at the route and self-authorize here with a rule that
// is NARROWER than canWrite, never wider.
//
// The rule:
//   Admin / Manager / HR (PROJECT_FULL_ACCESS)  -> unchanged, full access.
//   Anyone else (i.e. Employee)                 -> may create ONLY a meeting
//     request, ONLY for a project they are the LEAD of.
//
// Lead-ship is resolved from the PROJECT DOCUMENT loaded from the database by
// the posted projectId, compared against `req.user` from the verified JWT via
// the existing isProjectLead() in services/projectService.js. No user/lead
// identifier from the request body participates in the decision, so a
// client-supplied projectId can only ever select WHICH project is checked -
// it can never satisfy the check.
const assertCanCreate = async (req) => {
  const user = req.user
  if (PROJECT_FULL_ACCESS.includes(user?.role)) return

  const body = req.body || {}
  const isMeetingRequest = body.type === 'meeting' && Boolean(body.meetingStatus)
  if (!isMeetingRequest) {
    throw new ApiError(403, 'You do not have permission to create calendar events.')
  }

  const projectId = body.projectId
  if (!projectId) throw new ApiError(400, 'A project is required for a meeting request.')

  const project = await Project.findById(projectId).select('lead').lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (!isProjectLead(project, user)) {
    throw new ApiError(403, 'Only the project lead can request a meeting for this project.')
  }
}

// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 7) - WHY THE CLIENT WAS NEVER NOTIFIED
// ---------------------------------------------------------------------------
// SYMPTOM: rescheduling a meeting as a Manager appeared to "notify the Manager
// instead of the Client".
//
// ACTUAL ROOT CAUSE (traced payload -> model -> controller -> socket):
//   1. Both updateMeetingStatus() and rescheduleMeeting() wrap the ENTIRE
//      client-notification step in `if (doc.clientId)`. That is the correct
//      recipient rule - the bug is that the condition was almost always false.
//   2. CalendarEvent.clientId is only ever populated by
//      clientController.createMeetingRequest(), i.e. requests raised from the
//      CLIENT portal, which knows its own clientId from the session.
//   3. Meeting requests raised from the internal side
//      (features/projects/MeetingRequestsPanel.jsx) sent
//      `clientId: project?.clientId`. Project has NO clientId field at all -
//      server/src/models/projectModels.js links a project to a client by
//      COMPANY NAME through the `client` string. So that property was
//      permanently `undefined` and the event was stored with clientId null.
//   4. With clientId null the guarded block never ran: no emitToClient, no
//      ClientNotification. NOTHING was dispatched to the client.
//   5. What the Manager actually saw was the generic realtime broadcast. The
//      /calendar router is wrapped by withEmit() (server/src/realtime/
//      emitMiddleware.js), which emits `resource:changed` to all internal users
//      after any successful write. That is a cache-invalidation signal, not a
//      notification - but with the real client notification silently skipped it
//      was the only thing anyone observed, which is why the notification looked
//      like it "went back to the Manager".
//
// THE FIX IS RECIPIENT SELECTION ONLY. No new notification pipeline, no new
// socket event, no new collection: the existing emitToClient channel and the
// existing ClientNotification model are still what deliver the message. All
// this routine does is answer "which client owns this meeting?" when the stored
// clientId is missing, using links that already exist:
//   a. ClientProject.sourceProjectId -> the portal row mirroring the real
//      Project, which carries the authoritative clientId.
//   b. Project.client (company name) -> Client.company, the same case-
//      insensitive company match services/scopeService.js already relies on.
// The resolved id is written back onto the event so the lookup happens once and
// every later action on that meeting takes the cheap `doc.clientId` path.
export async function resolveMeetingClientId(doc) {
  if (!doc) return null
  if (doc.clientId) return doc.clientId
  if (!doc.projectId) return null

  // (a) Portal mirror row - the most direct and reliable link.
  const mirrored = await ClientProject.findOne({ sourceProjectId: doc.projectId }).select('clientId').lean()
  let clientId = mirrored?.clientId || null

  // (b) Fall back to the company-name link carried on the Project itself.
  if (!clientId) {
    const project = await Project.findById(doc.projectId).select('client').lean()
    const company = String(project?.client || '').trim()
    if (company) {
      const client = await Client.findOne({
        company: { $regex: new RegExp(`^${escapeRegex(company)}$`, 'i') },
      }).select('clientId').lean()
      clientId = client?.clientId || null
    }
  }

  // Backfill so this resolution is a one-off, and so the meeting becomes
  // visible in the client portal (GET /client/meetings filters on clientId).
  if (clientId && doc.clientId !== clientId) {
    doc.clientId = clientId
    await doc.save()
  }
  return clientId
}

// Phase 6.14 (TASK 7): one dispatch routine shared by the status and reschedule
// actions, so the recipient rule cannot drift between them again. It reuses the
// SAME socket event ('calendar:meeting-status') and the SAME ClientNotification
// model both paths already used - the realtime contract the client portal
// listens on is unchanged.
async function notifyClientOfMeeting(doc, { title, body }) {
  const clientId = await resolveMeetingClientId(doc)
  if (!clientId) return false
  emitToClient(clientId, 'calendar:meeting-status', { id: doc.id, status: doc.meetingStatus })
  await ClientNotification.create({ clientId, title, body, link: '/client/meetings' })
  return true
}

// Phase 6.17 (TASK 3): the STAFF-facing mirror of notifyClientOfMeeting above,
// factored out of clientController.createMeetingRequest (which had this exact
// recipient-selection logic inline, with no other caller) so the new Client
// response actions (respondToMeeting / rescheduleMeetingAsClient) can reuse
// the SAME rule instead of a second copy: notify the resolved project's
// lead/team by name, or every Admin/Manager/HR user by email when no project
// is attached. Uses the SAME notificationService helpers (notifyUsersByName /
// notifyUsersByEmail) every other staff notification in this app goes
// through - no new notification pipeline.
export async function notifyStaffOfMeeting(doc, { title, body }) {
  let project = null
  if (doc.projectId) {
    project = await Project.findById(doc.projectId).lean()
  }
  if (project?.lead || project?.team?.length) {
    const names = [project.lead, ...(project.team || [])].filter(Boolean)
    await notifyUsersByName(names, { type: 'meeting', title, body, link: '/calendar' })
  } else {
    const staff = await User.find({ role: { $in: PROJECT_FULL_ACCESS } }).select('email').lean()
    await notifyUsersByEmail(staff.map((u) => u.email).filter(Boolean), { type: 'meeting', title, body, link: '/calendar' })
  }
}


export const MEETING_STATUSES = ['Pending', 'Approved', 'Cancelled', 'Rejected']

// Phase 6.9 (Task 17) ROOT CAUSE FIX: the calendar previously had NO RBAC
// scoping at all - `list`/`range` returned every event in the collection to
// every authenticated user. That was invisible before because ordinary
// events had no client/owner concept; now that client-meeting requests live
// in the SAME collection (clientId set), an Employee could otherwise see
// every client's meetings. This filter is additive and mirrors the server's
// own project-access rules:
//   - Admin/Manager/HR (PROJECT_FULL_ACCESS): see everything (unchanged).
//   - Client role: only meetings tied to their own clientId.
//   - Employee: their own events (attendee/creator) plus meetings tied to a
//     project they can access (lead/member/task-assignee), so an ordinary
//     Employee's view of non-client events is completely unchanged.
export async function meetingVisibilityFilter(user) {
  if (!user) return null
  if (PROJECT_FULL_ACCESS.includes(user.role)) return null
  if (user.role === 'Client') {
    return { clientId: user.clientId || '__none__' }
  }
  const projectFilter = await accessibleProjectFilter(user)
  const accessibleProjectIds = await Project.find(projectFilter).distinct('_id')
  return {
    $or: [
      { clientId: null },
      { attendees: user.name || '__none__' },
      { createdBy: user.name || user.email || '__none__' },
      { projectId: { $in: accessibleProjectIds } },
    ],
  }
}

function withMeetingScope(filter, scope) {
  if (!scope) return filter
  const clauses = [filter, scope].filter((f) => f && Object.keys(f).length)
  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { $and: clauses }
}

// Phase 6.12 (TASK 2): the ONE meeting-management authorization rule, extracted
// from updateMeetingStatus below so the reschedule action can enforce exactly
// the same decision instead of restating it. Extraction, not a new rule - the
// body is the code that already guarded status changes.
//
// Authorized: Admin/Manager/HR (PROJECT_FULL_ACCESS), or the Employee who leads
// the project the meeting is attached to. Everyone else gets 403. Because it is
// project-lead-scoped rather than role-scoped, this is NARROWER than the
// `canWrite` role gate used by the generic calendar writes - it grants an
// ordinary Employee nothing on any project they do not lead.
export async function assertCanManageMeeting(doc, user) {
  if (doc.type !== 'meeting' || !doc.meetingStatus) {
    throw new ApiError(400, 'This event is not a client meeting request')
  }
  // Phase 6.17 (TASK 3) ROOT CAUSE FIX: a meeting STAFF raised is a request TO
  // the Client - those actions belong ONLY to the Client (see
  // assertClientCanRespond below), so no staff member may act on it here at
  // all, regardless of role/lead-ship. Legacy rows (requestedBy null, created
  // before this phase) are untouched and keep exactly their prior staff-only
  // behaviour, so this only closes off NEW staff-initiated requests.
  if (doc.requestedBy === 'staff') {
    throw new ApiError(403, 'This meeting was requested from the client; only the client can respond')
  }
  // Phase 6.15 (TASK 5B) ROOT CAUSE: this only ever checked role/lead-ship, so
  // whoever raised the request (e.g. HR) could still Accept/Reject/Reschedule
  // their own meeting server-side even after the UI hid those actions from
  // them, because the UI hide alone is not an authorization boundary. The
  // requester is now excluded here too, using the SAME createdBy field
  // calendarController.create stamps on every write - this is the real
  // authorization check; CalendarApp.jsx / MeetingRequestsPanel.jsx only
  // mirror it for display.
  const requester = doc.createdBy
  const isRequester = Boolean(requester) && (requester === user?.name || requester === user?.email)
  if (isRequester) {
    throw new ApiError(403, 'You cannot act on your own meeting request')
  }
  const isPrivileged = PROJECT_FULL_ACCESS.includes(user?.role)
  let isLead = false
  if (!isPrivileged && doc.projectId) {
    const project = await Project.findById(doc.projectId).lean()
    isLead = isProjectLead(project, user)
  }
  if (!isPrivileged && !isLead) {
    throw new ApiError(403, 'You are not authorized to update this meeting')
  }
}

// Phase 6.17 (TASK 3): the Client-side mirror of assertCanManageMeeting above.
// Only a meeting STAFF raised (requestedBy === 'staff') is a request the
// Client may respond to, and only the client it belongs to may respond -
// symmetric with, and just as strict as, the staff-side rule.
export function assertClientCanRespond(doc, clientId) {
  if (doc.type !== 'meeting' || !doc.meetingStatus) {
    throw new ApiError(400, 'This event is not a meeting request')
  }
  if (doc.requestedBy !== 'staff') {
    throw new ApiError(403, 'You can only respond to a meeting requested by your account manager')
  }
  if (!doc.clientId || String(doc.clientId) !== String(clientId)) {
    throw new ApiError(403, 'You are not authorized to update this meeting')
  }
}

export const calendarController = {
  ...base,

  // Phase 6.15 (TASK 5A/5B) ROOT CAUSE: creating a meeting through this route
  // (used by the internal "Request meeting" action in
  // features/projects/MeetingRequestsPanel.jsx, i.e. the Meeting Requests tab
  // HR/Manager/the Project Lead use) went through the generic
  // crudController.create untouched - it only inserted the document. Every
  // OTHER meeting mutation (updateMeetingStatus, rescheduleMeeting) already
  // calls notifyClientOfMeeting; creation was the one path that never did,
  // which is the actual root cause of "the Client is not notified when HR
  // creates a meeting request" (TASK 5A). Separately, the same generic create
  // never recorded who made the write, so CalendarEvent.createdBy was always
  // null for staff-created meetings - the missing data the ownership check in
  // CalendarApp.jsx / MeetingRequestsPanel.jsx (TASK 5B) needs to tell a
  // requester apart from a recipient.
  //
  // Both fixes reuse existing pieces only: the SAME resolveMeetingClientId +
  // notifyClientOfMeeting helpers already used by updateMeetingStatus/
  // rescheduleMeeting (same emitToClient socket event, same
  // ClientNotification model - no second notification pipeline), and the
  // SAME req.user identity every other controller in this codebase already
  // stamps onto records it creates. Non-meeting calendar events (tasks,
  // personal events, etc.) simply gain a createdBy value where they had none
  // before; nothing reads that field on those event types today.
  create: async (req, res) => {
    // Phase 6.21 (TASK 2): self-authorization. See assertCanCreate above.
    await assertCanCreate(req)

    const isMeetingRequest = req.body?.type === 'meeting' && Boolean(req.body?.meetingStatus)

    if (isMeetingRequest) {
      // Same rule, same wording, as the client portal's request path.
      const rejection = await meetingDateRejection(req.body?.start)
      if (rejection) throw new ApiError(400, rejection)
    }

    const doc = await CalendarEvent.create({
      ...req.body,
      // Phase 6.21 (TASK 2): CalendarEvent.end is `required: true`. The Request
      // Meeting form no longer asks for it, so it is completed here from the
      // existing default-duration mechanism instead of the model constraint
      // being loosened. Non-meeting events are untouched.
      end: req.body?.end || (isMeetingRequest ? deriveMeetingEnd(req.body?.start) : req.body?.end),
      createdBy: req.body?.createdBy || req.user?.name || req.user?.email || null,
      // Phase 6.17 (TASK 3): every meeting created through this staff-only
      // route is, by definition, requested FROM the client - stamped
      // unconditionally (not read from req.body) so this cannot be spoofed by
      // the client the way a body field could be.
      requestedBy: req.body?.type === 'meeting' && req.body?.meetingStatus ? 'staff' : undefined,
    })

    if (doc.type === 'meeting' && doc.meetingStatus) {
      await notifyClientOfMeeting(doc, {
        title: 'New meeting request',
        body: `${doc.createdBy || 'Your account manager'} requested a meeting: "${doc.title}".`,
      })
    }

    res.status(201).json(doc)
  },

  // List / search, ordered by start time (title-aware search).
  list: async (req, res) => {
    const { page = 1, limit = 200, search } = req.query
    const filter = search ? { title: { $regex: escapeRegex(search), $options: 'i' } } : {}
    const scope = await meetingVisibilityFilter(req.user)
    const docs = await CalendarEvent.find(withMeetingScope(filter, scope))
      .sort({ start: 1 })
      .skip((clampPage(page) - 1) * clampLimit(limit, 200))
      .limit(clampLimit(limit, 200))
    res.json(docs)
  },

  // Events whose span overlaps [from, to].
  range: async (req, res) => {
    const { from, to } = req.query
    const filter = {}
    if (from) filter.end = { $gte: new Date(from) }
    if (to) filter.start = { $lte: new Date(to) }
    const scope = await meetingVisibilityFilter(req.user)
    const docs = await CalendarEvent.find(withMeetingScope(filter, scope)).sort({ start: 1 })
    res.json(docs)
  },

  // Toggle completion for task-type events.
  toggleDone: async (req, res) => {
    const doc = await CalendarEvent.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Event not found' })
    doc.done = !doc.done
    await doc.save()
    res.json(doc)
  },

  // Phase 6.9 (Task 17): Approve / Reject / Cancel a client meeting request.
  // Authorized for Admin/Manager/HR, or the Employee who leads the related
  // project - the SAME rule the client uses to decide whether to show the
  // action buttons at all (this is the real enforcement; the client check is
  // only a convenience).
  updateMeetingStatus: async (req, res) => {
    const { status } = req.body
    if (!MEETING_STATUSES.includes(status)) {
      throw new ApiError(400, `status must be one of: ${MEETING_STATUSES.join(', ')}`)
    }
    const doc = await CalendarEvent.findById(req.params.id)
    if (!doc) throw new ApiError(404, 'Event not found')
    await assertCanManageMeeting(doc, req.user)
    doc.meetingStatus = status
    await doc.save()

    // Phase 6.14 (TASK 7): same recipient (the owning client) and the same
    // channel as before - the client is now resolved from the meeting's project
    // when the event predates the clientId backfill, instead of being skipped.
    await notifyClientOfMeeting(doc, {
      title: `Meeting ${status.toLowerCase()}`,
      body: `Your meeting request "${doc.title}" was ${status.toLowerCase()}.`,
    })

    res.json(doc)
  },

  // Phase 6.12 (TASK 2): RESCHEDULE a client meeting request.
  //
  // ROOT CAUSE of "a Project Lead cannot reschedule": the only route that could
  // change a meeting's `start`/`end` was the generic PUT /calendar/:id, which is
  // gated by `canWrite = authorize('Admin','HR','Manager')`. A Project Lead is
  // normally an Employee, so that gate rejected them outright - a lead could
  // Accept or Reject a meeting (via meeting-status, which self-authorizes) but
  // had no way to propose a new time. The capability was missing at the route
  // layer, not the model layer.
  //
  // This is a deliberately NARROW action rather than opening up PUT: it can only
  // touch start/end (and re-arm the status), only on documents that are real
  // client meeting requests, and only for someone assertCanManageMeeting()
  // approves. PUT /calendar/:id keeps its existing canWrite gate untouched, so
  // no other calendar field becomes writable by an Employee and no existing
  // permission is widened.
  //
  // Rescheduling resets meetingStatus to 'Pending' - a new time is a new
  // proposal that the client has not yet agreed to - and reuses the SAME
  // emitToClient channel + ClientNotification record as the status workflow, so
  // the client portal updates in realtime with no client-side change.
  rescheduleMeeting: async (req, res) => {
    const { start, end } = req.body
    if (!start) throw new ApiError(400, 'A new start date and time is required')
    const startAt = new Date(start)
    if (Number.isNaN(startAt.getTime())) throw new ApiError(400, 'The new start date and time is not valid')
    const endAt = end ? new Date(end) : null
    if (end && Number.isNaN(endAt.getTime())) throw new ApiError(400, 'The new end date and time is not valid')
    if (endAt && endAt < startAt) throw new ApiError(400, 'The meeting cannot end before it starts')
    // Same Sunday rule the client-side request path already enforces, so a
    // rescheduled meeting cannot land somewhere a new one could not be booked.
    if (startAt.getDay() === 0) throw new ApiError(400, 'Meetings cannot be scheduled on a Sunday.')

    const doc = await CalendarEvent.findById(req.params.id)
    if (!doc) throw new ApiError(404, 'Event not found')
    await assertCanManageMeeting(doc, req.user)

    doc.start = startAt
    if (endAt) doc.end = endAt
    doc.meetingStatus = 'Pending'
    await doc.save()

    // Phase 6.14 (TASK 7): THE fix for "reschedule notifies the Manager".
    // The recipient was always meant to be the client; it was skipped because
    // doc.clientId was null on internally-raised requests. Resolving it here
    // makes the intended recipient actually receive the notification, over the
    // existing socket event and the existing ClientNotification record.
    await notifyClientOfMeeting(doc, {
      title: 'Meeting rescheduled',
      body: `Your meeting request "${doc.title}" was moved to a new time and is awaiting your confirmation.`,
    })

    res.json(doc)
  },
}
