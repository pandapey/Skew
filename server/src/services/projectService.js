import {
  Project, Sprint, ProjectTask, Milestone,
  ProjectComment, ProjectFile, ProjectActivity,
} from '../models/projectModels.js'
import mongoose from 'mongoose'
import { Client, ClientProject, ClientNotification } from '../models/clientModels.js'
import { Transaction } from '../models/financeModels.js'
import { provisionClientLogin } from './clientLoginService.js'
import { ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit } from '../utils/query.js'
import { User } from '../models/User.js'
import { notifyUsersByName } from './notificationService.js'
import { emitToClient } from '../realtime/index.js'
import { buildProjectTeam } from '../utils/team.js'

export const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)
export const withIds = (docs) => docs.map(withId)

export async function resolveProjectRef(ref) {
  const value = String(ref || '').trim()
  if (!value) return null
  if (mongoose.isValidObjectId(value)) {
    try {
      return await Project.findById(value).lean()
    } catch {
      return null
    }
  }
  return Project.findOne({ code: value.toUpperCase() }).lean()
}

const TASK_STATUSES = ['Todo', 'In Progress', 'Review', 'Done']

export const PROJECT_FULL_ACCESS = ['Admin', 'Manager']

export const TASK_ASSIGNEE_ROLES = ['Admin', 'Manager', 'Employee']

export function projectScopeFilter(user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return {}
  return { $or: [{ lead: user.name }, { 'members.name': user.name }] }
}

export function canAccessProject(project, user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return true
  const name = user?.name
  return project.lead === name || (project.members || []).some((m) => m.name === name)
}

export async function hasProjectAccess(project, user) {
  if (canAccessProject(project, user)) return true
  if (!user?.name) return false
  const assigned = await ProjectTask.exists({ project: project._id, assignee: user.name })
  return !!assigned
}

export async function accessibleProjectFilter(user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return {}
  const taskProjectIds = await ProjectTask.find({ assignee: user.name }).distinct('project')
  const or = [{ lead: user.name }, { 'members.name': user.name }]
  if (taskProjectIds.length) or.push({ _id: { $in: taskProjectIds } })
  return { $or: or }
}

export async function projectQueryScope(query = {}, user) {
  const requested = scalarOrNull(query.project)
  if (requested != null) {
    const project = await Project.findById(requested).lean().catch(() => null)
    if (!project) throw new ApiError(404, 'Project not found')
    if (!(await hasProjectAccess(project, user))) {
      throw new ApiError(403, 'You do not have access to this project')
    }
    return { project: requested }
  }
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return {}
  const ids = await Project.find(await accessibleProjectFilter(user)).distinct('_id')
  return { project: { $in: ids } }
}

const notifyByName = notifyUsersByName

export function projectAssigneePool(project) {
  return [...new Set([
    project.lead,
    ...((project.members || []).map((m) => m.name)),
  ].filter(Boolean))]
}

export function isProjectLead(project, user) {
  return Boolean(user?.name) && project?.lead === user.name
}

async function assertCanAssign(project, assignee, user) {
  if (!assignee) throw new ApiError(422, 'An assignee is required')

  const target = await User.findOne({ name: assignee }).select('role status').lean()
  if (!target || target.status !== 'Active') {
    throw new ApiError(422, 'Assignee must be an active internal user')
  }
  if (!TASK_ASSIGNEE_ROLES.includes(target.role)) {
    throw new ApiError(403, 'Tasks can only be assigned to internal users')
  }
}

function notify(to, subject, body) {
}

export async function notifyClientForProject(sourceProjectId, { title, body, icon = 'update' } = {}) {
  if (!sourceProjectId) return null
  const cp = await ClientProject.findOne({ sourceProjectId }).lean()
  if (!cp) return null
  const n = await ClientNotification.create({
    clientId: cp.clientId, title, body, at: new Date().toISOString(), icon,
  })
  emitToClient(cp.clientId, 'client:notification', n)
  return n
}

async function enrichComments(rows) {
  if (!rows.length) return rows
  const names = [...new Set(rows.map((r) => r.author).filter(Boolean))]
  const users = await User.find({ name: { $in: names } }).select('name role avatar').lean()
  const byName = Object.fromEntries(users.map((u) => [u.name, u]))
  return rows.map((r) => ({
    ...r,
    role: byName[r.author]?.role || (r.viaClientPortal ? 'Client' : null),
    avatar: byName[r.author]?.avatar || '',
  }))
}

export async function logActivity(project, actor, action, target, meta) {
  await ProjectActivity.create({ project, actor, action, target, meta })
}

function pushHistory(task, event, by, extra = {}) {
  if (!task) return
  if (!Array.isArray(task.history)) task.history = []
  task.history.push({
    event,
    by: by || 'System',
    at: new Date(),
    from: extra.from ?? null,
    to: extra.to ?? null,
    comment: extra.comment ?? null,
  })
}

export function pausedSeconds(task, until = null) {
  let total = 0
  const start = task.startedAt ? new Date(task.startedAt).getTime() : 0
  for (const iv of task.pauseIntervals || []) {
    const from = Math.max(new Date(iv.from).getTime(), start)
    const to = iv.to ? new Date(iv.to).getTime() : (until ? new Date(until).getTime() : Date.now())
    if (to > from) total += to - from
  }
  return total
}

export function activeSeconds(task, until = null) {
  if (!task.startedAt) return 0
  const end = until ? new Date(until).getTime() : Date.now()
  const start = new Date(task.startedAt).getTime()
  return Math.max(0, Math.round((end - start) / 1000) - Math.round(pausedSeconds(task, until) / 1000))
}

export const CLIENT_TIMELINE_STAGES = [
  'Project Created', 'Planning', 'Development', 'Testing', 'Review', 'Deployment', 'Completed',
]

const iso = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '')

export function buildTimelineStages(project, tasks = [], existing = []) {
  const prev = Object.fromEntries((existing || []).map((s) => [s.name, s]))
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'Done').length
  const started = tasks.filter((t) => t.status !== 'Todo').length
  const inTesting = tasks.filter((t) => t.status === 'Review').length
  const awaitingReview = tasks.filter((t) => t.submissionStatus === 'Submitted').length
  const allDone = total > 0 && done === total

  const isCompleted = project.status === 'Completed'
  const isHalted = project.status === 'On Hold' || project.status === 'Cancelled'
  const pastPlanning = project.status !== 'Planning'

  const createdOn = project.startDate || iso(project.createdAt)
  const completedOn = isCompleted ? iso(project.updatedAt) : ''

  const decide = (name) => {
    switch (name) {
      case 'Project Created':
        return { status: 'Completed', date: createdOn }
      case 'Planning':
        return pastPlanning
          ? { status: 'Completed', date: createdOn }
          : { status: isHalted ? 'Pending' : 'In Progress', date: '' }
      case 'Development':
        if (isCompleted || allDone) return { status: 'Completed', date: completedOn }
        return { status: !isHalted && started > 0 ? 'In Progress' : 'Pending', date: '' }
      case 'Testing':
        if (isCompleted || allDone) return { status: 'Completed', date: completedOn }
        return { status: !isHalted && inTesting > 0 ? 'In Progress' : 'Pending', date: '' }
      case 'Review':
        if (isCompleted || allDone) return { status: 'Completed', date: completedOn }
        return { status: !isHalted && awaitingReview > 0 ? 'In Progress' : 'Pending', date: '' }
      case 'Deployment':
        if (isCompleted) return { status: 'Completed', date: completedOn }
        return { status: !isHalted && allDone ? 'In Progress' : 'Pending', date: '' }
      case 'Completed':
        return isCompleted
          ? { status: 'Completed', date: completedOn }
          : { status: 'Pending', date: '' }
      default:
        return { status: 'Pending', date: '' }
    }
  }

  return CLIENT_TIMELINE_STAGES.map((name) => {
    const d = decide(name)
    return {
      name,
      status: d.status,
      date: d.date || prev[name]?.date || '',
      notes: prev[name]?.notes || '',
    }
  })
}

export async function syncProjectProgressToClient(projectId, progress, tasks) {
  const project = await Project.findById(projectId).lean()
  if (!project) return null
  const cp = await ClientProject.findOne({ sourceProjectId: project._id }).lean()
  if (!cp) return null
  const timeline = buildTimelineStages(project, tasks, cp.timeline)
  const updated = await ClientProject.findOneAndUpdate(
    { _id: cp._id },
    { $set: { progress, status: project.status || cp.status, timeline } },
    { new: true },
  ).lean()
  emitToClient(cp.clientId, 'client:project', { action: 'progress', project: updated })
  return updated
}

async function recomputeProgress(projectId) {
  const tasks = await ProjectTask.find({ project: projectId }).lean()
  const done = tasks.filter((t) => t.status === 'Done').length
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  await Project.findByIdAndUpdate(projectId, { progress })
  await syncProjectProgressToClient(projectId, progress, tasks).catch(() => {})
  return progress
}

export async function syncClientProject(project, actor = 'System') {
  if (!project.client && !project.clientId) return
  let clientRec = null
  if (project.clientId) {
    clientRec = await Client.findOne({ clientId: project.clientId }).lean()
  }
  if (!clientRec && project.client) {
    clientRec = await Client.findOne({ company: { $regex: new RegExp(`^${project.client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }).lean()
  }
  if (!clientRec) return
  // Opt2: ensure Project has FK clientId (backfill + mirror consistency)
  if (!project.clientId || project.clientId !== clientRec.clientId) {
    try { await Project.updateOne({ _id: project._id }, { $set: { clientId: clientRec.clientId, client: clientRec.company } }) } catch {}
    project.clientId = clientRec.clientId
    project.client = clientRec.company
  }
  const cpProjectId = `cp-${String(project._id).slice(-6)}`
  const existingCp = await ClientProject.findOne({ projectId: cpProjectId }).lean()
  const teamMembers = buildProjectTeam(project)
  const cpData = {
    clientId: clientRec.clientId,
    sourceProjectId: project._id,
    name: project.name,
    code: project.code || '',
    status: project.status || 'Planning',
    progress: project.progress || 0,
    priority: project.priority || 'Medium',
    startDate: project.startDate || '',
    deliveryDate: project.deadline || '',
    budget: project.budget || 0,
    advancePayment: project.advancePayment || 0,
    monthlyDue: project.monthlyDue || 0,
    team: teamMembers,
  }
  const cpTasks = await ProjectTask.find({ project: project._id }).lean()
  cpData.timeline = buildTimelineStages(project, cpTasks, existingCp?.timeline)
  if (cpTasks.length) {
    cpData.progress = Math.round((cpTasks.filter((t) => t.status === 'Done').length / cpTasks.length) * 100)
  }
  if (existingCp) {
    await ClientProject.findOneAndUpdate({ projectId: cpProjectId }, { $set: cpData })
    if (existingCp.status !== 'Completed' && cpData.status === 'Completed') {
      await ClientNotification.create({
        clientId: clientRec.clientId,
        title: 'Project completed',
        body: `${project.name} has been marked as Completed.`,
        at: new Date().toISOString(),
        icon: 'delivery',
      })
      emitToClient(clientRec.clientId, 'client:notification', { clientId: clientRec.clientId })
    }

    emitToClient(clientRec.clientId, 'client:project', { action: 'update', projectId: cpProjectId })
  } else {
    await ClientProject.create({ ...cpData, projectId: cpProjectId })

    await ClientProject.findOneAndUpdate(
      { projectId: cpProjectId },
      { $push: { activity: { text: `Project created by ${actor}`, at: new Date().toISOString(), by: actor } } }
    )
  }
}
const withTaskViewerState = (task, uid) => {
  const json = { ...task }
  const viewedBy = Array.isArray(json.viewedBy) ? json.viewedBy : []
  delete json.viewedBy
  return { ...json, viewed: Boolean(uid) && viewedBy.includes(uid) }
}

export const projectService = {

  async listScoped(query, user) {
    const scope = await accessibleProjectFilter(user)
    const and = []
    if (scope.$or) and.push({ $or: scope.$or })
    const search = scalarOrNull(query.search)
    if (search) {
      const rx = { $regex: escapeRegex(String(search)), $options: 'i' }
      and.push({ $or: [{ name: rx }, { code: rx }, { client: rx }] })
    }
    for (const f of ['status', 'priority', 'lead']) {
      const v = scalarOrNull(query[f])
      if (v != null) and.push({ [f]: v })
    }
    const finalFilter = and.length ? { $and: and } : {}
    const page = Math.max(1, Number(query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 8))
    const sortBy = (typeof query.sortBy === 'string' && query.sortBy.trim()) || 'createdAt'
    const order = query.order === 'asc' ? 1 : -1
    const [rows, total] = await Promise.all([
      Project.find(finalFilter).sort({ [sortBy]: order }).skip((page - 1) * limit).limit(limit).lean(),
      Project.countDocuments(finalFilter),
    ])
    return { data: withIds(rows), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }
  },

  async allScoped(user) {
    return withIds(await Project.find(await accessibleProjectFilter(user)).sort({ createdAt: -1 }).lean())
  },

  async getScoped(id, user) {
    const project = await resolveProjectRef(id)
    if (!project) throw new ApiError(404, 'Project not found')
    if (!(await hasProjectAccess(project, user))) throw new ApiError(403, 'You do not have access to this project')
    return withId(project)
  },

  async calendarEvents(user) {
    const scope = await accessibleProjectFilter(user)
    const projects = await Project.find(scope).select('name startDate deadline color lead members').lean()
    const ids = projects.map((p) => p._id)
    const [milestones, tasks] = ids.length
      ? await Promise.all([
          Milestone.find({ project: { $in: ids } }).sort({ dueDate: 1 }).lean(),
          ProjectTask.find({ project: { $in: ids } }).select('title dueDate project priority status').lean(),
        ])
      : [[], []]
    const taskDeadlines = tasks.filter((t) => t.dueDate)
    return {
      projects: withIds(projects),
      milestones: withIds(milestones),
      taskDeadlines: withIds(taskDeadlines),
    }
  },

  async notifyProjectCreated(project, actor) {
    const names = [project.lead, ...((project.members || []).map((m) => m.name))].filter((n) => n && n !== actor)
    await notifyByName(names, {
      type: 'project', title: 'Added to a project',
      body: `${actor} created “${project.name}” and added you to the team.`,
      sender: actor, link: `/projects/${project.code || project._id}`,
    })
  },

  async notifyMembersChanged(before, after, actor) {
    const prev = new Set([before.lead, ...((before.members || []).map((m) => m.name))].filter(Boolean))
    const added = [after.lead, ...((after.members || []).map((m) => m.name))].filter((n) => n && !prev.has(n) && n !== actor)
    await notifyByName(added, {
      type: 'project', title: 'Added to a project',
      body: `${actor} added you to “${after.name}”.`,
      sender: actor, link: `/projects/${after.code || after._id}`,
    })
  },

  async moveTask(id, status, actor = 'System') {
    if (!TASK_STATUSES.includes(status)) throw new ApiError(422, 'Invalid status')
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    const from = task.status
    task.status = status
    if (status === 'Done') task.progress = 100
    await task.save()
    await recomputeProgress(task.project)
    await logActivity(task.project, actor, `moved "${task.title}" from ${from} to ${status}`, task.title)
    if (status === 'Done') notify('team@skew.com', 'Task completed', `${actor} completed "${task.title}"`)
    return withId(task.toObject())
  },

  async assignSprint(id, sprintId, actor = 'System') {
    const task = await ProjectTask.findByIdAndUpdate(id, { sprint: sprintId || null }, { new: true })
    if (!task) throw new ApiError(404, 'Task not found')
    await logActivity(task.project, actor, sprintId ? `added "${task.title}" to a sprint` : `moved "${task.title}" to backlog`, task.title)
    return withId(task.toObject())
  },

  async addTaskAttachment(id, file, body = {}, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (!file) throw new ApiError(400, 'No file uploaded')

    const project = await Project.findById(task.project).lean()
    const canAttach =
      PROJECT_FULL_ACCESS.includes(user?.role) ||
      user?.name === task.assignee ||
      user?.name === task.assignedBy ||
      isProjectLead(project, user)
    if (!canAttach) throw new ApiError(403, 'You do not have permission to attach files to this task')

    const kind = file.mimetype.startsWith('image/')
      ? 'image'
      : file.mimetype.startsWith('video/')
        ? 'video'
        : file.mimetype.startsWith('audio/')
          ? 'audio'
          : 'file'
    const record = await ProjectFile.create({
      project: task.project,
      name: file.originalname,
      type: kind,
      size: file.size,
      url: `/uploads/${file.filename}`,
      uploadedBy: user?.name || 'System',
    })
    const attachment = {
      fileId: record._id,
      name: record.name,
      url: record.url,
      size: record.size,
      type: kind,
    }
    task.attachments.push(attachment)
    await task.save()
    await logActivity(task.project, user?.name, `attached "${record.name}" to "${task.title}"`, task.title)
    return { ...attachment, id: String(record._id) }
  },

  async startTask(id, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only start a task that is assigned to you')
    }
    if (task.submissionStatus === 'Approved' || task.status === 'Done') {
      throw new ApiError(409, 'This task is already completed')
    }
    if (task.pausedAt) {
      throw new ApiError(409, 'This task is paused — resume it before starting again')
    }

    if (!task.startedAt) task.startedAt = new Date()
    if (task.status !== 'In Progress') task.status = 'In Progress'
    pushHistory(task, 'Started', user.name)
    await task.save()
    await logActivity(task.project, user.name, `started working on "${task.title}"`, task.title)
    return withId(task.toObject())
  },

  async pauseTask(id, { reason } = {}, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only pause a task that is assigned to you')
    }
    if (!task.startedAt) {
      throw new ApiError(409, 'This task has not been started yet')
    }
    if (task.pausedAt) {
      throw new ApiError(409, 'This task is already paused')
    }
    if (task.submissionStatus === 'Submitted' || task.submissionStatus === 'Approved' || task.status === 'Done') {
      throw new ApiError(409, 'This task is not running')
    }

    task.pausedAt = new Date()
    task.pauseIntervals.push({ from: task.pausedAt, to: null, reason: typeof reason === 'string' ? reason.trim() : '' })
    pushHistory(task, 'Paused', user.name, { comment: typeof reason === 'string' ? reason.trim() : null })
    await task.save()
    await logActivity(task.project, user.name, `paused "${task.title}"`, task.title)
    return withId(task.toObject())
  },

  async resumeTask(id, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only resume a task that is assigned to you')
    }
    if (!task.pausedAt) {
      throw new ApiError(409, 'This task is not paused')
    }

    const open = task.pauseIntervals.find((iv) => !iv.to)
    if (open) open.to = new Date()
    task.pausedAt = null
    pushHistory(task, 'Resumed', user.name)
    await task.save()
    await logActivity(task.project, user.name, `resumed "${task.title}"`, task.title)
    return withId(task.toObject())
  },

  async setTaskStatus(id, status, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only change the status of a task that is assigned to you')
    }
    if (task.submissionStatus === 'Submitted') {
      throw new ApiError(409, 'This task has been submitted and is awaiting review')
    }
    if (task.submissionStatus === 'Approved' || task.status === 'Done') {
      throw new ApiError(409, 'This task is already completed')
    }
    if (status === 'start') {
      if (task.pausedAt) {
        const open = task.pauseIntervals.find((iv) => !iv.to)
        if (open) open.to = new Date()
        task.pausedAt = null
        pushHistory(task, 'Resumed', user.name)
      } else {
        if (!task.startedAt) {
          task.startedAt = new Date()
          pushHistory(task, 'Started', user.name)
        }
      }
      if (task.status !== 'In Progress') task.status = 'In Progress'
    } else if (status === 'hold') {
      if (!task.startedAt) {
        throw new ApiError(409, 'This task has not been started yet')
      }
      if (task.pausedAt) {
        throw new ApiError(409, 'This task is already paused')
      }
      task.pausedAt = new Date()
      task.pauseIntervals.push({ from: task.pausedAt, to: null })
      pushHistory(task, 'Paused', user.name)
    } else if (status === 'pending') {
      task.startedAt = null
      task.completedAt = null
      task.durationSec = 0
      task.pausedAt = null
      task.pauseIntervals = []
      task.status = 'Todo'
    } else if (status === 'complete') {
      const now = new Date()
      const open = task.pauseIntervals.find((iv) => !iv.to)
      if (open) open.to = now
      task.pausedAt = null
      task.completedAt = now
      task.durationSec = task.startedAt ? activeSeconds(task, now) : 0
      const text = 'Completed — awaiting approval'
      const entry = { by: user.name, comment: text, at: new Date(), attachment: { fileId: null, name: null, url: null } }
      task.submission = entry
      task.submissionHistory.push(entry)
      task.submissionStatus = 'Submitted'
      if (task.status !== 'Done') task.status = 'Review'
      pushHistory(task, 'Submitted', user.name, { comment: text })
      await task.save()
      await recomputeProgress(task.project)
      await logActivity(task.project, user.name, `submitted "${task.title}" for review`, task.title)
      const project = await Project.findById(task.project).lean()
      const reviewer = task.assignedBy || project?.lead
      if (reviewer && reviewer !== user.name) {
        await notifyByName([reviewer], {
          type: 'task',
          title: 'Task Submitted',
          body: `${user.name} completed “${task.title}” and submitted it for your approval.`,
          sender: user.name,
          link: `/projects/${task.project}`,
          priority: 'high',
        })
      }
      return withId(task.toObject())
    } else {
      throw new ApiError(422, 'Invalid status — expected start, pending, hold or complete')
    }
    await task.save()
    await recomputeProgress(task.project)
    await logActivity(task.project, user.name, `marked "${task.title}" as ${status}`, task.title)
    return withId(task.toObject())
  },

  async listTaskAssignees() {
    return User.find({ role: { $in: TASK_ASSIGNEE_ROLES }, status: 'Active' })
      .select('name role designation avatar')
      .sort({ name: 1 })
      .lean()
  },

  async createTask(body, actor = 'System', user = null) {
    if (!body.project) throw new ApiError(422, 'project is required')
    const project = await Project.findById(body.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    if (user) await assertCanAssign(project, body.assignee, user)

    const { startedAt, completedAt, durationSec, pausedAt, pauseIntervals, history, ...clean } = body
    const task = await ProjectTask.create({
      ...clean,
      assignedBy: actor,
      reporter: body.reporter || actor,
      submissionStatus: 'Not Submitted',
    })

    if (task.assignee) {
      pushHistory(task, 'Assigned', actor, { to: task.assignee })
      await task.save()
    }
    await recomputeProgress(task.project)
    await logActivity(task.project, actor, `created ${task.type.toLowerCase()} "${task.title}"`, task.title)
    notify('team@skew.com', `New ${task.type}`, `${actor} created "${task.title}"`)

    if (task.assignee && task.assignee !== actor) {
      await notifyByName([task.assignee], {
        type: 'task',
        title: 'Task Assigned',
        body: `${actor} assigned you “${task.title}” in ${project.name}${task.dueDate ? ` (due ${task.dueDate})` : ''}.`,
        sender: actor,
        link: `/projects/${task.project}`,
        priority: task.priority === 'Urgent' ? 'high' : 'normal',
      })
    }
    return withId(task.toObject())
  },

  async updateTask(id, patch, actor = 'System', user = null) {
    const existing = await ProjectTask.findById(id).lean()
    if (!existing) throw new ApiError(404, 'Task not found')

    if (user) {
      const project = await Project.findById(existing.project).lean()
      if (!project) throw new ApiError(404, 'Project not found')
      const nextAssignee = patch.assignee !== undefined ? patch.assignee : existing.assignee
      await assertCanAssign(project, nextAssignee, user)
    }

    const { startedAt, completedAt, durationSec, pausedAt, pauseIntervals, history, ...safe } = patch
    const task = await ProjectTask.findByIdAndUpdate(id, safe, { new: true, runValidators: true })
    if (!task) throw new ApiError(404, 'Task not found')

    if (patch.assignee !== undefined && patch.assignee !== existing.assignee) {
      pushHistory(task, 'Reassigned', actor, { from: existing.assignee || null, to: patch.assignee || null })
      task.assignmentStatus = 'Reassigned'
      task.startedAt = null
      task.completedAt = null
      task.durationSec = 0
      task.pausedAt = null
      task.pauseIntervals = []
      await task.save()
    }
    await recomputeProgress(task.project)

    if (patch.assignee && patch.assignee !== existing.assignee && patch.assignee !== actor) {
      await notifyByName([patch.assignee], {
        type: 'task',
        title: 'Task Assigned',
        body: `${actor} assigned you “${task.title}”.`,
        sender: actor,
        link: `/projects/${task.project}`,
      })
    }
    return withId(task.toObject())
  },

  async submitTask(id, { comment, attachment } = {}, user) {
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) throw new ApiError(422, 'A comment is required when submitting a task')

    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')

    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only submit a task that is assigned to you')
    }
    if (task.submissionStatus === 'Submitted') {
      throw new ApiError(409, 'This task has already been submitted and is awaiting review')
    }
    if (task.submissionStatus === 'Approved') {
      throw new ApiError(409, 'This task has already been approved')
    }

    const project = await Project.findById(task.project).lean()

    let attachmentRef = { fileId: null, name: null, url: null }
    if (attachment?.name && attachment?.url) {
      const file = await ProjectFile.create({
        project: task.project,
        name: attachment.name,
        type: attachment.type || 'file',
        size: attachment.size || 0,
        url: attachment.url,
        uploadedBy: user.name,
      })
      attachmentRef = { fileId: file._id, name: file.name, url: file.url }
    }

    const entry = { by: user.name, comment: text, at: new Date(), attachment: attachmentRef }
    task.submission = entry
    task.submissionHistory.push(entry)
    task.submissionStatus = 'Submitted'
    const now = new Date()
    const open = task.pauseIntervals.find((iv) => !iv.to)
    if (open) open.to = now
    task.pausedAt = null
    task.completedAt = now
    task.durationSec = task.startedAt ? activeSeconds(task, now) : 0
    if (task.status !== 'Done') task.status = 'Review'
    pushHistory(task, 'Submitted', user.name, { comment: text })
    await task.save()

    await logActivity(task.project, user.name, `submitted "${task.title}" for review`, task.title)

    const reviewer = task.assignedBy || project?.lead
    if (reviewer && reviewer !== user.name) {
      await notifyByName([reviewer], {
        type: 'task',
        title: 'Task Submitted',
        body: `${user.name} submitted “${task.title}” for your review. Comment: ${text}`,
        sender: user.name,
        link: `/projects/${task.project}`,
        priority: 'high',
      })
    }
    return withId(task.toObject())
  },

  async reviewTask(id, action, { comment } = {}, user) {
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) throw new ApiError(422, 'A comment is required when approving or rejecting a task')

    const status = action === 'approve' ? 'Approved' : action === 'return' ? 'Returned' : 'Rejected'

    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.submissionStatus !== 'Submitted') {
      throw new ApiError(409, 'Only a submitted task can be reviewed')
    }

    const project = await Project.findById(task.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    const allowed =
      PROJECT_FULL_ACCESS.includes(user?.role) ||
      user?.name === task.assignedBy ||
      user?.name === task.assignee ||
      isProjectLead(project, user)
    if (!allowed) throw new ApiError(403, 'Only the project lead who assigned this task can review it')
    if (
      user?.name === task.submission?.by &&
      !PROJECT_FULL_ACCESS.includes(user?.role) &&
      user?.name !== task.assignee
    ) {
      throw new ApiError(403, 'You cannot review your own submission')
    }

    const entry = { reviewer: user.name, status, comment: text, at: new Date() }
    task.review = entry
    task.reviewHistory.push(entry)
    task.submissionStatus = status

    if (status === 'Approved') {
      task.status = 'Done'
      task.progress = 100
    } else {
      task.status = 'In Progress'
    }
    pushHistory(task, status, user.name, { comment: text })
    if (status === 'Approved') pushHistory(task, 'Completed', user.name)
    await task.save()
    await recomputeProgress(task.project)
    await logActivity(task.project, user.name, `${status.toLowerCase()} the submission for "${task.title}"`, task.title)
    await notifyClientForProject(task.project, {
      title: status === 'Approved' ? 'Task completed' : `Task ${status.toLowerCase()}`,
      body: `"${task.title}" was ${status.toLowerCase()} by ${user.name}.`,
      icon: status === 'Approved' ? 'delivery' : 'update',
    }).catch(() => {})

    const employee = task.submission?.by || task.assignee
    if (employee && employee !== user.name) {
      await notifyByName([employee], {
        type: 'task',
        title: `Task ${status}`,
        body: `${user.name} ${status.toLowerCase()} your submission for “${task.title}”. Comment: ${text}`,
        sender: user.name,
        link: `/projects/${task.project}`,
        priority: status === 'Rejected' ? 'high' : 'normal',
      })
    }
    return withId(task.toObject())
  },

  async reviewQueue(user) {
    const or = [{ assignedBy: user?.name }]
    const ledProjects = await Project.find({ lead: user?.name }).select('_id').lean()
    if (ledProjects.length) or.push({ project: { $in: ledProjects.map((p) => p._id) } })
    if (PROJECT_FULL_ACCESS.includes(user?.role)) {
      return withIds(await ProjectTask.find({ submissionStatus: 'Submitted' }).sort({ 'submission.at': -1 }).lean())
    }
    const rows = await ProjectTask.find({ submissionStatus: 'Submitted', $or: or })
      .sort({ 'submission.at': -1 })
      .lean()
    return withIds(rows)
  },

  async removeTask(id) {
    const task = await ProjectTask.findByIdAndDelete(id)
    if (!task) throw new ApiError(404, 'Task not found')
    await recomputeProgress(task.project)
    return { id }
  },

  async tasks(query, user) {
    const filter = {}
    for (const k of ['project', 'sprint', 'status', 'type', 'priority', 'assignee', 'assignedBy']) {
      const v = scalarOrNull(query[k])
      if (v != null) filter[k] = v
    }
    if (query.backlog === 'true') filter.sprint = null
    if (query.search) filter.$or = [
      { title: { $regex: escapeRegex(query.search), $options: 'i' } },
      { description: { $regex: escapeRegex(query.search), $options: 'i' } },
    ]

    const scope = await accessibleProjectFilter(user)
    if (scope.$or) {
      const ids = (await Project.find(scope).select('_id').lean()).map((p) => String(p._id))
      if (filter.project) {
        if (!ids.includes(String(filter.project))) return []
      } else {
        filter.project = { $in: ids }
      }
    }
    const rows = await ProjectTask.find(filter).sort({ order: 1, createdAt: -1 }).lean()
    const uid = String(user?._id || user?.id || '')
    return withIds(rows).map((r) => withTaskViewerState(r, uid))
  },

  async myTasksCount(user) {
    const uid = String(user?._id || user?.id || '')
    const filter = { assignee: user.name, viewedBy: { $ne: uid } }
    const scope = await accessibleProjectFilter(user)
    if (scope.$or) {
      const ids = (await Project.find(scope).select('_id').lean()).map((p) => String(p._id))
      filter.project = { $in: ids }
    }
    const count = await ProjectTask.countDocuments(filter)
    return { count }
  },

  async markTaskViewed(id, user) {
    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.assignee !== user?.name) {
      throw new ApiError(403, 'You can only mark a task that is assigned to you as viewed')
    }
    const uid = String(user?._id || user?.id || '')
    if (uid && !task.viewedBy.includes(uid)) {
      task.viewedBy.push(uid)
      await task.save()
    }

    return withTaskViewerState(withId(task.toObject()), uid)
  },

  async taskHistory(query, user, options = {}) {
    const filter = {}
    const project = scalarOrNull(query.project)
    if (project != null) filter.project = project

    const mine = String(query.mine ?? '') === 'true'
    const privileged = PROJECT_FULL_ACCESS.includes(user?.role)
    const ownershipVerified = options.ownershipVerified === true && project != null

    if (ownershipVerified) {
    } else if (mine || (!project && !privileged)) {
      filter.assignee = user?.name
    } else {
      const scope = await accessibleProjectFilter(user)
      if (scope.$or) {
        const ids = (await Project.find(scope).select('_id').lean()).map((p) => String(p._id))
        if (filter.project) {
          if (!ids.includes(String(filter.project))) {
            throw new ApiError(403, 'You do not have access to this project')
          }
        } else {
          filter.project = { $in: ids }
        }
      }
    }

    if (scalarOrNull(query.status) != null) filter.submissionStatus = query.status
    if (scalarOrNull(query.assignmentStatus) != null) filter.assignmentStatus = query.assignmentStatus

    const rows = await ProjectTask.find(filter).sort({ updatedAt: -1 }).lean()
    if (!rows.length) return []

    const projectIds = [...new Set(rows.map((r) => String(r.project)))]
    const taskIds = rows.map((r) => r._id)
    const [projects, commentRows] = await Promise.all([
      Project.find({ _id: { $in: projectIds } }).select('name').lean(),
      ProjectComment.find({ task: { $in: taskIds } }).sort({ createdAt: 1 }).lean(),
    ])
    const nameById = Object.fromEntries(projects.map((p) => [String(p._id), p.name]))
    const commentsByTask = {}
    for (const c of commentRows) {
      const k = String(c.task)
      if (!commentsByTask[k]) commentsByTask[k] = []
      commentsByTask[k].push({ by: c.author, body: c.body, at: c.createdAt, viaClientPortal: c.viaClientPortal })
    }

    const from = scalarOrNull(query.from)
    const to = scalarOrNull(query.to)
    const fromTs = from ? new Date(`${from}T00:00:00.000Z`).getTime() : null
    const toTs = to ? new Date(`${to}T23:59:59.999Z`).getTime() : null

    const out = []
    for (const row of rows) {
      let timeline = (row.history || []).map((h) => ({
        id: String(h._id || ''),
        event: h.event,
        by: h.by,
        at: h.at,
        from: h.from,
        to: h.to,
        comment: h.comment,
      }))
      if (fromTs != null) timeline = timeline.filter((h) => new Date(h.at).getTime() >= fromTs)
      if (toTs != null) timeline = timeline.filter((h) => new Date(h.at).getTime() <= toTs)
      if ((fromTs != null || toTs != null) && !timeline.length) continue
      timeline.sort((a, b) => new Date(a.at) - new Date(b.at))

      out.push({
        ...withTaskViewerState(withId(row), String(user?._id || user?.id || '')),
        projectName: nameById[String(row.project)] || null,
        timeline,
        pausedSec: Math.round(pausedSeconds(row) / 1000),
        comments: commentsByTask[String(row._id)] || [],
        submissionComments: (row.submissionHistory || []).map((s) => ({ by: s.by, comment: s.comment, at: s.at })),
        reviewComments: (row.reviewHistory || []).map((r) => ({ by: r.reviewer, status: r.status, comment: r.comment, at: r.at })),
      })
    }
    return out
  },

  async comments(query, user) {
    const filter = await projectQueryScope(query, user)
    const project = scalarOrNull(query.project)
    const task = scalarOrNull(query.task)
    if (task != null) {
      filter.task = task
    } else if (project != null) {
      filter.task = null
    }
    const rows = await ProjectComment.find(filter).sort({ createdAt: 1 }).lean()
    return withIds(await enrichComments(rows))
  },

  async addComment(body, actor, user = null) {
    if (user && body?.project) {
      await projectQueryScope({ project: body.project }, user)
    }
    const comment = await ProjectComment.create({ ...body, author: actor || body.author })
    if (body.project) await logActivity(body.project, comment.author, 'commented', body.taskTitle)

    if (body.task) {
      const task = await ProjectTask.findById(body.task).select('title assignee assignedBy project').lean()
      if (task) {
        const recipients = [...new Set([task.assignee, task.assignedBy].filter((n) => n && n !== comment.author))]
        if (recipients.length) {
          await notifyByName(recipients, {
            type: 'task',
            title: 'New task comment',
            body: `${comment.author} commented on “${task.title}”: ${(comment.body || '').slice(0, 80)}`,
            sender: comment.author,
            link: `/projects/${task.project}`,
          }).catch(() => {})
        }
      }
      return withId((await enrichComments([comment.toObject()]))[0])
    }

    if (body.project) {
      const project = await Project.findById(body.project).select('name lead members').lean()
      if (!body.viaClientPortal) {
        await notifyClientForProject(body.project, {
          title: 'New message from your project team',
          body: `${comment.author}: ${(comment.body || '').slice(0, 80)}`,
          icon: 'comment',
        }).catch(() => {})
      }
      if (project) {
        const memberNames = [...new Set([project.lead, ...(project.members || []).map((m) => m.name)].filter((n) => n && n !== comment.author))]
        if (memberNames.length) {
          await notifyByName(memberNames, {
            type: 'project',
            title: body.viaClientPortal ? 'New client comment' : 'New project comment',
            body: `${comment.author}: ${(comment.body || '').slice(0, 80)}`,
            sender: comment.author,
            link: `/projects/${body.project}`,
          }).catch(() => {})
        }
      }
    }
    return withId((await enrichComments([comment.toObject()]))[0])
  },

  async updateComment(id, body, actor) {
    const comment = await ProjectComment.findById(id)
    if (!comment) throw new ApiError(404, 'Comment not found')
    if (comment.author !== actor) throw new ApiError(403, 'You can only edit your own comment')
    comment.body = body
    comment.edited = true
    comment.editedAt = new Date()
    await comment.save()
    return withId((await enrichComments([comment.toObject()]))[0])
  },

  async deleteComment(id, actor, actorRole) {
    const comment = await ProjectComment.findById(id)
    if (!comment) throw new ApiError(404, 'Comment not found')
    if (comment.author !== actor && !PROJECT_FULL_ACCESS.includes(actorRole)) {
      throw new ApiError(403, 'You can only delete your own comment')
    }
    await ProjectComment.deleteOne({ _id: id })
    return { id: String(id) }
  },

  files: async (query, user) => withIds(
    await ProjectFile.find(await projectQueryScope(query, user)).sort({ createdAt: -1 }).lean()
  ),

  async addFile(body, actor) {
    const file = await ProjectFile.create({ ...body, uploadedBy: actor || body.uploadedBy })
    await logActivity(body.project, file.uploadedBy, `uploaded ${file.name}`, file.name)
    return withId(file.toObject())
  },

  activity: async (query, user) => withIds(
    await ProjectActivity.find(await projectQueryScope(query, user))
      .sort({ createdAt: -1 }).limit(clampLimit(query.limit, 50)).lean()
  ),

  sprints: async (query, user) => withIds(
    await Sprint.find(await projectQueryScope(query, user)).sort({ createdAt: -1 }).lean()
  ),

  milestones: async (query, user) => withIds(
    await Milestone.find(await projectQueryScope(query, user)).sort({ dueDate: 1 }).lean()
  ),

  async detail(id, user) {
    const project = await resolveProjectRef(id)
    if (!project) throw new ApiError(404, 'Project not found')
    if (!(await hasProjectAccess(project, user))) throw new ApiError(403, 'You do not have access to this project')
    const projectId = project._id
    const [tasks, sprints, milestones, files, activity] = await Promise.all([
      ProjectTask.find({ project: projectId }).sort({ order: 1 }).lean(),
      Sprint.find({ project: projectId }).lean(),
      Milestone.find({ project: projectId }).sort({ dueDate: 1 }).lean(),
      ProjectFile.find({ project: projectId }).sort({ createdAt: -1 }).lean(),
      ProjectActivity.find({ project: projectId }).sort({ createdAt: -1 }).limit(30).lean(),
    ])

    const base = withId(project)
    if (!PROJECT_FULL_ACCESS.includes(user?.role)) {
      delete base.budget
    }
    return {
      ...base,
      tasks: withIds(tasks), sprints: withIds(sprints), milestones: withIds(milestones),
      files: withIds(files), activity: withIds(activity),
    }
  },

  async stats(user) {
    const scope = projectScopeFilter(user)
    const scopedProjects = await Project.find(scope).lean()
    const taskScope = scope.$or ? { project: { $in: scopedProjects.map((p) => p._id) } } : {}
    const [projects, tasks, milestones] = await Promise.all([
      Promise.resolve(scopedProjects), ProjectTask.find(taskScope).lean(), Milestone.find(taskScope).lean(),
    ])
    const byStatus = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'].map((name) => ({ name, value: projects.filter((p) => p.status === name).length }))
    const tasksByStatus = TASK_STATUSES.map((name) => ({ name, value: tasks.filter((t) => t.status === name).length }))
    const byPriority = ['Low', 'Medium', 'High', 'Urgent'].map((name) => ({ name, value: tasks.filter((t) => t.priority === name).length }))
    const bugs = tasks.filter((t) => t.type === 'Bug')
    const openBugs = bugs.filter((t) => t.status !== 'Done')

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const trendMap = {}
    tasks.forEach((t) => {
      const d = new Date(t.createdAt)
      if (Number.isNaN(d.getTime())) return
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const b = (trendMap[key] ||= { month: MONTHS[d.getMonth()], created: 0, done: 0 })
      b.created += 1
      if (t.status === 'Done') b.done += 1
    })
    const monthlyTrend = Object.entries(trendMap).sort(([a], [b]) => (a > b ? 1 : -1)).slice(-6).map(([, v]) => v)

    return {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'Active').length,
      completedProjects: projects.filter((p) => p.status === 'Completed').length,
      totalTasks: tasks.length,
      doneTasks: tasks.filter((t) => t.status === 'Done').length,
      openTasks: tasks.filter((t) => t.status !== 'Done').length,
      totalBugs: bugs.length,
      openBugs: openBugs.length,
      milestonesReached: milestones.filter((m) => m.status === 'Reached').length,
      totalMilestones: milestones.length,
      avgProgress: projects.length ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length) : 0,
      byStatus, tasksByStatus, byPriority, monthlyTrend,
    }
  },
}

function rollbackStack() {
  const undo = []
  return {
    add: (fn) => undo.push(fn),
    async run() {
      for (const fn of undo.reverse()) {
        try { await fn() } catch (e) { console.error('Rollback step failed:', e?.message) }
      }
    },
  }
}

const txUnsupported = (err) =>
  err?.code === 20 ||
  err?.codeName === 'IllegalOperation' ||
  /Transaction numbers are only allowed|replica set member or mongos|Transactions are not supported/i.test(err?.message || '')

const mk = async (Model, doc, session) =>
  session ? (await Model.create([doc], { session }))[0] : Model.create(doc)

export async function recordProjectAdvance({ company, paymentMode, advancePayment, projectCode, projectName, session = null, mk = null, rb = null }) {
  const advance = Number(advancePayment) || 0
  if (advance <= 0) return null
  const doc = {
    title: `Advance payment - ${company}`,
    type: 'Income',
    category: 'Project Advance',
    amount: advance,
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    method: paymentMode || 'Bank Transfer',
    party: company,
    reference: projectCode || projectName,
    notes: `Auto-recorded on creation of project "${projectName}".`,
  }
  const txn = mk ? await mk(Transaction, doc, session) : await Transaction.create(doc)
  if (rb) rb.add(() => Transaction.deleteOne({ _id: txn._id }))
  return txn
}

export async function createProjectWithClient(body = {}, actor = 'System') {
  const {
    client: cIn = {},
    project: pIn = {},
    createPortalLogin = false,
    portalPassword = '',
  } = body

  const company = String(cIn.company || '').trim()
  const projectName = String(pIn.name || '').trim()
  if (!company) throw new ApiError(400, 'Company name is required')
  if (!projectName) throw new ApiError(400, 'Project name is required')

  const email = String(cIn.email || '').toLowerCase().trim()

  const core = async (session, rb) => {
    const q = (m) => (session ? m.session(session) : m)

    let client = null
    if (cIn.clientId) client = await q(Client.findOne({ clientId: String(cIn.clientId).trim() }))
    if (!client) {
      client = await q(Client.findOne({ company: { $regex: new RegExp(`^${escapeRegex(company)}$`, 'i') } }))
    }
    if (!client && email) client = await q(Client.findOne({ email }))

    let clientCreated = false
    if (!client) {
      const typedCode = String(cIn.clientId || '').trim()
      if (typedCode && await q(Client.findOne({ clientId: typedCode }))) {
        throw new ApiError(409, `Client code "${typedCode}" is already in use.`)
      }
      client = await mk(Client, {
        clientId: typedCode || `cl-${Date.now()}`,
        company,
        contactPerson: cIn.contactPerson || '',
        email: cIn.email || '',
        phone: cIn.phone || '',
        address: cIn.address || '',
        gst: cIn.gst || '',
        notes: cIn.notes || '',
        advancePayment: Number(cIn.advancePayment) || 0,
        monthlyDue: Number(cIn.monthlyDue) || 0,
        billingCycle: cIn.billingCycle || 'Monthly',
        paymentMode: cIn.paymentMode || 'Bank Transfer',
        status: 'Active',
        joinedDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      }, session)
      clientCreated = true
      if (rb) rb.add(() => Client.deleteOne({ _id: client._id }))
    }

    let portalUser = await q(User.findOne({ role: 'Client', clientId: client.clientId }))
    let credentials = null
    if (!portalUser && createPortalLogin) {
      const provisioned = await provisionClientLogin({
        client,
        email,
        password: portalPassword,
        session,
        mk,
        rb,
      })
      portalUser = provisioned.portalUser
      credentials = provisioned.credentials
    }

    const project = await mk(Project, {
      name: projectName,
      code: pIn.code || '',
      description: pIn.description || '',
      client: client.company,
      clientId: client.clientId,
      lead: pIn.lead || '',
      members: Array.isArray(pIn.members) ? pIn.members : [],
      priority: pIn.priority || 'Medium',
      status: pIn.status || 'Planning',
      budget: Number(pIn.budget) || 0,
      startDate: pIn.startDate || '',
      deadline: pIn.deadline || '',
      color: pIn.color || '#2563EB',
      advancePayment: Number(cIn.advancePayment) || 0,
      monthlyDue: Number(cIn.monthlyDue) || 0,
      billingCycle: cIn.billingCycle || 'Monthly',
      paymentMode: cIn.paymentMode || 'Bank Transfer',
    }, session)
    if (rb) rb.add(() => Project.deleteOne({ _id: project._id }))

    const advance = Number(cIn.advancePayment) || 0
    if (advance > 0) {
      const txn = await mk(Transaction, {
        title: `Advance payment - ${client.company}`,
        type: 'Income',
        category: 'Project Advance',
        amount: advance,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        method: client.paymentMode || cIn.paymentMode || 'Bank Transfer',
        party: client.company,
        reference: project.code || projectName,
        notes: `Auto-recorded on creation of project "${projectName}".`,
      }, session)
      if (rb) rb.add(() => Transaction.deleteOne({ _id: txn._id }))
    }

    return { client, project, portalUser, credentials, clientCreated }
  }

  let result = null

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      result = await core(session, null)
    })
  } catch (err) {
    if (!txUnsupported(err)) throw err
    result = null
  } finally {
    session.endSession()
  }

  if (!result) {
    const rb = rollbackStack()
    try {
      result = await core(null, rb)
    } catch (err) {
      await rb.run()
      throw err
    }
  }

  try {
    await syncClientProject(result.project, actor)
  } catch (e) {
    console.error('Client portal mirror sync failed:', e?.message)
  }
  try {
    await logActivity(result.project._id, actor, 'created project', result.project.name, {
      client: result.client.company,
      clientCreated: result.clientCreated,
    })
  } catch (e) {
    console.error('Activity log failed:', e?.message)
  }

  return {
    client: withId(result.client.toObject ? result.client.toObject() : result.client),
    project: withId(result.project.toObject ? result.project.toObject() : result.project),
    portalUserId: result.portalUser ? String(result.portalUser._id) : null,
    clientCreated: result.clientCreated,
    credentials: result.credentials,
  }
}
