import path from 'path'
import mongoose from 'mongoose'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { emitToClient, emitResource } from '../realtime/index.js'
import {
  Client, ClientProject, ClientAnnouncement, ClientMessage, ClientNotification,
} from '../models/clientModels.js'
import { Notification } from '../models/notificationModels.js'
import { User } from '../models/User.js'
import { ProjectTask, Milestone, Project, ProjectActivity, ProjectFile } from '../models/projectModels.js'
import { CalendarEvent } from '../models/calendarModels.js'
import { Holiday } from '../models/attendanceModels.js'
import { PROJECT_FULL_ACCESS, buildTimelineStages } from '../services/projectService.js'
import { notifyUsersByName, notifyUsersByEmail } from '../services/notificationService.js'
import { assertClientCanRespond, notifyStaffOfMeeting, MEETING_STATUSES } from './calendarController.js'
import { buildBillingRows, summarizeBilling } from '../services/clientBillingService.js'
import { projectService as projectSvc } from '../services/projectService.js'
import { buildClientScopeFilter, assertCanReadClient, assertCanAccessClient } from '../services/scopeService.js'
import { provisionClientLogin } from '../services/clientLoginService.js'
import { recordAdvancePayment } from '../services/clientAdvanceService.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'
import { meetingDayKey, meetingDateRejection } from '../services/meetingRules.js'
import { dedupeTeam, buildProjectTeam } from '../utils/team.js'

const requireClientId = (req) => {
  const id = req.user?.clientId
  if (!id || String(id).trim() === '') {
    throw new ApiError(403, 'Your account is not linked to a client profile. Ask an Admin to assign a Client ID to your account under Admin > Users.')
  }
  return id
}

// ---- Opt2 helpers: Project is source of truth, ClientProject is legacy fallback ----

async function resolvePortalProject(clientId, rawId) {
  const raw = String(rawId || '').trim()
  if (!raw) return null
  // legacy cp-* -> via ClientProject mirror
  if (raw.startsWith('cp-')) {
    const cp = await ClientProject.findOne({ projectId: raw, clientId }).lean()
    if (!cp) return null
    if (cp.sourceProjectId) {
      const p = await Project.findOne({ _id: cp.sourceProjectId, clientId }).lean()
      if (p) return { project: p, legacy: cp }
      // try fallback without clientId filter
      const p2 = await Project.findById(cp.sourceProjectId).lean()
      if (p2) return { project: p2, legacy: cp }
    }
    // No mirrored Project yet (seeded client-only) -> synthesize Project-like from CP
    return { project: null, legacy: cp }
  }
  // Try ObjectId first
  if (mongoose.isValidObjectId(raw)) {
    const p = await Project.findOne({ _id: raw, clientId }).lean()
    if (p) {
      const legacy = await ClientProject.findOne({ sourceProjectId: p._id }).lean().catch(() => null)
      return { project: p, legacy }
    }
    // Try without clientId (maybe backfill not done)
    const p2 = await Project.findById(raw).lean()
    if (p2) {
      const legacy = await ClientProject.findOne({ sourceProjectId: p2._id }).lean().catch(() => null)
      // enforce ownership if found
      if (String(p2.clientId || '') === String(clientId) || String(p2.client || '').toLowerCase() === String((await Client.findOne({ clientId }).lean())?.company || '').toLowerCase()) {
        return { project: p2, legacy }
      }
    }
    // legacy fallback: CP by sourceProjectId
    const cp = await ClientProject.findOne({ sourceProjectId: raw, clientId }).lean().catch(() => null)
    if (cp) return { project: null, legacy: cp }
    return null
  }
  // Try code
  const pByCode = await Project.findOne({ code: raw.toUpperCase(), clientId }).lean()
  if (pByCode) {
    const legacy = await ClientProject.findOne({ sourceProjectId: pByCode._id }).lean().catch(() => null)
    return { project: pByCode, legacy }
  }
  // fallback CP code
  const cpByCode = await ClientProject.findOne({ code: raw.toUpperCase(), clientId }).lean().catch(() => null)
  if (cpByCode) return { project: null, legacy: cpByCode }
  return null
}

async function toPortalDTO(project, legacy = null, tasks = null) {
  // Synthesize from legacy ClientProject if no Project (pure seeded client portal data before backfill)
  if (!project && legacy) {
    const paid = (legacy.payments || []).reduce((s, x) => s + (x.paid || 0), 0)
    return {
      ...legacy,
      projectId: legacy.projectId,
      id: legacy.projectId,
      code: legacy.code || '',
      status: legacy.status || 'Planning',
      progress: legacy.progress || 0,
      priority: legacy.priority || 'Medium',
      startDate: legacy.startDate || '',
      deliveryDate: legacy.deliveryDate || '',
      projectManager: legacy.projectManager || '',
      budget: legacy.budget || 0,
      advancePayment: legacy.advancePayment || 0,
      monthlyDue: legacy.monthlyDue || 0,
      timeline: legacy.timeline || [],
      team: dedupeTeam(legacy.team || []),
      tasks: legacy.tasks || [],
      activity: legacy.activity || [],
      documents: legacy.documents || [],
      payments: legacy.payments || [],
      paid,
      balance: (legacy.budget || 0) - paid,
      sourceProjectId: legacy.sourceProjectId || null,
      name: legacy.name,
      clientId: legacy.clientId,
    }
  }
  if (!project) return null
  // build team + timeline from live Project + tasks
  const team = buildProjectTeam(project)
  let timeline = []
  try {
    const t = tasks || await ProjectTask.find({ project: project._id }).lean()
    // prefer legacy timeline notes if exists, else compute
    timeline = legacy?.timeline?.length ? legacy.timeline : buildTimelineStages(project, t, legacy?.timeline || [])
  } catch {}
  const paidLegacy = legacy ? (legacy.payments || []).reduce((s, x) => s + (x.paid || 0), 0) : 0
  // payments still from legacy mirror for transition; new invoices are via finance collections and surfaced via getAllPayments
  const payments = legacy?.payments || []
  const paid = paidLegacy
  return {
    ...project,
    projectId: String(project._id),
    id: String(project._id),
    code: project.code || '',
    status: project.status || 'Planning',
    progress: project.progress || 0,
    priority: project.priority || 'Medium',
    startDate: project.startDate || '',
    deliveryDate: project.deadline || '',
    deadline: project.deadline || '',
    projectManager: project.lead || legacy?.projectManager || '',
    lead: project.lead || '',
    budget: project.budget || 0,
    advancePayment: project.advancePayment || legacy?.advancePayment || 0,
    monthlyDue: project.monthlyDue || legacy?.monthlyDue || 0,
    billingCycle: project.billingCycle || legacy?.billingCycle || 'Monthly',
    paymentMode: project.paymentMode || legacy?.paymentMode || 'Bank Transfer',
    timeline,
    team: dedupeTeam(team),
    // keep embedded arrays for detail pages that still read from old CP
    tasks: legacy?.tasks || [],
    activity: legacy?.activity || [],
    documents: legacy?.documents || [],
    payments,
    paid,
    balance: (project.budget || 0) - paid,
    sourceProjectId: project._id,
    clientId: project.clientId,
  }
}

export const getProfile = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const client = await Client.findOne({ clientId })
  if (!client) throw new ApiError(404, 'Client profile not found')
  res.json(client)
})

// Opt2: read from Project (FK clientId) + fallback to ClientProject
export const getProjects = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  // Primary: Projects linked by clientId
  let projects = await Project.find({ clientId }).sort({ createdAt: -1 }).lean()
  // Backfill legacy: projects that still have client string but no clientId
  if (!projects.length) {
    const client = await Client.findOne({ clientId }).lean()
    if (client?.company) {
      const legacyProjects = await Project.find({ client: client.company }).lean()
      if (legacyProjects.length) {
        // async backfill
        Project.updateMany({ _id: { $in: legacyProjects.map(p => p._id) }, clientId: { $in: [null, ''] } }, { $set: { clientId } }).catch(()=>{})
        projects = legacyProjects.map(p => ({ ...p, clientId }))
      }
    }
  }
  // If still no Project, fallback to legacy ClientProject (seeded data before migration)
  if (!projects.length) {
    const cps = await ClientProject.find({ clientId }).sort({ createdAt: -1 }).lean()
    const data = await Promise.all(cps.map(cp => toPortalDTO(null, cp)))
    return res.json(data)
  }
  const legacyMap = {}
  try {
    const ids = projects.map(p => p._id)
    const cps = await ClientProject.find({ sourceProjectId: { $in: ids } }).lean()
    cps.forEach(cp => { legacyMap[String(cp.sourceProjectId)] = cp })
  } catch {}
  const data = await Promise.all(projects.map(async p => {
    const legacy = legacyMap[String(p._id)] || await ClientProject.findOne({ sourceProjectId: p._id }).lean().catch(()=>null)
    const tasks = await ProjectTask.find({ project: p._id }).lean().catch(()=>[])
    return toPortalDTO(p, legacy, tasks)
  }))
  res.json(data)
})

export const getProject = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const dto = await toPortalDTO(resolved.project, resolved.legacy)
  if (!dto) throw new ApiError(404, 'Project not found')
  // extra guard: ensure dto belongs to client
  if (dto.clientId && String(dto.clientId) !== String(clientId)) {
    // allow if legacy mapping says ok but primary clientId mismatch -> check via CP
    if (!resolved.legacy || String(resolved.legacy.clientId) !== String(clientId)) {
      throw new ApiError(404, 'Project not found')
    }
  }
  res.json(dto)
})

export const getProjectSub = (field) => asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const { project, legacy } = resolved

  if (field === 'payments') {
    // Use new billing service that now aggregates from Project + finance collections + legacy fallback
    const billing = await buildBillingRows(clientId, { projectId: project ? String(project._id) : legacy?.projectId })
    // if project-specific, filter to that project
    if (project) {
      const pidStr = String(project._id)
      const legacyPid = legacy?.projectId
      // rows already contain projectId; keep only matching
      billing.rows = billing.rows.filter(r => !r.projectId || String(r.projectId) === pidStr || String(r.projectId) === String(legacyPid))
    }
    return res.json(billing.rows)
  }
  if (field === 'team') {
    if (project) {
      const team = dedupeTeam(buildProjectTeam(project))
      const rows = team.map(row => ({ ...row, id: row.name, projectId: String(project._id), projectName: project.name }))
      return res.json(rows)
    }
    const source = dedupeTeam(legacy?.team || [])
    const rows = source.map(row => ({ ...row, id: row.name || row._id, projectId: legacy.projectId, projectName: legacy.name }))
    return res.json(rows)
  }
  if (field === 'timeline') {
    if (project) {
      const tasks = await ProjectTask.find({ project: project._id }).lean()
      const tl = legacy?.timeline?.length ? legacy.timeline : buildTimelineStages(project, tasks, legacy?.timeline || [])
      const rows = tl.map((row, i) => ({ ...row, id: `${project._id}-${i}`, projectId: String(project._id), projectName: project.name, order: i }))
      return res.json(rows)
    }
    const src = legacy?.timeline || []
    const rows = src.map((row, i) => ({ ...row, id: `${legacy.projectId}-${i}`, projectId: legacy.projectId, projectName: legacy.name, order: i }))
    return res.json(rows)
  }
  if (field === 'tasks') {
    if (project) {
      const tasks = await ProjectTask.find({ project: project._id }).sort({ order: 1 }).lean()
      const rows = tasks.map(row => ({ ...row, id: String(row._id), projectId: String(project._id), projectName: project.name }))
      return res.json(rows)
    }
    const tasks = legacy?.tasks || []
    const rows = tasks.map(row => ({ ...row, id: row._id ? String(row._id) : row.title, projectId: legacy.projectId, projectName: legacy.name }))
    return res.json(rows)
  }
  if (field === 'activity') {
    if (project) {
      const acts = await ProjectActivity.find({ project: project._id }).sort({ createdAt: -1 }).lean()
      const rows = acts.map(a => ({ text: a.action, at: a.createdAt, by: a.actor, id: String(a._id), projectId: String(project._id), projectName: project.name }))
      // also include legacy activity if any
      if (legacy?.activity?.length) {
        legacy.activity.forEach(a => rows.push({ ...a, id: `${legacy.projectId}-${a.at}`, projectId: legacy.projectId, projectName: legacy.name }))
        rows.sort((a,b) => new Date(b.at) - new Date(a.at))
      }
      return res.json(rows)
    }
    const rows = (legacy?.activity || []).map(a => ({ ...a, id: `${legacy.projectId}-${a.at}`, projectId: legacy.projectId, projectName: legacy.name }))
    rows.sort((a,b) => new Date(b.at) - new Date(a.at))
    return res.json(rows)
  }
  if (field === 'documents') {
    if (project) {
      const files = await ProjectFile.find({ project: project._id }).sort({ createdAt: -1 }).lean()
      const rows = files.map(f => ({ ...f, id: String(f._id), projectId: String(project._id), projectName: project.name, name: f.name, url: f.url, type: f.type, size: f.size, uploadedBy: f.uploadedBy, uploadedAt: f.createdAt }))
      if (legacy?.documents?.length) {
        legacy.documents.forEach(d => rows.push({ ...d, id: String(d._id), projectId: legacy.projectId, projectName: legacy.name }))
      }
      return res.json(rows)
    }
    const rows = (legacy?.documents || []).map(d => ({ ...d, id: String(d._id), projectId: legacy.projectId, projectName: legacy.name }))
    return res.json(rows)
  }
  // generic fallback
  const source = legacy ? (legacy[field] || []) : []
  const rows = source.map(row => ({ ...row, id: row._id ? String(row._id) : undefined, projectId: project ? String(project._id) : legacy.projectId, projectName: project ? project.name : legacy.name }))
  res.json(rows)
})

const aggregateSub = (field, decorate) => asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const filter = req.query.projectId ? { projectId: req.query.projectId } : {}
  // Opt2 primary path: Projects
  let projects = await Project.find({ clientId }).lean()
  if (req.query.projectId) {
    const raw = String(req.query.projectId)
    // raw may be cp-... or ObjectId or code
    const resolved = await resolvePortalProject(clientId, raw)
    if (resolved?.project) projects = [resolved.project]
    else if (resolved?.legacy) {
      // legacy only -> delegate to old logic
      const legacyProjects = await ClientProject.find({ clientId, projectId: raw }).lean()
      const rows = []
      legacyProjects.forEach(p => {
        const source = field === 'team' ? dedupeTeam(p.team) : (p[field] || [])
        source.forEach((row, i) => rows.push(decorate ? decorate(row, p, i) : { ...row, projectId: p.projectId, projectName: p.name }))
      })
      return res.json(rows)
    } else projects = []
  }
  if (!projects.length) {
    // fallback entirely to legacy
    const cps = await ClientProject.find({ clientId, ...filter }).sort({ createdAt: -1 }).lean()
    const rows = []
    cps.forEach(p => {
      const source = field === 'team' ? dedupeTeam(p.team) : (p[field] || [])
      source.forEach((row, i) => rows.push(decorate ? decorate(row, p, i) : { ...row, projectId: p.projectId, projectName: p.name }))
    })
    return res.json(rows)
  }
  const rows = []
  for (const proj of projects) {
    if (field === 'team') {
      const team = dedupeTeam(buildProjectTeam(proj))
      team.forEach((row, i) => rows.push(decorate ? decorate(row, { projectId: String(proj._id), name: proj.name }, i) : { ...row, projectId: String(proj._id), projectName: proj.name }))
    } else if (field === 'timeline') {
      const tasks = await ProjectTask.find({ project: proj._id }).lean().catch(()=>[])
      let legacy = null
      try { legacy = await ClientProject.findOne({ sourceProjectId: proj._id }).lean() } catch {}
      const tl = legacy?.timeline?.length ? legacy.timeline : buildTimelineStages(proj, tasks, legacy?.timeline || [])
      tl.forEach((row, i) => rows.push(decorate ? decorate(row, { projectId: String(proj._id), name: proj.name }, i) : { ...row, projectId: String(proj._id), projectName: proj.name }))
    } else if (field === 'documents') {
      const files = await ProjectFile.find({ project: proj._id }).lean().catch(()=>[])
      files.forEach(row => rows.push(decorate ? decorate(row, { projectId: String(proj._id), name: proj.name }, 0) : { ...row, id: String(row._id), projectId: String(proj._id), projectName: proj.name }))
      // include legacy docs
      try {
        const cp = await ClientProject.findOne({ sourceProjectId: proj._id }).lean()
        if (cp?.documents?.length) cp.documents.forEach(row => rows.push({ ...row, projectId: String(proj._id), projectName: proj.name }))
      } catch {}
    } else {
      // tasks, etc - fallback to legacy if needed but for generic fields we don't have project-embedded
      try {
        const cp = await ClientProject.findOne({ sourceProjectId: proj._id }).lean()
        if (cp && cp[field]) cp[field].forEach((row,i)=> rows.push(decorate ? decorate(row, { projectId: String(proj._id), name: proj.name }, i) : { ...row, projectId: String(proj._id), projectName: proj.name }))
      } catch {}
    }
  }
  res.json(rows)
})

export const getAllTimeline = aggregateSub('timeline', (row, p, i) => ({ ...row, projectId: p.projectId, projectName: p.name, order: i }))
export const getAllTeam = aggregateSub('team', (row, p) => ({ ...row, projectId: p.projectId, projectName: p.name }))
export const getAllActivity = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  // Opt2: aggregate from ProjectActivity + legacy
  const projects = await Project.find({ clientId }).lean()
  const rows = []
  if (projects.length) {
    const ids = projects.map(p => p._id)
    const acts = await ProjectActivity.find({ project: { $in: ids } }).sort({ createdAt: -1 }).lean().catch(()=>[])
    acts.forEach(a => rows.push({ text: a.action, at: a.createdAt, by: a.actor, projectId: String(a.project), projectName: projects.find(p=>String(p._id)===String(a.project))?.name || '' }))
    try {
      const cps = await ClientProject.find({ clientId }).lean()
      cps.forEach(p => (p.activity || []).forEach(a => rows.push({ ...a, projectId: p.projectId, projectName: p.name })))
    } catch {}
  } else {
    const cps = await ClientProject.find({ clientId }).lean()
    cps.forEach(p => (p.activity || []).forEach(a => rows.push({ ...a, projectId: p.projectId, projectName: p.name })))
  }
  // also handle query.projectId filter
  if (req.query.projectId) {
    const raw = String(req.query.projectId)
    const resolved = await resolvePortalProject(clientId, raw)
    const pid = resolved?.project ? String(resolved.project._id) : resolved?.legacy?.projectId
    const filtered = rows.filter(r => String(r.projectId) === String(pid) || String(r.projectId) === raw)
    filtered.sort((a, b) => new Date(b.at) - new Date(a.at))
    return res.json(filtered)
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at))
  res.json(rows)
})
export const getAllDocuments = aggregateSub('documents', (row, p) => ({ ...row, projectId: p.projectId, projectName: p.name }))
export const getAllPayments = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  // Opt2: buildBillingRows now supports projectId as ObjectId via translation
  let filter = {}
  if (req.query.projectId) {
    const raw = String(req.query.projectId)
    const resolved = await resolvePortalProject(clientId, raw)
    // billing rows key off cp projectId or Project ObjectId string
    if (resolved?.project) filter.projectId = String(resolved.project._id)
    else if (resolved?.legacy) filter.projectId = resolved.legacy.projectId
    else filter.projectId = raw
  }
  // Try new logic first (Project-aware), fallback to legacy param if empty
  let payload = await buildBillingRows(clientId, filter).catch(()=>null)
  // If projectId was ObjectId string, buildBillingRows may not match legacy cp- ids; fallback: translate
  if (payload && (!payload.rows.length || !payload.rows.length) && filter.projectId && String(filter.projectId).length === 24) {
    try {
      const cp = await ClientProject.findOne({ sourceProjectId: filter.projectId }).lean()
      if (cp) {
        const legacyPayload = await buildBillingRows(clientId, { projectId: cp.projectId })
        if (legacyPayload?.rows?.length) payload = legacyPayload
      }
    } catch {}
  }
  if (!payload) payload = await buildBillingRows(clientId, req.query.projectId ? { projectId: req.query.projectId } : {})
  res.json({ ...payload, summary: summarizeBilling(payload) })
})
export const getAllInvoices = getAllPayments

export const getMeetings = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const rows = await CalendarEvent.find({ clientId, type: 'meeting' }).sort({ start: 1 }).lean()
  res.json(rows.map((r) => ({ ...r, id: String(r._id) })))
})

export const getHolidays = asyncHandler(async (req, res) => {
  requireClientId(req)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const rows = await Holiday.find({ date: { $gte: today } }).sort({ date: 1 }).select('name date').lean()
  res.json(rows.map((r) => ({ id: String(r._id), name: r.name, date: r.date })))
})

export const createMeetingRequest = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const { title, start, location, description, projectId } = req.body
  if (!title || !String(title).trim()) throw new ApiError(400, 'Title is required')
  if (!start || Number.isNaN(new Date(start).getTime())) throw new ApiError(400, 'A valid start date/time is required')

  const rejection = await meetingDateRejection(start)
  if (rejection) throw new ApiError(400, rejection)

  let realProjectId = null
  let project = null
  if (projectId) {
    const resolved = await resolvePortalProject(clientId, projectId)
    if (resolved?.project?._id) {
      realProjectId = resolved.project._id
      project = resolved.project
    } else if (resolved?.legacy?.sourceProjectId) {
      realProjectId = resolved.legacy.sourceProjectId
      project = await Project.findById(realProjectId).lean()
    } else {
      // Try direct Project lookup by rawId
      const direct = await Project.findOne({ _id: projectId, clientId }).lean().catch(()=>null)
      if (direct) { realProjectId = direct._id; project = direct }
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
    requestedBy: 'client',
  })

  emitResource('calendar', 'post', doc)

  await notifyStaffOfMeeting(doc, {
    title: `New meeting request: ${doc.title}`,
    body: `A client requested a meeting for ${startDate.toLocaleString()}.`,
  })

  res.status(201).json({ ...doc.toObject(), id: String(doc._id) })
})

export const respondToMeeting = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const { status } = req.body
  const allowedStatuses = MEETING_STATUSES.filter((s) => s === 'Approved' || s === 'Rejected')
  if (!allowedStatuses.includes(status)) {
    throw new ApiError(400, `status must be one of: ${allowedStatuses.join(', ')}`)
  }
  const doc = await CalendarEvent.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Meeting not found')
  assertClientCanRespond(doc, clientId)
  doc.meetingStatus = status
  await doc.save()

  emitResource('calendar', 'patch', doc)
  await notifyStaffOfMeeting(doc, {
    title: `Meeting ${status.toLowerCase()}`,
    body: `The client ${status.toLowerCase()} the meeting request "${doc.title}".`,
  })

  res.json({ ...doc.toObject(), id: String(doc._id) })
})

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

export const getNotifications = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const rows = await ClientNotification.find({ clientId }).sort({ at: -1 }).lean()
  res.json(rows.map((r) => ({ ...r, id: String(r._id) })))
})

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const result = await ClientNotification.updateMany(
    { clientId, read: false },
    { $set: { read: true } },
  )
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

export const listClients = asyncHandler(async (req, res) => {
  const scope = await buildClientScopeFilter(req.user)
  const clients = await Client.find(scope || {}).sort({ company: 1 }).lean()
  // Opt2: counts from Project (clientId) with fallback to ClientProject for legacy
  let counts = []
  try {
    counts = await Project.aggregate([
      { $match: { clientId: { $ne: null, $ne: '' } } },
      { $group: { _id: '$clientId', projectCount: { $sum: 1 }, activeProjects: { $sum: { $cond: [{ $not: { $in: ['$status', ['Completed', 'On Hold']] } }, 1, 0] } } } },
    ])
  } catch {}
  // merge with legacy counts if Project counts empty (seed before migration)
  if (!counts.length) {
    try {
      counts = await ClientProject.aggregate([
        { $group: { _id: '$clientId', projectCount: { $sum: 1 }, activeProjects: { $sum: { $cond: [{ $not: { $in: ['$status', ['Completed', 'On Hold']] } }, 1, 0] } } } },
      ])
    } catch { counts = [] }
  } else {
    // also include legacy projects not yet migrated (no clientId but via company string)
    // already handled via Project.clientId not null filter; remaining orphan legacy counted via fallback above is not needed
  }
  const byClient = Object.fromEntries(counts.map((c) => [c._id, c]))
  const withCounts = clients.map((c) => {
    const cnt = byClient[c.clientId] || { projectCount: 0, activeProjects: 0 }
    return { ...c, projectCount: cnt.projectCount, activeProjects: cnt.activeProjects }
  })
  res.json(withCounts)
})

export const listAllProjects = asyncHandler(async (req, res) => {
  // Opt2: primary from Project, fallback to ClientProject
  const projects = await Project.find().sort({ createdAt: -1 }).lean()
  if (projects.length) {
    const data = await Promise.all(projects.map(async p => {
      let legacy = null
      try { legacy = await ClientProject.findOne({ sourceProjectId: p._id }).lean() } catch {}
      const paid = legacy ? (legacy.payments || []).reduce((s, x) => s + (x.paid || 0), 0) : 0
      return { ...p, id: String(p._id), projectId: String(p._id), paid, balance: (p.budget || 0) - paid, clientId: p.clientId }
    }))
    return res.json(data)
  }
  const cps = await ClientProject.find().sort({ createdAt: -1 }).lean()
  const data = cps.map((p) => {
    const paid = (p.payments || []).reduce((s, x) => s + (x.paid || 0), 0)
    return { ...p, id: p.projectId, paid, balance: (p.budget || 0) - paid }
  })
  res.json(data)
})

export const getClient = asyncHandler(async (req, res) => {
  const client = await Client.findOne({ clientId: req.params.id })
  if (!client) throw new ApiError(404, 'Client not found')
  await assertCanReadClient(req.user, client)
  res.json(client)
})

export const createClient = asyncHandler(async (req, res) => {
  const clientId = req.body.clientId || `cl-${Date.now()}`
  if (await Client.findOne({ clientId })) throw new ApiError(409, 'Client ID already exists')

  const { password = '', confirmPassword = '', ...clientFields } = req.body || {}

  const company = String(clientFields.company || '').trim()
  if (!company) throw new ApiError(400, 'Company name is required')
  const duplicate = await Client.findOne({
    company: { $regex: `^${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }).lean()
  if (duplicate) {
    throw new ApiError(409, `A client named "${duplicate.company}" already exists (${duplicate.clientId}). Edit that client instead of creating a duplicate.`)
  }

  if (password && confirmPassword && password !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match')
  }

  const client = await Client.create({ ...clientFields, company, clientId })

  let credentials = null
  if (password) {
    try {
      const provisioned = await provisionClientLogin({ client, email: client.email, password })
      credentials = provisioned.credentials
    } catch (err) {
      await Client.deleteOne({ _id: client._id })
      throw err
    }
  }

  try {
    await recordAdvancePayment(client, clientFields.advancePayment, req.user?.name)
  } catch (err) {
    systemLog('WARN', `Client ${client.clientId} created but the advance-payment ledger entry failed: ${err?.message || err}`, SYSTEM_LOG_SOURCES.API)
  }

  emitResource('clients', 'create', client)
  res.status(201).json(credentials ? { ...client.toObject(), credentials } : client)
})

export const updateClient = asyncHandler(async (req, res) => {
  const existing = await Client.findOne({ clientId: req.params.id })
  if (!existing) throw new ApiError(404, 'Client not found')
  await assertCanAccessClient(req.user, existing)
  const client = await Client.findOneAndUpdate({ clientId: req.params.id }, req.body, { new: true, runValidators: true })
  if (!client) throw new ApiError(404, 'Client not found')
  // If company renamed, sync Project.client string cache
  if (req.body?.company && req.body.company !== existing.company) {
    Project.updateMany({ clientId: client.clientId }, { $set: { client: client.company } }).catch(()=>{})
  }
  emitResource('clients', 'update', client)
  res.json(client)
})

export const removeClient = asyncHandler(async (req, res) => {
  const client = await Client.findOneAndDelete({ clientId: req.params.id })
  if (!client) throw new ApiError(404, 'Client not found')
  await Project.deleteMany({ clientId: client.clientId })
  await ClientProject.deleteMany({ clientId: client.clientId })
  await CalendarEvent.deleteMany({ clientId: client.clientId })
  await ClientNotification.deleteMany({ clientId: client.clientId })
  await ClientMessage.deleteMany({ clientId: client.clientId })
  await ClientAnnouncement.deleteMany({ clientId: client.clientId })
  await User.deleteOne({ role: 'Client', clientId: client.clientId })
  emitResource('clients', 'remove', { clientId: client.clientId })
  res.json({ ok: true })
})

// Opt2: assignProject now links Project.clientId instead of ClientProject.clientId
export const assignProject = asyncHandler(async (req, res) => {
  const clientId = req.params.id
  const rawProjectId = req.body.projectId
  if (!rawProjectId) throw new ApiError(400, 'projectId is required')
  let project = null
  if (mongoose.isValidObjectId(rawProjectId)) {
    project = await Project.findByIdAndUpdate(rawProjectId, { clientId }, { new: true })
  } else if (String(rawProjectId).startsWith('cp-')) {
    // legacy cp-* -> translate via ClientProject mirror
    const cp = await ClientProject.findOne({ projectId: rawProjectId }).lean()
    if (cp?.sourceProjectId) {
      project = await Project.findByIdAndUpdate(cp.sourceProjectId, { clientId }, { new: true })
      // also keep mirror in sync
      await ClientProject.findOneAndUpdate({ projectId: rawProjectId }, { clientId }, { new: true }).catch(()=>{})
    } else {
      const cpUpd = await ClientProject.findOneAndUpdate({ projectId: rawProjectId }, { clientId }, { new: true })
      if (!cpUpd) throw new ApiError(404, 'Project not found')
      return res.json(cpUpd)
    }
  } else {
    project = await Project.findOneAndUpdate({ code: String(rawProjectId).toUpperCase() }, { clientId }, { new: true })
  }
  if (!project) throw new ApiError(404, 'Project not found')
  // keep legacy mirror sync if exists
  try { await ClientProject.findOneAndUpdate({ sourceProjectId: project._id }, { clientId }).catch(()=>{}) } catch {}
  // also update string cache
  const client = await Client.findOne({ clientId }).lean()
  if (client?.company && project.client !== client.company) {
    project.client = client.company
    await project.save()
  }
  emitToClient(clientId, 'client:project', { action: 'assigned', project })
  res.json(project)
})

export const assignProjectManager = asyncHandler(async (req, res) => {
  // Prefer Project.lead, fallback to legacy
  const rawId = req.params.id
  let p = null
  if (mongoose.isValidObjectId(rawId)) {
    p = await Project.findByIdAndUpdate(rawId, { lead: req.body.manager }, { new: true })
  }
  if (p) {
    emitToClient(p.clientId, 'client:project', { action: 'manager', project: p })
    return res.json(p)
  }
  // legacy
  const cp = await ClientProject.findOneAndUpdate(
    { projectId: rawId }, { projectManager: req.body.manager }, { new: true }
  )
  if (!cp) throw new ApiError(404, 'Project not found')
  emitToClient(cp.clientId, 'client:project', { action: 'manager', project: cp })
  res.json(cp)
})

export const assignTeam = asyncHandler(async (req, res) => {
  const rawId = req.params.id
  const members = dedupeTeam(req.body.members || [])
  // Project expects members: [{name, role}]
  const projectMembers = members.map(m => ({ name: m.name, role: m.roleInProject || m.role || 'Member', avatar: m.avatar || '' }))
  let p = null
  if (mongoose.isValidObjectId(rawId)) {
    p = await Project.findByIdAndUpdate(rawId, { members: projectMembers }, { new: true })
  }
  if (p) {
    emitToClient(p.clientId, 'client:project', { action: 'team', project: p })
    return res.json(p)
  }
  const cp = await ClientProject.findOneAndUpdate(
    { projectId: rawId }, { team: members }, { new: true }
  )
  if (!cp) throw new ApiError(404, 'Project not found')
  emitToClient(cp.clientId, 'client:project', { action: 'team', project: cp })
  res.json(cp)
})

export const updateProjectProgress = asyncHandler(async (req, res) => {
  const progress = Math.max(0, Math.min(100, Number(req.body.progress || 0)))
  const rawId = req.params.id
  let p = null
  if (mongoose.isValidObjectId(rawId)) {
    p = await Project.findByIdAndUpdate(rawId, { progress }, { new: true })
  }
  if (p) {
    emitToClient(p.clientId, 'client:project', { action: 'progress', project: p })
    return res.json(p)
  }
  const cp = await ClientProject.findOneAndUpdate(
    { projectId: rawId }, { progress }, { new: true }
  )
  if (!cp) throw new ApiError(404, 'Project not found')
  emitToClient(cp.clientId, 'client:project', { action: 'progress', project: cp })
  res.json(cp)
})

export const generateInvoice = asyncHandler(async (req, res) => {
  const rawId = req.params.id
  // Try Project path first
  let project = null
  if (mongoose.isValidObjectId(rawId)) project = await Project.findById(rawId).lean()
  if (project) {
    // Create legacy payment entry via mirror if exists, else directly in ClientProject legacy for that project
    let cp = await ClientProject.findOne({ sourceProjectId: project._id })
    if (!cp) {
      // ensure mirror exists for legacy UI that still reads ClientProject.payments
      cp = await ClientProject.findOne({ clientId: project.clientId, name: project.name }).catch(()=>null)
    }
    if (cp) {
      const rec = {
        invoice: req.body.invoice || `INV-${project.code || String(project._id).slice(-6).toUpperCase()}-${Date.now()}`,
        amount: Number(req.body.amount || 0),
        paid: Number(req.body.paid || 0),
        status: req.body.status || 'Pending',
        date: req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        method: req.body.method || 'Bank Transfer',
      }
      cp.payments.push(rec)
      if (rec.status === 'Pending') {
        await ClientNotification.create({
          clientId: cp.clientId,
          title: 'New Invoice Generated',
          body: `Invoice ${rec.invoice} for ₹${rec.amount.toLocaleString('en-IN')} raised.`,
          at: new Date().toISOString(),
          icon: 'invoice',
        })
      }
      await cp.save()
      emitToClient(cp.clientId, 'client:invoice', { project: cp, invoice: rec })
      return res.json(rec)
    }
  }
  // legacy fallback
  const p = await ClientProject.findOne({ projectId: rawId })
  if (!p) throw new ApiError(404, 'Project not found')
  const rec = {
    invoice: req.body.invoice || `INV-${p.projectId.toUpperCase()}-${Date.now()}`,
    amount: Number(req.body.amount || 0),
    paid: Number(req.body.paid || 0),
    status: req.body.status || 'Pending',
    date: req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
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
  const rawId = req.params.id
  let project = null
  if (mongoose.isValidObjectId(rawId)) project = await Project.findById(rawId).lean()
  if (project) {
    let cp = await ClientProject.findOne({ sourceProjectId: project._id })
    if (cp) {
      const pay = cp.payments.id(req.params.paymentId)
      if (!pay) throw new ApiError(404, 'Payment not found')
      Object.assign(pay, req.body)
      await cp.save()
      emitToClient(cp.clientId, 'client:invoice', { project: cp, invoice: pay })
      return res.json(pay)
    }
  }
  const p = await ClientProject.findOne({ projectId: rawId })
  if (!p) throw new ApiError(404, 'Project not found')
  const pay = p.payments.id(req.params.paymentId)
  if (!pay) throw new ApiError(404, 'Payment not found')
  Object.assign(pay, req.body)
  await p.save()
  emitToClient(p.clientId, 'client:invoice', { project: p, invoice: pay })
  res.json(pay)
})

export const uploadDocument = asyncHandler(async (req, res) => {
  const rawId = req.params.id
  let project = null
  if (mongoose.isValidObjectId(rawId)) project = await Project.findById(rawId).lean()
  if (project) {
    const doc = { ...req.body, uploadedAt: req.body.uploadedAt || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }
    // also create ProjectFile for unified doc store
    try {
      await ProjectFile.create({ project: project._id, name: doc.name, type: doc.type || 'file', size: 0, url: doc.url || '', uploadedBy: doc.uploadedBy || 'Admin' })
    } catch {}
    let cp = await ClientProject.findOne({ sourceProjectId: project._id })
    if (cp) {
      cp.documents.push(doc)
      await cp.save()
      emitToClient(cp.clientId, 'client:document', { project: cp, document: doc })
      await ClientNotification.create({
        clientId: cp.clientId, title: 'New document uploaded',
        body: `${doc.uploadedBy || 'Your project team'} uploaded "${doc.name}" to ${cp.name}`,
        at: new Date().toISOString(), icon: 'document',
      })
      emitToClient(cp.clientId, 'client:notification', { clientId: cp.clientId })
      return res.json(doc)
    }
    emitToClient(project.clientId, 'client:document', { project, document: doc })
    return res.json(doc)
  }
  const p = await ClientProject.findOne({ projectId: rawId })
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = { ...req.body, uploadedAt: req.body.uploadedAt || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }
  p.documents.push(doc)
  await p.save()
  emitToClient(p.clientId, 'client:document', { project: p, document: doc })
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

export const adminListMessages = asyncHandler(async (req, res) => {
  const rows = await ClientMessage.find({ clientId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(rows)
})

export const adminReplyMessage = asyncHandler(async (req, res) => {
  const thread = await ClientMessage.findById(req.params.id)
  if (!thread) throw new ApiError(404, 'Conversation not found')
  const from = req.user?.name || 'Skew Team'
  const msg = { from, at: new Date().toISOString(), text: req.body.text || '' }
  thread.messages.push(msg)
  await thread.save()
  emitToClient(thread.clientId, 'client:message', { threadId: thread._id, message: msg })
  await ClientNotification.create({
    clientId: thread.clientId, title: 'New reply from your team',
    body: `${from}: ${(msg.text || '').slice(0, 80)}`, at: new Date().toISOString(), icon: 'message',
  })
  emitToClient(thread.clientId, 'client:notification', { clientId: thread.clientId })
  res.json(thread)
})

export const getProjectComments = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const pid = resolved.project ? String(resolved.project._id) : String(resolved.legacy.sourceProjectId || '')
  if (!pid) return res.json([])
  const rows = await projectSvc.comments({ project: pid })
  res.json(rows)
})

export const addProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const pid = resolved.project ? String(resolved.project._id) : String(resolved.legacy.sourceProjectId || '')
  if (!pid) throw new ApiError(409, 'This project is not linked to an internal project yet. Ask your account manager to re-save it.')
  const body = String(req.body?.body || '').trim()
  if (!body) throw new ApiError(400, 'Comment cannot be empty')

  const author = req.user?.name || 'Client'
  const comment = await projectSvc.addComment(
    { project: pid, task: null, body, viaClientPortal: true },
    author,
  )
  const emitPid = resolved.project ? String(resolved.project._id) : resolved.legacy.projectId
  emitToClient(clientId, 'client:project-comment', { projectId: emitPid, comment })

  const teamNames = resolved.project ? dedupeTeam(buildProjectTeam(resolved.project)).map(t=>t.name) : [...new Set((resolved.legacy.team || []).map((t) => t.name).filter(Boolean))]
  if (teamNames.length) {
    const members = await User.find({ name: { $in: teamNames }, role: { $ne: 'Client' } }).select('email').lean()
    if (members.length) {
      await Notification.insertMany(members.map((m) => ({
        recipient: m.email,
        type: 'project',
        title: `New client comment on ${resolved.project ? resolved.project.name : resolved.legacy.name}`,
        body: `${author}: ${body.slice(0, 80)}`,
        sender: author,
      })))
    }
  }

  res.status(201).json(comment)
})

export const updateProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const body = String(req.body?.body || '').trim()
  if (!body) throw new ApiError(400, 'Comment cannot be empty')
  const author = req.user?.name || 'Client'
  const comment = await projectSvc.updateComment(req.params.commentId, { body }, author)
  const emitPid = resolved.project ? String(resolved.project._id) : resolved.legacy.projectId
  emitToClient(clientId, 'client:project-comment', { projectId: emitPid, comment })
  res.json(comment)
})

export const deleteProjectComment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const author = req.user?.name || 'Client'
  await projectSvc.deleteComment(req.params.commentId, author, req.user?.role)
  const emitPid = resolved.project ? String(resolved.project._id) : resolved.legacy.projectId
  emitToClient(clientId, 'client:project-comment', { projectId: emitPid, deletedId: req.params.commentId })
  res.json({ deleted: true })
})

export const uploadCommentAttachment = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const pid = resolved.project ? String(resolved.project._id) : String(resolved.legacy.sourceProjectId || '')
  if (!pid) throw new ApiError(409, 'This project is not linked to an internal project yet.')
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  const author = req.user?.name || 'Client'
  const file = await projectSvc.addFile(
    { project: pid, name: req.file.originalname, url: `/uploads/${req.file.filename}`, size: req.file.size },
    author,
  )
  res.status(201).json({ fileId: file._id || file.id, name: file.name, url: file.url, size: file.size })
})

export const uploadClientDocument = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  const uploader = req.user?.name || 'Client'
  const doc = {
    name: req.file.originalname,
    type: String(req.body?.category || 'Other'),
    size: `${(req.file.size / 1024).toFixed(1)} KB`,
    uploadedBy: uploader,
    uploadedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    url: `/uploads/${req.file.filename}`,
  }
  if (resolved.project) {
    // store in ProjectFile + mirror to legacy activity for backward compat
    try { await ProjectFile.create({ project: resolved.project._id, name: doc.name, type: doc.type, size: req.file.size, url: doc.url, uploadedBy: uploader }) } catch {}
    if (resolved.legacy) {
      resolved.legacy.documents || (resolved.legacy.documents = [])
      // need to push via model update
      await ClientProject.findOneAndUpdate({ _id: resolved.legacy._id }, { $push: { documents: doc, activity: { text: `${uploader} uploaded document "${doc.name}"`, at: new Date().toISOString(), by: uploader } } }).catch(()=>{})
    } else {
      await ProjectActivity.create({ project: resolved.project._id, actor: uploader, action: `uploaded document "${doc.name}"`, target: doc.name }).catch(()=>{})
    }
    emitToClient(clientId, 'client:document', { project: resolved.project, document: doc })
    const teamNames = dedupeTeam(buildProjectTeam(resolved.project)).map(t=>t.name).filter(Boolean)
    if (teamNames.length) {
      const members = await User.find({ name: { $in: teamNames }, role: { $ne: 'Client' } }).select('email').lean()
      if (members.length) {
        await Notification.insertMany(members.map((m) => ({
          recipient: m.email, type: 'project', title: `New document on ${resolved.project.name}`,
          body: `${uploader} uploaded "${doc.name}"`, sender: uploader,
        })))
      }
    }
    return res.status(201).json(doc)
  }
  // legacy only
  const p = await ClientProject.findOne({ projectId: resolved.legacy.projectId, clientId })
  p.documents.push(doc)
  p.activity.push({ text: `${uploader} uploaded document "${doc.name}"`, at: new Date().toISOString(), by: uploader })
  await p.save()
  emitToClient(clientId, 'client:document', { project: p, document: doc })
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
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  if (resolved.project) {
    // Try ProjectFile first
    const pf = await ProjectFile.findOne({ project: resolved.project._id, _id: req.params.docId }).catch(()=>null)
    if (pf) {
      if (pf.uploadedBy !== (req.user?.name || '') && !PROJECT_FULL_ACCESS.includes(req.user?.role)) {
        throw new ApiError(403, 'You can only delete documents you uploaded')
      }
      await pf.deleteOne()
      if (resolved.legacy) {
        const cpDoc = resolved.legacy.documents?.find(d => String(d._id) === req.params.docId)
        if (cpDoc) await ClientProject.updateOne({ _id: resolved.legacy._id }, { $pull: { documents: { _id: req.params.docId } } }).catch(()=>{})
      }
      emitToClient(clientId, 'client:document', { project: resolved.project, deletedId: req.params.docId })
      return res.json({ deleted: true })
    }
    // fallback legacy embedded
    if (resolved.legacy) {
      const doc = resolved.legacy.documents?.find(d => String(d._id) === req.params.docId)
      if (!doc) throw new ApiError(404, 'Document not found')
      if (doc.uploadedBy !== (req.user?.name || '')) throw new ApiError(403, 'You can only delete documents you uploaded')
      await ClientProject.updateOne({ _id: resolved.legacy._id }, { $pull: { documents: { _id: req.params.docId } } })
      emitToClient(clientId, 'client:document', { project: resolved.project, deletedId: req.params.docId })
      return res.json({ deleted: true })
    }
    throw new ApiError(404, 'Document not found')
  }
  const p = await ClientProject.findOne({ projectId: resolved.legacy.projectId, clientId })
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = p.documents.id(req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
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
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  if (resolved.project) {
    let doc = await ProjectFile.findOne({ project: resolved.project._id, _id: req.params.docId }).lean().catch(()=>null)
    if (doc) {
      const uploadsRoot = path.resolve(process.cwd(), 'uploads')
      const abs = path.resolve(process.cwd(), '.' + doc.url)
      if (!abs.startsWith(uploadsRoot)) throw new ApiError(400, 'Invalid file path')
      return res.download(abs, doc.name)
    }
    if (resolved.legacy) {
      doc = (resolved.legacy.documents || []).find((d) => String(d._id) === req.params.docId)
      if (doc) {
        const uploadsRoot = path.resolve(process.cwd(), 'uploads')
        const abs = path.resolve(process.cwd(), '.' + doc.url)
        if (!abs.startsWith(uploadsRoot)) throw new ApiError(400, 'Invalid file path')
        return res.download(abs, doc.name)
      }
    }
    throw new ApiError(404, 'Document not found')
  }
  const p = await ClientProject.findOne({ projectId: resolved.legacy.projectId, clientId }).lean()
  if (!p) throw new ApiError(404, 'Project not found')
  const doc = (p.documents || []).find((d) => String(d._id) === req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  const uploadsRoot = path.resolve(process.cwd(), 'uploads')
  const abs = path.resolve(process.cwd(), '.' + doc.url)
  if (!abs.startsWith(uploadsRoot)) throw new ApiError(400, 'Invalid file path')
  res.download(abs, doc.name)
})

export const getProjectTaskHistory = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  const pid = resolved.project ? String(resolved.project._id) : String(resolved.legacy.sourceProjectId || '')
  if (!pid) return res.json([])
  const rows = await projectSvc.taskHistory(
    { project: pid },
    req.user,
    { ownershipVerified: true },
  )
  res.json(rows)
})

export const getProjectProgress = asyncHandler(async (req, res) => {
  const clientId = requireClientId(req)
  const resolved = await resolvePortalProject(clientId, req.params.id)
  if (!resolved || (!resolved.project && !resolved.legacy)) throw new ApiError(404, 'Project not found')
  if (resolved.project) {
    const [tasks, milestones] = await Promise.all([
      ProjectTask.find({ project: resolved.project._id }).lean(),
      Milestone.find({ project: resolved.project._id }).lean(),
    ])
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const completedTasks = tasks.filter((t) => t.status === 'Done').length
    const pendingTasks = tasks.filter((t) => t.status !== 'Done').length
    const overdueTasks = tasks.filter((t) => t.status !== 'Done' && t.dueDate && t.dueDate < today).length
    const openIssues = tasks.filter((t) => t.type === 'Bug' && t.status !== 'Done').length
    // timeline from live or legacy
    let stages = []
    try { stages = resolved.legacy?.timeline?.length ? resolved.legacy.timeline : buildTimelineStages(resolved.project, tasks, []) } catch { stages = resolved.legacy?.timeline || [] }
    const doneStages = stages.filter((s) => s.status === 'Completed' || s.status === 'Done').length
    const timelinePercent = stages.length ? Math.round((doneStages / stages.length) * 100) : 0
    const overallProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : (resolved.project.progress || 0)
    // latest activity from ProjectActivity
    let latestActivity = null
    try {
      const act = await ProjectActivity.findOne({ project: resolved.project._id }).sort({ createdAt: -1 }).lean()
      if (act) latestActivity = { text: act.action, at: act.createdAt, by: act.actor }
      else if (resolved.legacy?.activity?.length) latestActivity = (resolved.legacy.activity || []).slice(-1)[0]
    } catch { latestActivity = (resolved.legacy?.activity || []).slice(-1)[0] || null }
    return res.json({
      overallProgress,
      completedTasks,
      pendingTasks,
      overdueTasks,
      milestones: milestones.map((m) => ({ title: m.title, status: m.status, progress: m.progress, dueDate: m.dueDate })),
      timelinePercent,
      openIssues,
      latestActivity,
    })
  }
  // legacy only fallback
  const cp = resolved.legacy
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
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const completedTasks = tasks.filter((t) => t.status === 'Done').length
  const pendingTasks = tasks.filter((t) => t.status !== 'Done').length
  const overdueTasks = tasks.filter((t) => t.status !== 'Done' && t.dueDate && t.dueDate < today).length
  const openIssues = tasks.filter((t) => t.type === 'Bug' && t.status !== 'Done').length
  const stages = cp.timeline || []
  const doneStages = stages.filter((s) => s.status === 'Completed' || s.status === 'Done').length
  const timelinePercent = stages.length ? Math.round((doneStages / stages.length) * 100) : 0
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
