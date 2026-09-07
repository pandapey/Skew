import { CalendarEvent } from '../models/calendarModels.js'
import { crudController } from './crudController.js'
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { Project } from '../models/projectModels.js'
import { ClientNotification, ClientProject, Client } from '../models/clientModels.js'
import { PROJECT_FULL_ACCESS, accessibleProjectFilter, isProjectLead } from '../services/projectService.js'
import { emitToClient } from '../realtime/index.js'
import { ApiError } from '../utils/asyncHandler.js'
import { User } from '../models/User.js'
import { notifyUsersByName, notifyUsersByEmail } from '../services/notificationService.js'
import { meetingDateRejection, deriveMeetingEnd } from '../services/meetingRules.js'

const base = crudController(CalendarEvent)

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

export async function resolveMeetingClientId(doc) {
  if (!doc) return null
  if (doc.clientId) return doc.clientId
  if (!doc.projectId) return null

  // Opt2: Project.clientId is primary source; keep mirror as fallback
  try {
    const project = await Project.findById(doc.projectId).select('clientId client').lean()
    if (project?.clientId) {
      if (doc.clientId !== project.clientId) {
        doc.clientId = project.clientId
        await doc.save().catch(()=>{})
      }
      return project.clientId
    }
    if (project?.client) {
      const company = String(project.client || '').trim()
      if (company) {
        const client = await Client.findOne({
          company: { $regex: new RegExp(`^${escapeRegex(company)}$`, 'i') },
        }).select('clientId').lean()
        if (client?.clientId) {
          doc.clientId = client.clientId
          await doc.save().catch(()=>{})
          return client.clientId
        }
      }
    }
  } catch {}

  const mirrored = await ClientProject.findOne({ sourceProjectId: doc.projectId }).select('clientId').lean()
  let clientId = mirrored?.clientId || null

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

  if (clientId && doc.clientId !== clientId) {
    doc.clientId = clientId
    await doc.save()
  }
  return clientId
}

async function notifyClientOfMeeting(doc, { title, body }) {
  const clientId = await resolveMeetingClientId(doc)
  if (!clientId) return false
  emitToClient(clientId, 'calendar:meeting-status', { id: doc.id, status: doc.meetingStatus })
  await ClientNotification.create({ clientId, title, body, link: '/client/meetings' })
  return true
}

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

export async function assertCanManageMeeting(doc, user) {
  if (doc.type !== 'meeting' || !doc.meetingStatus) {
    throw new ApiError(400, 'This event is not a client meeting request')
  }

  if (doc.requestedBy === 'staff') {
    throw new ApiError(403, 'This meeting was requested from the client; only the client can respond')
  }

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

  create: async (req, res) => {
    await assertCanCreate(req)

    const isMeetingRequest = req.body?.type === 'meeting' && Boolean(req.body?.meetingStatus)

    if (isMeetingRequest) {
      const rejection = await meetingDateRejection(req.body?.start)
      if (rejection) throw new ApiError(400, rejection)
    }

    const doc = await CalendarEvent.create({
      ...req.body,
      end: req.body?.end || (isMeetingRequest ? deriveMeetingEnd(req.body?.start) : req.body?.end),
      createdBy: req.body?.createdBy || req.user?.name || req.user?.email || null,
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

  range: async (req, res) => {
    const { from, to } = req.query
    const filter = {}
    if (from) filter.end = { $gte: new Date(from) }
    if (to) filter.start = { $lte: new Date(to) }
    const scope = await meetingVisibilityFilter(req.user)
    const docs = await CalendarEvent.find(withMeetingScope(filter, scope)).sort({ start: 1 })
    res.json(docs)
  },

  toggleDone: async (req, res) => {
    const doc = await CalendarEvent.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Event not found' })
    doc.done = !doc.done
    await doc.save()
    res.json(doc)
  },

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

    await notifyClientOfMeeting(doc, {
      title: `Meeting ${status.toLowerCase()}`,
      body: `Your meeting request "${doc.title}" was ${status.toLowerCase()}.`,
    })

    res.json(doc)
  },

  rescheduleMeeting: async (req, res) => {
    const { start, end } = req.body
    if (!start) throw new ApiError(400, 'A new start date and time is required')
    const startAt = new Date(start)
    if (Number.isNaN(startAt.getTime())) throw new ApiError(400, 'The new start date and time is not valid')
    const endAt = end ? new Date(end) : null
    if (end && Number.isNaN(endAt.getTime())) throw new ApiError(400, 'The new end date and time is not valid')
    if (endAt && endAt < startAt) throw new ApiError(400, 'The meeting cannot end before it starts')
    const rejection = await meetingDateRejection(start)
    if (rejection) throw new ApiError(400, rejection)

    const doc = await CalendarEvent.findById(req.params.id)
    if (!doc) throw new ApiError(404, 'Event not found')
    await assertCanManageMeeting(doc, req.user)

    doc.start = startAt
    if (endAt) doc.end = endAt
    doc.meetingStatus = 'Pending'
    await doc.save()

    await notifyClientOfMeeting(doc, {
      title: 'Meeting rescheduled',
      body: `Your meeting request "${doc.title}" was moved to a new time and is awaiting your confirmation.`,
    })

    res.json(doc)
  },
}
