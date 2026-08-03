import path from 'path'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { emitToClient, emitResource } from '../realtime/index.js'
import {
  Client, ClientProject, ClientAnnouncement, ClientMessage, ClientNotification,
} from '../models/clientModels.js'
import { Notification } from '../models/notificationModels.js'
import { User } from '../models/User.js'
// Phase 5.8 (Tasks 5 & 7): reuse the SAME ProjectTask/Milestone collections
// the internal Projects UI reads, for Task History and the Progress Dashboard
// - no duplicate collection, no duplicate calculation.
// Phase 6.9 (Task 17): also pull in Project (the old ClientMeeting collection/
// model was removed - see clientModels.js) so meeting requests can resolve a
// REAL Project _id, and PROJECT_FULL_ACCESS/notify helpers for the lead/team
// notification below.
import { ProjectTask, Milestone, Project } from '../models/projectModels.js'
import { CalendarEvent } from '../models/calendarModels.js'
// Phase 6.11 (TASK 5): the SAME Holiday collection Attendance/Leave already use
// (models/attendanceModels.js). The portal gets a read-only projection of it -
// no second holiday model, no second collection, no seeded copy. See
// getHolidays() below for why the existing endpoints could not simply be reused.
import { Holiday } from '../models/attendanceModels.js'
import { PROJECT_FULL_ACCESS } from '../services/projectService.js'
import { notifyUsersByName, notifyUsersByEmail } from '../services/notificationService.js'
// Phase 6.17 (TASK 3): the ONE meeting-management authorization/notification
// logic already lives in calendarController.js - reused here verbatim rather
// than re-implemented, so the Client Portal's new Accept/Reject/Reschedule
// actions cannot drift from the staff-side rules.
import { assertClientCanRespond, notifyStaffOfMeeting, MEETING_STATUSES } from './calendarController.js'
// Phase 6.3 (Task 8): surface the REAL Finance invoices to the portal. This is
// the same Invoice collection the internal Finance module writes to - the portal
// gets a read-only view of it, it does not get a second billing store.
import { Invoice, Transaction } from '../models/financeModels.js'
// Phase 5.4 (Task 4): reuse the internal project comment helpers verbatim so
// the Client Portal and the internal Projects UI read/write ONE shared thread.
import { projectService as projectSvc } from '../services/projectService.js'
// Phase 6.1: ONE shared scoping module (no per-route duplication of the rule).
// Admin/HR are unscoped exactly as before; Manager is limited to the clients
// linked to the projects they lead.
import { buildClientScopeFilter, assertCanAccessClient } from '../services/scopeService.js'
// Phase 6.6 (TASK 2): the ONE shared client-portal-login provisioning routine,
// also used by projectService.createProjectWithClient. See clientLoginService.js
// for the full root-cause note.
import { provisionClientLogin } from '../services/clientLoginService.js'
// Phase 6.21 (TASK 2): the shared meeting slot rules (previously private here).
import { meetingDayKey, meetingDateRejection } from '../services/meetingRules.js'
// Phase 6.23 (TASK 2): the SAME shared team mapper the project sync writes
// with, applied on read so mirrors already holding duplicate rows (written
// before the fix, or by a direct admin team assignment) still render one card
// per person. No second implementation - utils/team.js is the only one.
import { dedupeTeam } from '../utils/team.js'

// Resolve the logged-in client's id. Throws if a Client-role user has no link.
const requireClientId = (req) => {
  const id = req.user?.clientId
  // Empty string ('') is the schema default for non-Client users; treat it as missing.
  if (!id || String(id).trim() === '') {
    throw new ApiError(403, 'Your account is not linked to a client profile. Ask an Admin to assign a Client ID to your account under Admin > Users.')
  }
  return id
}

// --- Client-facing endpoints (scope everything by req.user.clientId) ---------
export const getProfile = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const client = await Client.findOne({ clientId })
  if (!client) throw new ApiError(404, 'Client profile not found')
  res.json(client)
})

// --- Phase 5.8 (Task 6) root cause -----------------------------------------
// "My Projects -> Open Project" returned "Project not found" even though the
// client legitimately owned the project (RBAC/clientId scoping was correct).
// The real bug: these endpoints returned RAW `.lean()` ClientProject docs,
// which only carry Mongo's `_id` — never a `.id` field (lean() skips virtuals
// unless explicitly configured, and none is configured here). Every
// client-portal page (ClientProjects, ClientDashboard, ClientTasks,
// ClientDocuments) links via `p.id`, which was therefore always `undefined`,
// producing a request to `/client/projects/undefined`. `getProject` below
// looks the row up by its human-readable `projectId` field (e.g. "cp-1a2b3c"),
// so `projectId: 'undefined'` never matched anything -> 404 "Project not
// found". Fix: expose `id` as an alias of the existing `projectId` field (the
// identifier the detail/sub-collection routes actually key on), so every
// existing frontend `p.id` reference resolves correctly with zero frontend
// route changes and zero risk of exposing another client's data.
export const getProjects = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const projects = await ClientProject.find({ clientId }).sort({ createdAt: -1 }).lean()
  const data = projects.map((p) => {
    const paid = (p.payments || []).reduce((s, x) => s + (x.paid || 0), 0)
    return { ...p, id: p.projectId, team: dedupeTeam(p.team), paid, balance: (p.budget || 0) - paid }
  })
  res.json(data)
})

export const getProject = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const p = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!p) throw new ApiError(404, 'Project not found')
  const paid = (p.payments || []).reduce((s, x) => s + (x.paid || 0), 0)
  res.json({ ...p, id: p.projectId, team: dedupeTeam(p.team), paid, balance: (p.budget || 0) - paid })
})

export const getProjectSub = (field) => asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const p = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!p) throw new ApiError(404, 'Project not found')
  // Phase 6.3 (Task 8): payments go through the ONE shared billing assembler so
  // the per-project tab, the aggregate list and the dashboard can never disagree.
  if (field === 'payments') {
    // Phase 6.9 (Task 18): buildBillingRows() now returns { rows, ... } (see
    // below) - this per-project sub-resource keeps its original array
    // contract, since it has no other consumer expecting the summary fields.
    const billing = await buildBillingRows(clientId, { projectId: p.projectId })
    return res.json(billing.rows)
  }
  // Phase 6.23 (TASK 2): team is the one sub-collection with a person
  // identity, so it is collapsed through the shared mapper before decoration.
  const source = field === 'team' ? dedupeTeam(p.team) : (p[field] || [])
  const rows = source.map((row) => ({
    ...row,
    // Phase 6.3: `.lean()` returns `_id` on subdocuments, never `id`, but every
    // portal list keys its rows on `.id`. Normalise here, matching withId().
    id: row._id ? String(row._id) : undefined,
    projectId: p.projectId,
    projectName: p.name,
  }))
  res.json(rows)
})

// ---------------------------------------------------------------------------
// Phase 6.3 (Task 8) - "Bills & Payments always display 0"
//
// THREE compounding root causes, none of them a missing query:
//
// 1. FRONTEND FIELD THAT DOES NOT EXIST. ClientBilling.jsx computed
//    `budget = payments.reduce((s, p) => s + (p.budget || 0), 0)`. The payment
//    subdocument (paymentSchema in clientModels.js) has NO `budget` field -
//    budget lives on the PARENT ClientProject. So `p.budget` was `undefined` on
//    every row, `|| 0` swallowed it, and Total Budget summed to exactly 0 no
//    matter how much real data existed. A hardcoded zero in all but name.
//
// 2. THE REAL FINANCE LEDGER WAS NEVER SURFACED. `ClientProject.payments` is
//    only ever written by the Admin `generateInvoice` action. Everything the
//    Finance module records - the `Invoice` collection, and the advance payment
//    that createProjectWithClient() posts as a `Transaction` - was invisible to
//    the portal. A client with genuine invoices raised against them still saw an
//    empty table, because the portal was reading the wrong (and usually empty)
//    collection.
//
// 3. MISSING `id` ON LEAN SUBDOCUMENTS. Rows came back from `.lean()` with
//    `_id`, but ClientBilling keys on `p.id`, so React saw `key={undefined}`
//    on every row.
//
// FIX: one assembler, used by every billing surface. It merges the project-level
// invoice rows with the client's real Finance invoices, normalises ids and
// status vocabulary, and carries the parent project's budget on each row.
// Values are read from stored documents only - nothing is synthesised.
// ---------------------------------------------------------------------------
const buildBillingRows = async (clientId, projectFilter = {}) => {
  const [projects, client] = await Promise.all([
    ClientProject.find({ clientId, ...projectFilter }).sort({ createdAt: -1 }).lean(),
    Client.findOne({ clientId }).lean(),
  ])
  const company = client?.company || ''
  const rows = []

  // (a) Invoices raised at project level by Admin (existing behaviour, repaired).
  projects.forEach((p) => {
    (p.payments || []).forEach((x) => rows.push({
      ...x,
      id: String(x._id),
      invoice: x.invoice || '',
      amount: x.amount || 0,
      paid: x.paid || 0,
      status: x.status || 'Pending',
      date: x.date || '',
      method: x.method || '',
      projectId: p.projectId,
      projectName: p.name,
      client: company,
      // Carried from the PARENT project - this is the field cause #1 was
      // looking for on the payment row itself.
      budget: p.budget || 0,
      source: 'project',
    }))
  })

  // (b) Real Finance invoices for this company. Drafts are excluded because an
  // unissued invoice is not something a client should see. Scoped strictly to
  // the caller's own company, and only when a project filter is not in play.
  if (company && !projectFilter.projectId) {
    const invoices = await Invoice.find({ client: company, status: { $ne: 'Draft' } })
      .sort({ issueDate: -1 }).lean()
    // Never list the same invoice twice if Admin also mirrored it onto a project.
    const seen = new Set(rows.map((r) => r.invoice).filter(Boolean))
    invoices.forEach((inv) => {
      if (inv.invoiceNumber && seen.has(inv.invoiceNumber)) return
      rows.push({
        id: String(inv._id),
        invoice: inv.invoiceNumber || '',
        amount: inv.total || 0,
        paid: inv.amountPaid || 0,
        // Map the Finance vocabulary onto the portal's paymentSchema enum so the
        // existing PAYMENT_STATUS_TONE badge map keeps working unchanged.
        status: inv.status === 'Partial' ? 'Partial Payment'
          : inv.status === 'Sent' ? 'Pending'
          : inv.status,
        date: inv.issueDate || inv.dueDate || '',
        dueDate: inv.dueDate || '',
        method: '',
        projectId: '',
        projectName: 'Account',
        client: company,
        budget: 0,
        source: 'finance',
      })
    })
  }

  // (c) Phase 6.9 (Task 18) ROOT CAUSE FIX: the ONE remaining real billing
  // event most clients actually have \u2014 the advance-payment Income Transaction
  // that createProjectWithClient() posts to the SAME Finance Transaction
  // ledger the internal Finance module reads (server/src/services/
  // projectService.js) \u2014 was never surfaced here. A client whose only billing
  // history is that advance (no project-level payment row yet, no Invoice yet)
  // legitimately saw 0 on every card even though real money had been recorded
  // against them. Scoped by `party === company`, the SAME matching key already
  // used for Invoice.find({ client: company }) above, so no other client's
  // transactions can leak in. Only when no project filter is in play, matching
  // rule (b)'s account-level scope.
  if (company && !projectFilter.projectId) {
    const transactions = await Transaction.find({ type: 'Income', party: company }).sort({ date: -1 }).lean()
    const seenRef = new Set(rows.map((r) => r.invoice).filter(Boolean))
    transactions.forEach((t) => {
      if (t.reference && seenRef.has(t.reference)) return
      rows.push({
        id: String(t._id),
        invoice: t.reference || t.title || '',
        amount: t.amount || 0,
        // A recorded Income transaction is, by definition, money already
        // received - unlike an Invoice, there is no separate "amountPaid".
        paid: t.amount || 0,
        status: 'Paid',
        date: t.date || '',
        method: t.method || '',
        projectId: '',
        projectName: t.category === 'Project Advance' ? 'Advance Payment' : 'Account',
        client: company,
        budget: 0,
        source: 'transaction',
      })
    })
  }

  rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  // Phase 6.9 (Task 18): advancePayment/monthlyDue are real commercial terms
  // captured on the Client document at onboarding (Phase 5.7, Task 3) and
  // already consumed by Finance \u2014 they were simply never returned to the
  // portal. Returned alongside rows (not tacked onto the array, which
  // JSON.stringify would silently drop) so the Billing page can show them as
  // real, stored figures instead of a missing/placeholder value.
  // Phase 6.23 (TASK 3) ROOT CAUSE - the "Total Amount" card.
  //
  // The card was fed by a FRONTEND sum over `rows` (summarizeBilling ->
  // `billed`), and that sum can never be the account total for two structural
  // reasons, both of them here in the data layer:
  //
  //   a) A project with no invoice row yet contributes NO row at all, so its
  //      contracted value is invisible to any row-based sum. A client whose
  //      projects have not been invoiced yet therefore saw the total as 0 even
  //      though ClientProject.budget held the real, stored figure.
  //   b) Advance-payment Income transactions are deliberately excluded from
  //      "billed" (a receipt is not a billing), so for the very common
  //      advance-only client every row was filtered out and the total was 0
  //      while "Paid" showed the advance.
  //
  // The contracted amount lives on the ClientProject documents this assembler
  // has already loaded and scoped by clientId, so the total is computed HERE,
  // once, from stored data - not re-derived in React (no duplicated billing
  // maths) and not hardcoded. `totalBilled` is returned next to it so the
  // invoice-derived figure stays available without a second pass over rows.
  const totalAmount = projects.reduce((sum, p) => sum + (p.budget || 0), 0)
  const totalBilled = rows.reduce((sum, r) => sum + (r.source === 'transaction' ? 0 : (r.amount || 0)), 0)
  return {
    rows,
    advancePayment: client?.advancePayment || 0,
    monthlyDue: client?.monthlyDue || 0,
    totalAmount,
    totalBilled,
  }
}

// Aggregate a sub-collection across ALL of the client's projects (optionally
// filtered to one project via ?projectId=). Mirrors the client-side mock shape
// so the portal renders identically in real mode.
const aggregateSub = (field, decorate) => asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const filter = { clientId }
  if (req.query.projectId) filter.projectId = req.query.projectId
  const projects = await ClientProject.find(filter).sort({ createdAt: -1 }).lean()
  const rows = []
  projects.forEach((p) => {
    // Phase 6.23 (TASK 2): same shared collapse for the cross-project /client/team feed.
    const source = field === 'team' ? dedupeTeam(p.team) : (p[field] || [])
    source.forEach((row, i) => {
      rows.push(decorate ? decorate(row, p, i) : { ...row, projectId: p.projectId, projectName: p.name })
    })
  })
  res.json(rows)
})

export const getAllTimeline = aggregateSub('timeline', (row, p, i) => ({ ...row, projectId: p.projectId, projectName: p.name, order: i }))
export const getAllTeam = aggregateSub('team', (row, p) => ({ ...row, projectId: p.projectId, projectName: p.name }))
export const getAllActivity = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const filter = { clientId }
  if (req.query.projectId) filter.projectId = req.query.projectId
  const projects = await ClientProject.find(filter).lean()
  const rows = []
  projects.forEach((p) => (p.activity || []).forEach((a) => rows.push({ ...a, projectId: p.projectId, projectName: p.name })))
  rows.sort((a, b) => new Date(b.at) - new Date(a.at))
  res.json(rows)
})
export const getAllDocuments = aggregateSub('documents', (row, p) => ({ ...row, projectId: p.projectId, projectName: p.name }))
// Phase 6.3 (Task 8): both endpoints now resolve through the single
// buildBillingRows() assembler above. They previously ran two near-identical
// hand-rolled aggregations over the same data, which is exactly how they drifted.
export const getAllPayments = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const filter = req.query.projectId ? { projectId: req.query.projectId } : {}
  // Phase 6.9 (Task 18): now returns { rows, advancePayment, monthlyDue } -
  // see buildBillingRows() above. ClientBilling.jsx and ClientDashboard.jsx
  // were updated to read this shape (previously a bare array).
  res.json(await buildBillingRows(clientId, filter))
})
export const getAllInvoices = getAllPayments

// Phase 6.9 (Task 17) ROOT CAUSE FIX: meetings now live in the SAME
// CalendarEvent collection the internal Calendar reads/writes (type:
// 'meeting', clientId set), instead of a third, disconnected ClientMeeting
// table with its own time-based status vocabulary. This is a read-only
// projection scoped to the logged-in client - RBAC on the internal Calendar
// side is handled separately by calendarController.meetingVisibilityFilter.
export const getMeetings = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const rows = await CalendarEvent.find({ clientId, type: 'meeting' }).sort({ start: 1 }).lean()
  res.json(rows.map((r) => ({ ...r, id: String(r._id) })))
})

// Phase 6.9 (Task 17): a client requests a new meeting. Creates a REAL
// CalendarEvent (type: 'meeting', meetingStatus: 'Pending') so it shows up on
// the internal Calendar immediately for Admin/Manager/HR/Project Lead to
// action - no separate approval queue to keep in sync.
// Phase 6.11 (TASK 5): shared date rules for a meeting slot.
//
// The calendar day is taken from the LEADING 10 CHARACTERS of the submitted
// string rather than from `new Date(...).toISOString()`. The portal sends a
// datetime-local value ('2026-08-02T10:00') which carries no timezone, so
// converting to UTC would shift the day across midnight for any server not on
// UTC and could reject (or accept) the wrong date. Holiday.date is stored in
// exactly this 'YYYY-MM-DD' form, so the keys compare directly.
// Phase 6.21 (TASK 2): MOVED to services/meetingRules.js and imported at the
// top of this file, so the internal (Project Lead) meeting path enforces the
// IDENTICAL Sunday / Company-Holiday rule instead of a second copy of it.
// Behaviour for the client portal is unchanged - same functions, same text.

// Phase 6.11 (TASK 5): read-only Company Holiday list for the portal.
//
// ROOT CAUSE this endpoint exists to solve: the Holiday data the brief says to
// reuse was unreachable from a Client session. BOTH existing readers are closed
// to the Client role by design - leaveRoutes.js mounts `protect, blockClient`,
// and attendanceRoutes.js guards /holidays with
// authorize('Admin','HR','Manager','Employee'). Calling either from the portal
// would have meant widening a staff guard to include Client, which would have
// exposed the whole leave/attendance surface behind it.
//
// So the collection is projected here instead, on the router that is already
// `protect, authorize('Client')`. This is a READ of the same documents, limited
// to the two fields the date picker needs, and only from today forward. No
// write path is added: holidays remain creatable/editable by Admin/HR only,
// through the untouched attendance routes.
export const getHolidays = asyncHandler(async (req, res) => {
  requireClientId(req)
  const today = new Date().toISOString().slice(0, 10)
  const rows = await Holiday.find({ date: { $gte: today } }).sort({ date: 1 }).select('name date').lean()
  res.json(rows.map((r) => ({ id: String(r._id), name: r.name, date: r.date })))
})

export const createMeetingRequest = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const { title, start, location, description, projectId } = req.body
  if (!title || !String(title).trim()) throw new ApiError(400, 'Title is required')
  if (!start || Number.isNaN(new Date(start).getTime())) throw new ApiError(400, 'A valid start date/time is required')

  // Phase 6.11 (TASK 5): Sundays and Company Holidays are refused here, not just
  // in the modal. The UI check is a convenience; this is the actual guarantee.
  const rejection = await meetingDateRejection(start)
  if (rejection) throw new ApiError(400, rejection)

  // `projectId` from the client portal is the portal-facing ClientProject id
  // (e.g. "cp-1"); resolve it to the REAL Project _id via sourceProjectId so
  // the meeting is visible to that project's lead/team on the internal
  // Calendar, exactly like any other project-scoped event.
  let realProjectId = null
  let project = null
  if (projectId) {
    const clientProject = await ClientProject.findOne({ projectId, clientId }).lean()
    if (clientProject?.sourceProjectId) {
      realProjectId = clientProject.sourceProjectId
      project = await Project.findById(realProjectId).lean()
    }
  }

  const startDate = new Date(start)
  const doc = await CalendarEvent.create({
    title: String(title).trim(),
    type: 'meeting',
    start: startDate,
    end: new Date(startDate.getTime() + 60 * 60 * 1000),
    allDay: false,
    location: (location || '').trim(),
    description: (description || '').trim(),
    clientId,
    projectId: realProjectId,
    meetingStatus: 'Pending',
    createdBy: req.user?.name || req.user?.email || clientId,
    // Phase 6.17 (TASK 3): this request was raised BY the client, so staff
    // are the ones who respond - the existing pre-6.17 direction, now made
    // explicit so assertCanManageMeeting/assertClientCanRespond can tell the
    // two directions apart.
    requestedBy: 'client',
  })

  // /api/client* is not wrapped by the generic emitMiddleware (unlike
  // /api/calendar), so this route emits manually - same pattern as every
  // other client-portal write handler in this file.
  emitResource('calendar', 'post', doc)

  // Notify the people who can act on this request: the project's lead/
  // members if we resolved one, otherwise every Admin/Manager/HR user.
  // Phase 6.17 (TASK 3) CLEANUP: this recipient-selection logic used to be
  // duplicated inline here; it is now the SAME notifyStaffOfMeeting helper
  // the new Client response actions below also call, so there is one copy of
  // the rule instead of two that could drift apart.
  await notifyStaffOfMeeting(doc, {
    title: `New meeting request: ${doc.title}`,
    body: `A client requested a meeting for ${startDate.toLocaleString()}.`,
  })

  res.status(201).json({ ...doc.toObject(), id: String(doc._id) })
})

// Phase 6.17 (TASK 3) ROOT CAUSE FIX: when STAFF raises a meeting request (via
// calendarController.create, used by features/projects/MeetingRequestsPanel.jsx),
// the request is FROM staff TO the client - so the Client, and only the
// Client, must be able to Accept/Reject/Reschedule it. That capability never
// existed anywhere: /calendar/* is blocked to the Client role entirely
// (calendarRoutes.js `protect, blockClient`), and this router only ever
// exposed GET/POST /meetings. This is the real root cause of "the Client
// cannot respond to a staff-requested meeting" - not a UI bug, a missing
// server capability.
//
// This reuses the SAME CalendarEvent model/meetingStatus vocabulary
// (MEETING_STATUSES, imported from calendarController.js - not restated), the
// SAME assertClientCanRespond authorization rule (the direction-aware mirror
// of assertCanManageMeeting), and the SAME notifyStaffOfMeeting notification
// helper used above. No new model, no new notification pipeline.
export const respondToMeeting = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const { status } = req.body
  // Only Accept/Reject belong to this action - Cancel remains a staff-only
  // capability (unchanged, via PATCH /calendar/:id/meeting-status), and
  // Reschedule has its own action below since it also changes start/end.
  const allowedStatuses = MEETING_STATUSES.filter((s) => s === 'Approved' || s === 'Rejected')
  if (!allowedStatuses.includes(status)) {
    throw new ApiError(400, `status must be one of: ${allowedStatuses.join(', ')}`)
  }
  const doc = await CalendarEvent.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Meeting not found')
  assertClientCanRespond(doc, clientId)
  doc.meetingStatus = status
  await doc.save()

  // Same manual-emit pattern as createMeetingRequest above - this router is
  // not wrapped by the generic emitMiddleware.
  emitResource('calendar', 'patch', doc)
  await notifyStaffOfMeeting(doc, {
    title: `Meeting ${status.toLowerCase()}`,
    body: `The client ${status.toLowerCase()} the meeting request "${doc.title}".`,
  })

  res.json({ ...doc.toObject(), id: String(doc._id) })
})

// Phase 6.17 (TASK 3): the Client's Reschedule action for a staff-requested
// meeting. Reuses the SAME Sunday/holiday validation (meetingDateRejection)
// createMeetingRequest already enforces, and resets meetingStatus to
// 'Pending' - the SAME "a new time is a new proposal" rule
// calendarController.rescheduleMeeting already applies on the staff side.
export const rescheduleMeetingAsClient = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const { start } = req.body
  if (!start || Number.isNaN(new Date(start).getTime())) {
    throw new ApiError(400, 'A valid start date/time is required')
  }
  const rejection = await meetingDateRejection(start)
  if (rejection) throw new ApiError(400, rejection)

  const doc = await CalendarEvent.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Meeting not found')
  assertClientCanRespond(doc, clientId)

  const duration = (doc.end && doc.start) ? (new Date(doc.end).getTime() - new Date(doc.start).getTime()) : 60 * 60 * 1000
  const startDate = new Date(start)
  doc.start = startDate
  doc.end = new Date(startDate.getTime() + duration)
  doc.meetingStatus = 'Pending'
  await doc.save()

  emitResource('calendar', 'patch', doc)
  await notifyStaffOfMeeting(doc, {
    title: 'Meeting rescheduled',
    body: `The client proposed a new time for "${doc.title}": ${startDate.toLocaleString()}.`,
  })

  res.json({ ...doc.toObject(), id: String(doc._id) })
})

// Phase 5.8 (Task 1): the client-facing Announcements endpoint was removed
// (sidebar/dashboard/routes all deleted on the frontend). `ClientAnnouncement`
// and `publishAnnouncement` below are untouched -> Admin/HR/Manager/Employee
// announcement surfaces keep working exactly as before.

export const getNotifications = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const rows = await ClientNotification.find({ clientId }).sort({ at: -1 }).lean()
  // Phase 6.3: same `_id` vs `id` normalisation as elsewhere - the bell keys its
  // list on `n.id`, which `.lean()` never provides.
  res.json(rows.map((r) => ({ ...r, id: String(r._id) })))
})

// --- Phase 6.3 (Task 10): "Mark all as read" for the Client Portal -----------
// ROOT CAUSE of the gap: staff already had this (POST /notifications/read-all ->
// notificationController, `Notification.updateMany({ recipient: req.user.email,
// read: false }, { read: true })`), but the client portal was never given an
// equivalent. ClientNotification had only a single-row PATCH .../:id/read, and
// ClientNotificationBell.jsx did not call even that - clicking an item only
// navigated, so a client's unread badge could never be cleared at all.
//
// Deliberately scoped by `clientId`, exactly mirroring how the staff version
// scopes by `recipient`. It is therefore per-account and can never mark another
// client's - or any staff member's - notifications as read. No global effect.
export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const result = await ClientNotification.updateMany(
    { clientId, read: false },
    { $set: { read: true } },
  )
  // Realtime: fan out only to this one client's room so their other open tabs
  // refresh the bell immediately.
  emitToClient(clientId, 'client:notification', { action: 'read-all', clientId })
  res.json({ updated: result?.modifiedCount ?? 0 })
})

export const markNotificationRead = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const n = await ClientNotification.findOneAndUpdate(
    { _id: req.params.id, clientId }, { read: true }, { new: true }
  )
  if (!n) throw new ApiError(404, 'Notification not found')
  emitToClient(clientId, 'client:notification', n)
  res.json(n)
})

// Phase 5.8 (Task 2): the standalone ClientMessage thread ('getMessages' /
// 'replyMessage') is retired for the client-facing portal. Communication now
// flows exclusively through the shared ProjectComment thread
// ('getProjectComments' / 'addProjectComment' / 'updateProjectComment' /
// 'deleteProjectComment'), which is project-specific and already reused by
// the internal Projects UI. 'ClientMessage' / 'adminListMessages' /
// 'adminReplyMessage' are untouched for the Admin side.
//
// Phase 6.3 (TASK 11): the retired handler was still physically present here as
// `__removedReplyMessage_doNotUse` - ~30 lines of unreachable code kept behind a
// deliberately unusable name. It was never exported and no route referenced it,
// so it has now been deleted outright rather than left as a decoy. Nothing was
// removed from the Admin messaging side.

// --- Admin endpoints (Admin) -----------------------------------
export const listClients = asyncHandler(async (req, res) => {
  // Phase 6.1: HR and Manager may now reach this endpoint. Admin/HR get the
  // full listing (filter === null, i.e. Client.find({}) - identical to the old
  // behaviour). A Manager gets only the companies of the projects they lead.
  const scope = await buildClientScopeFilter(req.user)
  const clients = await Client.find(scope || {}).sort({ company: 1 }).lean()
  // Compute per-client project counts in a single aggregate pass instead of
  // issuing 2 countDocuments queries per client (N+1).
  const counts = await ClientProject.aggregate([
    {
      $group: {
        _id: '$clientId',
        projectCount: { $sum: 1 },
        activeProjects: {
          $sum: { $cond: [{ $not: { $in: ['$status', ['Completed', 'On Hold']] } }, 1, 0] },
        },
      },
    },
  ])
  const byClient = Object.fromEntries(counts.map((c) => [c._id, c]))
  const withCounts = clients.map((c) => {
    const cnt = byClient[c.clientId] || { projectCount: 0, activeProjects: 0 }
    return { ...c, projectCount: cnt.projectCount, activeProjects: cnt.activeProjects }
  })
  res.json(withCounts)
})

// All client projects (admin view) — used by the client detail / assignment UI.
export const listAllProjects = asyncHandler(async (req, res) => {
  const projects = await ClientProject.find().sort({ createdAt: -1 }).lean()
  const data = projects.map((p) => {
    const paid = (p.payments || []).reduce((s, x) => s + (x.paid || 0), 0)
    return { ...p, id: p.projectId, paid, balance: (p.budget || 0) - paid }
  })
  res.json(data)
})

export const getClient = asyncHandler(async (req, res) => {
  const client = await Client.findOne({ clientId: req.params.id })
  if (!client) throw new ApiError(404, 'Client not found')
  // Phase 6.1: prevents a Manager from reading an unrelated client by guessing
  // its clientId in the URL. No-op for Admin/HR.
  await assertCanAccessClient(req.user, client)
  res.json(client)
})

// Phase 6.6 (TASK 2): CREATING A CLIENT NOW ALSO CREATES ITS LOGIN ACCOUNT.
//
// ROOT CAUSE: this handler only ever wrote the Client document. There was no
// User provisioning at all, so "Manager -> Clients -> Add Client" produced a
// client that could never sign in - and because the form had no password field,
// nothing was even sent to provision one.
//
// FIX: `password` / `confirmPassword` are stripped out of the Client document
// (they must never be persisted on the Client collection) and handed to the
// shared services/clientLoginService.js routine, which is the SAME routine the
// New Project -> New Client flow uses. Passing no password is still valid and
// keeps the old behaviour (client record only), so every existing caller -
// including PUT-style imports and the Admin -> Users path - is unaffected.
export const createClient = asyncHandler(async (req, res) => {
  const clientId = req.body.clientId || `cl-${Date.now()}`
  if (await Client.findOne({ clientId })) throw new ApiError(409, 'Client ID already exists')

  // Never persist credentials on the Client document.
  const { password = '', confirmPassword = '', ...clientFields } = req.body || {}

  // SERVER-SIDE VALIDATION IS AUTHORITATIVE: the browser also checks this, but
  // a mismatched pair must be rejected here regardless of the client.
  if (password && confirmPassword && password !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match')
  }

  const client = await Client.create({ ...clientFields, clientId })

  // Only provision a login when a password was actually supplied. The policy
  // check itself lives in clientLoginService (shared with the project flow).
  let credentials = null
  if (password) {
    try {
      const provisioned = await provisionClientLogin({ client, email: client.email, password })
      credentials = provisioned.credentials
    } catch (err) {
      // Compensating rollback: never leave a Client behind whose login failed,
      // otherwise a retry would hit the 409 'Client ID already exists' above.
      await Client.deleteOne({ _id: client._id })
      throw err
    }
  }

  emitResource('clients', 'create', client)
  // `credentials` is only populated when a temporary password was generated;
  // with a typed password it stays null, so no secret is ever echoed back.
  res.status(201).json(credentials ? { ...client.toObject(), credentials } : client)
})

export const updateClient = asyncHandler(async (req, res) => {
  // Phase 6.1: authorise BEFORE mutating. The scope check needs the stored
  // company, so the document is loaded first rather than using a bare
  // findOneAndUpdate (which would have written before the check could run).
  const existing = await Client.findOne({ clientId: req.params.id })
  if (!existing) throw new ApiError(404, 'Client not found')
  await assertCanAccessClient(req.user, existing)
  const client = await Client.findOneAndUpdate({ clientId: req.params.id }, req.body, { new: true, runValidators: true })
  if (!client) throw new ApiError(404, 'Client not found')
  emitResource('clients', 'update', client)
  res.json(client)
})

export const removeClient = asyncHandler(async (req, res) => {
  const client = await Client.findOneAndDelete({ clientId: req.params.id })
  if (!client) throw new ApiError(404, 'Client not found')
  await ClientProject.deleteMany({ clientId: client.clientId })
  emitResource('clients', 'remove', { clientId: client.clientId })
  res.json({ ok: true })
})

export const assignProject = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOneAndUpdate(
    { projectId: req.body.projectId }, { clientId: req.params.id }, { new: true }
  )
  if (!p) throw new ApiError(404, 'Project not found')
  emitToClient(req.params.id, 'client:project', { action: 'assigned', project: p })
  res.json(p)
})

export const assignProjectManager = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOneAndUpdate(
    { projectId: req.params.id }, { projectManager: req.body.manager }, { new: true }
  )
  if (!p) throw new ApiError(404, 'Project not found')
  emitToClient(p.clientId, 'client:project', { action: 'manager', project: p })
  res.json(p)
})

export const assignTeam = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOneAndUpdate(
    // Phase 6.23 (TASK 2): sanitise at the write boundary too, so an admin
    // assignment can never persist the same person twice.
    { projectId: req.params.id }, { team: dedupeTeam(req.body.members) }, { new: true }
  )
  if (!p) throw new ApiError(404, 'Project not found')
  emitToClient(p.clientId, 'client:project', { action: 'team', project: p })
  res.json(p)
})

export const updateProjectProgress = asyncHandler(async (req, res) => {
  const progress = Math.max(0, Math.min(100, Number(req.body.progress || 0)))
  const p = await ClientProject.findOneAndUpdate(
    { projectId: req.params.id }, { progress }, { new: true }
  )
  if (!p) throw new ApiError(404, 'Project not found')
  emitToClient(p.clientId, 'client:project', { action: 'progress', project: p })
  res.json(p)
})

export const generateInvoice = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOne({ projectId: req.params.id })
  if (!p) throw new ApiError(404, 'Project not found')
  const rec = {
    invoice: req.body.invoice || `INV-${p.projectId.toUpperCase()}-${Date.now()}`,
    amount: Number(req.body.amount || 0),
    paid: Number(req.body.paid || 0),
    status: req.body.status || 'Pending',
    date: req.body.date || new Date().toISOString().slice(0, 10),
    method: req.body.method || 'Bank Transfer',
  }
  p.payments.push(rec)
  if (rec.status === 'Pending') {
    await ClientNotification.create({
      clientId: p.clientId,
      title: 'New Invoice Generated',
      body: `Invoice ${rec.invoice} for ₹${rec.amount.toLocaleString('en-IN')} raised.`,
      at: new Date().toISOString(),
      icon: 'invoice',
    })
  }
  await p.save()
  emitToClient(p.clientId, 'client:invoice', { project: p, invoice: rec })
  res.json(rec)
})

export const updatePayment = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOne({ projectId: req.params.id })
  if (!p) throw new ApiError(404, 'Project not found')
  const pay = p.payments.id(req.params.paymentId)
  if (!pay) throw new ApiError(404, 'Payment not found')
  Object.assign(pay, req.body)
  await p.save()
  emitToClient(p.clientId, 'client:invoice', { project: p, invoice: pay })
  res.json(pay)
})

export const uploadDocument = asyncHandler(async (req, res) => {
  const p = await ClientProject.findOne({ projectId: req.params.id })
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = { ...req.body, uploadedAt: req.body.uploadedAt || new Date().toISOString().slice(0, 10) }
  p.documents.push(doc)
  await p.save()
  emitToClient(p.clientId, 'client:document', { project: p, document: doc })
  // Phase 5.8 (Task 9): staff-side uploads previously only emitted the socket
  // event with no persisted notification, so the notification bell/list never
  // recorded the event once the client was offline. Add the same client-
  // facing notification the client-portal upload path already creates.
  await ClientNotification.create({
    clientId: p.clientId, title: 'New document uploaded',
    body: `${doc.uploadedBy || 'Your project team'} uploaded "${doc.name}" to ${p.name}`,
    at: new Date().toISOString(), icon: 'document',
  })
  emitToClient(p.clientId, 'client:notification', { clientId: p.clientId })
  res.json(doc)
})

export const publishAnnouncement = asyncHandler(async (req, res) => {
  const a = await ClientAnnouncement.create(req.body)
  emitResource('client-announcements', 'create', a)
  res.status(201).json(a)
})

// Admin: read a specific client's message threads.
export const adminListMessages = asyncHandler(async (req, res) => {
  const rows = await ClientMessage.find({ clientId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(rows)
})

// Admin: reply to a client message thread as the team.
export const adminReplyMessage = asyncHandler(async (req, res) => {
  const thread = await ClientMessage.findById(req.params.id)
  if (!thread) throw new ApiError(404, 'Conversation not found')
  const from = req.user?.name || 'Skew Team'
  const msg = { from, at: new Date().toISOString(), text: req.body.text || '' }
  thread.messages.push(msg)
  await thread.save()
  emitToClient(thread.clientId, 'client:message', { threadId: thread._id, message: msg })
  // Notify the client so their portal unread count updates.
  await ClientNotification.create({
    clientId: thread.clientId, title: 'New reply from your team',
    body: `${from}: ${(msg.text || '').slice(0, 80)}`, at: new Date().toISOString(), icon: 'message',
  })
  emitToClient(thread.clientId, 'client:notification', { clientId: thread.clientId })
  res.json(thread)
})

// --- Phase 5.4 (Task 4): Client <-> team project comment collaboration -------
// Root cause of the gap: project comments live in the internal ProjectComment
// collection, exposed only by projectRoutes.js - and that router starts with
// `router.use(protect, blockClient)`, so a Client-role user was hard-blocked
// from the entire comment API. The Client Portal therefore had no way to see
// or answer team discussion on their own project.
//
// These two endpoints open exactly that thread to the owning client - and
// nothing else - by reusing the SAME ProjectComment collection and the SAME
// projectService helpers the internal UI uses (no second comment store, so the
// two sides can never diverge). Access stays scoped: we resolve the caller's
// ClientProject by clientId first, and only then follow its sourceProjectId.
export const getProjectComments = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  if (!cp.sourceProjectId) return res.json([])
  const rows = await projectSvc.comments({ project: String(cp.sourceProjectId) })
  res.json(rows)
})

export const addProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  if (!cp.sourceProjectId) throw new ApiError(409, 'This project is not linked to an internal project yet. Ask your account manager to re-save it.')
  const body = String(req.body?.body || '').trim()
  if (!body) throw new ApiError(400, 'Comment cannot be empty')

  const author = req.user?.name || 'Client'
  // Client comments are never task-scoped - they belong to the project thread.
  const comment = await projectSvc.addComment(
    { project: String(cp.sourceProjectId), task: null, body, viaClientPortal: true },
    author,
  )

  // Push it live to the client's own portal session (same channel the rest of
  // the portal already listens on).
  emitToClient(clientId, 'client:project-comment', { projectId: cp.projectId, comment })

  // Notify ONLY the internal members assigned to this project - same scoping
  // rule and notification shape used by replyMessage above.
  const teamNames = [...new Set((cp.team || []).map((t) => t.name).filter(Boolean))]
  if (teamNames.length) {
    const members = await User.find({ name: { $in: teamNames }, role: { $ne: 'Client' } }).select('email').lean()
    if (members.length) {
      await Notification.insertMany(members.map((m) => ({
        recipient: m.email,
        type: 'project',
        title: `New client comment on ${cp.name}`,
        body: `${author}: ${body.slice(0, 80)}`,
        sender: author,
      })))
    }
  }

  res.status(201).json(comment)
})

// Phase 5.8 (Task 2): client can edit/delete their OWN comment. Ownership and
// ONLY-own-comment enforcement live in projectSvc.updateComment/deleteComment
// (shared with the internal Projects UI), so the rule can never diverge
// between the two surfaces.
export const updateProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  const body = String(req.body?.body || '').trim()
  if (!body) throw new ApiError(400, 'Comment cannot be empty')
  const author = req.user?.name || 'Client'
  const comment = await projectSvc.updateComment(req.params.commentId, { body }, author)
  emitToClient(clientId, 'client:project-comment', { projectId: cp.projectId, comment })
  res.json(comment)
})

export const deleteProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  const author = req.user?.name || 'Client'
  await projectSvc.deleteComment(req.params.commentId, author, req.user?.role)
  emitToClient(clientId, 'client:project-comment', { projectId: cp.projectId, deletedId: req.params.commentId })
  res.json({ deleted: true })
})

// Phase 5.8 (Task 2): attach an existing-system file (ProjectFile, the SAME
// store the internal Projects UI uses) to a comment. No second file store.
export const uploadCommentAttachment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  if (!cp.sourceProjectId) throw new ApiError(409, 'This project is not linked to an internal project yet.')
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  const author = req.user?.name || 'Client'
  const file = await projectSvc.addFile(
    { project: String(cp.sourceProjectId), name: req.file.originalname, url: `/uploads/${req.file.filename}`, size: req.file.size },
    author,
  )
  res.status(201).json({ fileId: file._id || file.id, name: file.name, url: file.url, size: file.size })
})

// --- Phase 5.8 (Task 3): Client Documents, rebuilt on the SAME ClientProject
// `documents` sub-array Admin already writes via `uploadDocument` above - one
// storage location, real disk upload (reusing the existing multer `upload`
// middleware and the same /uploads path-safety rules as fileRoutes.js),
// scoped strictly to the caller's own project, with delete restricted to
// documents the client themselves uploaded. ---------------------------------
export const uploadClientDocument = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const p = await ClientProject.findOne({ projectId: req.params.id, clientId })
  if (!p) throw new ApiError(404, 'Project not found')
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  const uploader = req.user?.name || 'Client'
  const doc = {
    name: req.file.originalname,
    type: String(req.body?.category || 'Other'),
    size: `${(req.file.size / 1024).toFixed(1)} KB`,
    uploadedBy: uploader,
    uploadedAt: new Date().toISOString().slice(0, 10),
    url: `/uploads/${req.file.filename}`,
  }
  p.documents.push(doc)
  p.activity.push({ text: `${uploader} uploaded document "${doc.name}"`, at: new Date().toISOString(), by: uploader })
  await p.save()
  emitToClient(clientId, 'client:document', { project: p, document: doc })
  // Task 9: notify project members of the upload.
  const teamNames = [...new Set((p.team || []).map((t) => t.name).filter(Boolean))]
  if (teamNames.length) {
    const members = await User.find({ name: { $in: teamNames }, role: { $ne: 'Client' } }).select('email').lean()
    if (members.length) {
      await Notification.insertMany(members.map((m) => ({
        recipient: m.email, type: 'project', title: `New document on ${p.name}`,
        body: `${uploader} uploaded "${doc.name}"`, sender: uploader,
      })))
    }
  }
  res.status(201).json(doc)
})

export const deleteClientDocument = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const p = await ClientProject.findOne({ projectId: req.params.id, clientId })
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = p.documents.id(req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  // Permission: a Client may delete ONLY a document they themselves uploaded.
  if (doc.uploadedBy !== (req.user?.name || '')) {
    throw new ApiError(403, 'You can only delete documents you uploaded')
  }
  doc.deleteOne()
  await p.save()
  emitToClient(clientId, 'client:document', { project: p, deletedId: req.params.docId })
  res.json({ deleted: true })
})

export const downloadClientDocument = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const p = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = (p.documents || []).find((d) => String(d._id) === req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  // Reuse the same on-disk path-safety pattern as fileRoutes.js's diskPath().
  const uploadsRoot = path.resolve(process.cwd(), 'uploads')
  const abs = path.resolve(process.cwd(), '.' + doc.url)
  if (!abs.startsWith(uploadsRoot)) throw new ApiError(400, 'Invalid file path')
  res.download(abs, doc.name)
})

// --- Phase 5.8 (Task 5): Task History tab, reusing the SAME `taskHistory`
// query the internal Projects UI/employee portal use - no duplicate
// collection, no duplicate query logic. Scoped to the caller's own project. --
export const getProjectTaskHistory = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  if (!cp.sourceProjectId) return res.json([])
  // Phase 6.3 (Task 4): ownership is PROVEN by the ClientProject lookup above -
  // the row was fetched by { projectId, clientId }, so it is this client's own
  // project or the request already 404'd. We tell taskHistory that, via a
  // server-side-only third argument, so it skips its staff-membership scope
  // check (which a Client can never satisfy and which caused the 403).
  // This is NOT an RBAC bypass: the flag cannot be supplied by an HTTP caller,
  // and the project id we pass is derived from the verified row, never from
  // user input, so a client still cannot read any other project's history.
  const rows = await projectSvc.taskHistory(
    { project: String(cp.sourceProjectId) },
    req.user,
    { ownershipVerified: true },
  )
  res.json(rows)
})

// --- Phase 5.8 (Task 7): Progress Dashboard, computed from the SAME
// ProjectTask / Milestone collections the internal UI already reads via
// recomputeProgress/stats - no second calculation, just a client-scoped view. -
export const getProjectProgress = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const cp = await ClientProject.findOne({ projectId: req.params.id, clientId }).lean()
  if (!cp) throw new ApiError(404, 'Project not found')
  if (!cp.sourceProjectId) {
    return res.json({
      overallProgress: cp.progress || 0, completedTasks: 0, pendingTasks: 0, overdueTasks: 0,
      milestones: [], timelinePercent: 0, openIssues: 0, latestActivity: (cp.activity || []).slice(-1)[0] || null,
    })
  }
  const [tasks, milestones] = await Promise.all([
    ProjectTask.find({ project: cp.sourceProjectId }).lean(),
    Milestone.find({ project: cp.sourceProjectId }).lean(),
  ])
  const today = new Date().toISOString().slice(0, 10)
  const completedTasks = tasks.filter((t) => t.status === 'Done').length
  const pendingTasks = tasks.filter((t) => t.status !== 'Done').length
  const overdueTasks = tasks.filter((t) => t.status !== 'Done' && t.dueDate && t.dueDate < today).length
  const openIssues = tasks.filter((t) => t.type === 'Bug' && t.status !== 'Done').length
  const stages = cp.timeline || []
  const doneStages = stages.filter((s) => s.status === 'Completed' || s.status === 'Done').length
  const timelinePercent = stages.length ? Math.round((doneStages / stages.length) * 100) : 0
  // Phase 6.3 (Tasks 3 & 7): compute the headline number from the tasks we just
  // loaded rather than reading back the `cp.progress` mirror column. Identical
  // formula to recomputeProgress() (share of Done), so the two can never
  // disagree, and this endpoint stays correct even for a project whose mirror
  // predates this phase and was therefore never synced.
  const overallProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : (cp.progress || 0)
  res.json({
    overallProgress,
    completedTasks,
    pendingTasks,
    overdueTasks,
    milestones: milestones.map((m) => ({ title: m.title, status: m.status, progress: m.progress, dueDate: m.dueDate })),
    timelinePercent,
    openIssues,
    latestActivity: (cp.activity || []).slice(-1)[0] || null,
  })
})
