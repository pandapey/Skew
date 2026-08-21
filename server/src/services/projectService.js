import {
  Project, Sprint, ProjectTask, Milestone,
  ProjectComment, ProjectFile, ProjectActivity,
} from '../models/projectModels.js'
import mongoose from 'mongoose'
import { Client, ClientProject, ClientNotification } from '../models/clientModels.js'
import { Transaction } from '../models/financeModels.js'
// Phase 6.6 (TASK 2): single shared client-portal-login provisioning routine.
import { provisionClientLogin } from './clientLoginService.js'
import { ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit } from '../utils/query.js'
import { User } from '../models/User.js'
import { notifyUsersByName } from './notificationService.js'
import { emitToClient } from '../realtime/index.js'
import { buildProjectTeam } from '../utils/team.js'

// Frontend keys every row on `.id`; Mongo returns `_id`. Normalize on the way out.
export const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)
export const withIds = (docs) => docs.map(withId)

// Business-ID lookup: project URLs use the human-readable Project ID (PRJ001)
// while legacy bookmarks / internal links still carry the Mongo ObjectId. A
// ref is resolved to the lean document either way; a malformed ref resolves to
// null (404) instead of throwing a CastError, so no input can produce a 500.
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

// Roles that may see every project. Everyone else is scoped to membership.
export const PROJECT_FULL_ACCESS = ['Admin', 'Manager']

// Phase 7.2 (TASK 2): the roles a task may be assigned to. Any ACTIVE internal
// user is a valid assignee — assignment is no longer limited to members of the
// project. Clients are excluded: they have their own portal and can never be a
// task assignee.
export const TASK_ASSIGNEE_ROLES = ['Admin', 'Manager', 'Employee']

// Mongo filter limiting Project queries to those a user may access. Privileged
// roles get {} (all projects); other staff only see projects where they are the
// lead or a named member.
export function projectScopeFilter(user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return {}
  return { $or: [{ lead: user.name }, { 'members.name': user.name }] }
}

// In-memory access check for a single loaded project document.
export function canAccessProject(project, user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return true
  const name = user?.name
  return project.lead === name || (project.members || []).some((m) => m.name === name)
}

// Async access resolution for single-project reads (detail / getScoped). In
// addition to lead/membership (canAccessProject), a user is "assigned" to a
// project when they have at least one task assigned to them in it. Membership
// and task assignment are BOTH stored by NAME but are independent — an employee
// can own tasks in a project without appearing in the project's members[]
// array. Treating task-assignees as having (scoped, read-only) access fixes the
// "You do not have access to this project" / Insufficient Permission error for
// genuinely-assigned employees WITHOUT weakening RBAC: privileged roles are
// unchanged and every write stays gated by the canWrite route middleware.
export async function hasProjectAccess(project, user) {
  if (canAccessProject(project, user)) return true
  if (!user?.name) return false
  const assigned = await ProjectTask.exists({ project: project._id, assignee: user.name })
  return !!assigned
}

// Async scope filter mirroring hasProjectAccess for list/collection reads, so an
// employee's project list matches exactly the projects they can open.
export async function accessibleProjectFilter(user) {
  if (!user || PROJECT_FULL_ACCESS.includes(user.role)) return {}
  const taskProjectIds = await ProjectTask.find({ assignee: user.name }).distinct('project')
  const or = [{ lead: user.name }, { 'members.name': user.name }]
  if (taskProjectIds.length) or.push({ _id: { $in: taskProjectIds } })
  return { $or: or }
}

// Resolve a ?project filter for the sub-collection readers (comments, files,
// activity, sprints, milestones) with authorization: an explicit project must
// pass hasProjectAccess(), an absent one is scoped to the caller's own projects
// (accessibleProjectFilter), and privileged roles stay unrestricted.
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

// The name->email fan-out helper lives in ./notificationService.js so the
// leave workflow reuses the exact same emitter; this alias keeps call sites
// below unchanged.
const notifyByName = notifyUsersByName

// --- Phase 4 (Part 6): who a project lead may assign work to ---
// The project lead may create tasks ONLY for people actually on that project.
// Everyone else — employees outside the project, HR, Admin, or any other
// account — is not a valid assignee for a lead-created task.
export function projectAssigneePool(project) {
  return [...new Set([
    project.lead,
    ...((project.members || []).map((m) => m.name)),
  ].filter(Boolean))]
}

export function isProjectLead(project, user) {
  return Boolean(user?.name) && project?.lead === user.name
}

// Authoritative server-side guard for task creation/reassignment. Any
// authorized internal user may create a task for any other active internal
// user (membership restriction is gone); a Client is structurally unable to
// reach these handlers (routes run `protect, blockClient`).
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

// Email-ready notification hook. Swap console for Nodemailer in production.
function notify(to, subject, body) {
  // e.g. await mailer.sendMail({ to, subject, text: body })
}

// --- Phase 5.8 (Task 9): notify the owning Client Portal for a given
// internal Project. Reuses the ClientProject mirror (sourceProjectId) that
// already exists rather than inventing a second notification store, and is
// user-specific (scoped to that one clientId room) — never a global broadcast.
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

// --- Phase 5.8 (Task 2): batch-attach role + avatar to a list of comments by
// author name, without duplicating User data into the comment collection.
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

// --- Append one entry to a task's unified timeline ---
// Takes the task DOCUMENT (not an id) so the caller folds the push into the
// save it is already performing: no extra round trip, and the entry can never
// drift out of sync with the state change it describes. Distinct from
// logActivity(), which writes the free-text project-wide activity feed.
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

// Total wall-clock seconds the task was paused, from the stored intervals plus
// the currently-open one (if `until` is provided). Used by the timer so a
// paused span is never counted as working time. Intervals that predate the
// task's `startedAt` (leftovers from earlier resets) contribute nothing.
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

// Active working seconds between `startedAt` and `until`, minus paused time.
export function activeSeconds(task, until = null) {
  if (!task.startedAt) return 0
  const end = until ? new Date(until).getTime() : Date.now()
  const start = new Date(task.startedAt).getTime()
  return Math.max(0, Math.round((end - start) / 1000) - Math.round(pausedSeconds(task, until) / 1000))
}

// ---------------------------------------------------------------------------
// Project progress + client timeline: recomputeProgress() is the single place
// that recalculates the share-of-Done, and it propagates the SAME numbers to
// the ClientProject mirror (which previously stayed frozen at the last save)
// plus a timeline derived from real project + task state — never hardcoded
// percentages or fabricated dates.
// ---------------------------------------------------------------------------

// Canonical client-facing delivery stages. Mirrors TIMELINE_STAGES in
// client/src/features/client/constants.js, which is what the portal stepper
// matches stage entries against BY NAME - so the two lists must stay identical.
export const CLIENT_TIMELINE_STAGES = [
  'Project Created', 'Planning', 'Development', 'Testing', 'Review', 'Deployment', 'Completed',
]

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// Derive the client-facing roadmap from REAL Project + ProjectTask state.
// `existing` is the currently-stored timeline: any date or note an Admin has
// already written is preserved, so this is additive rather than destructive.
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

  // status is one of 'Pending' | 'In Progress' | 'Completed' (timelineStageSchema).
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
      // Never overwrite a real stored date with a blank one.
      date: d.date || prev[name]?.date || '',
      notes: prev[name]?.notes || '',
    }
  })
}

// Push the recomputed progress + derived timeline onto the ClientProject mirror
// and tell that one client's portal session to refresh. Scoped to a single
// `client:<clientId>` room - never a global broadcast (see realtime/index.js).
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

// Recompute a project's progress from its tasks (share of Done).
// Phase 6.3: an empty task list now resolves to 0 instead of returning early -
// deleting the last task used to leave the previous percentage stranded on the
// record forever, which is a hardcoded-looking value with no data behind it.
async function recomputeProgress(projectId) {
  const tasks = await ProjectTask.find({ project: projectId }).lean()
  const done = tasks.filter((t) => t.status === 'Done').length
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  await Project.findByIdAndUpdate(projectId, { progress })
  // Keep the client-facing mirror in step with the internal number.
  await syncProjectProgressToClient(projectId, progress, tasks).catch(() => {})
  return progress
}


// Sync a ClientProject whenever a Project with a client field is created or updated.
// Project.client stores the client's company name (string). We look up the matching
// Client record to find its clientId, then upsert a ClientProject that mirrors the
// project data exposed through the Client Portal.
export async function syncClientProject(project, actor = 'System') {
  if (!project.client) return // no client linked — nothing to sync
  const clientRec = await Client.findOne({ company: { $regex: new RegExp(`^${project.client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }).lean()
  if (!clientRec) return // client company not found in Client collection
  // The mirror is keyed by `cp-<last 6 chars>` — the same derived id is used
  // for both the lookup and the write, so re-syncs update the existing row
  // instead of colliding with the unique `projectId` index.
  const cpProjectId = `cp-${String(project._id).slice(-6)}`
  const existingCp = await ClientProject.findOne({ projectId: cpProjectId }).lean()
  // Team dedup: buildProjectTeam() is the ONE place lead+members are merged,
  // collapsing the lead (normally also a member) onto a single card.
  const teamMembers = buildProjectTeam(project)
  const cpData = {
    clientId: clientRec.clientId,
    // Back-reference to the internal Project, so client-portal features can
    // resolve the real Project._id directly.
    sourceProjectId: project._id,
    name: project.name,
    code: project.code || '',
    status: project.status || 'Planning',
    progress: project.progress || 0,
    priority: project.priority || 'Medium',
    startDate: project.startDate || '',
    deliveryDate: project.deadline || '',
    budget: project.budget || 0,
    // Commercial terms mirrored through the same upsert, so an edit refreshes
    // them too — read by clientController.buildBillingRows() for the portal's
    // Advance Payment / Monthly Due cards.
    advancePayment: project.advancePayment || 0,
    monthlyDue: project.monthlyDue || 0,
    team: teamMembers,
  }
  // Derive the client-facing timeline at mirror-creation time too, so the
  // portal stepper is populated from the first task event onward — same single
  // builder as recomputeProgress().
  const cpTasks = await ProjectTask.find({ project: project._id }).lean()
  cpData.timeline = buildTimelineStages(project, cpTasks, existingCp?.timeline)
  // Progress must follow the tasks, not the possibly-stale Project.progress
  // column, so creating the mirror can never publish a wrong number.
  if (cpTasks.length) {
    cpData.progress = Math.round((cpTasks.filter((t) => t.status === 'Done').length / cpTasks.length) * 100)
  }
  if (existingCp) {
    await ClientProject.findOneAndUpdate({ projectId: cpProjectId }, { $set: cpData })
    // Notify the client exactly once — on the transition into 'Completed',
    // never re-fired by later no-op syncs.
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
    // Mirror updates reach the client's open portal session immediately.
    emitToClient(clientRec.clientId, 'client:project', { action: 'update', projectId: cpProjectId })
  } else {
    await ClientProject.create({ ...cpData, projectId: cpProjectId })
    // Log activity on the new client project
    await ClientProject.findOneAndUpdate(
      { projectId: cpProjectId },
      { $push: { activity: { text: `Project created by ${actor}`, at: new Date().toISOString(), by: actor } } }
    )
  }
}
// PHASE: EMPLOYEE TASK READ STATE — project a stored task into the shape the
// UI expects. `viewed` is NOT stored: it is derived per request from
// `viewedBy` for the CALLING user (same pattern as announcement likes), and
// `viewedBy` itself is stripped so a list response never leaks the full reader
// set of a task to viewers who are not its assignee.
const withTaskViewerState = (task, uid) => {
  const json = { ...task }
  const viewedBy = Array.isArray(json.viewedBy) ? json.viewedBy : []
  delete json.viewedBy
  return { ...json, viewed: Boolean(uid) && viewedBy.includes(uid) }
}

export const projectService = {
  // --- Scoped project reads (RBAC): employees only see projects they belong to ---
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

  // Phase 6.9 (Task 15): project-derived events for the MAIN Calendar merge.
  // Reuses accessibleProjectFilter — the SAME scope already backing
  // allScoped/listScoped — so an Employee sees calendar events for exactly
  // the projects they may already open (lead, member, or task-assignee), and
  // NOTHING else. Unassigned employees get empty arrays back, not an error.
  // Privileged roles (Admin/Manager/HR) keep their existing unrestricted view
  // because accessibleProjectFilter returns {} for them, matching allScoped.
  // This is enforced server-side and takes no client-supplied project filter,
  // so it cannot be widened by a crafted request.
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

  // Notify assigned team members that a project was created.
  async notifyProjectCreated(project, actor) {
    const names = [project.lead, ...((project.members || []).map((m) => m.name))].filter((n) => n && n !== actor)
    await notifyByName(names, {
      type: 'project', title: 'Added to a project',
      body: `${actor} created “${project.name}” and added you to the team.`,
      sender: actor, link: `/projects/${project.code || project._id}`,
    })
  },

  // Notify only members who were newly added on an update.
  async notifyMembersChanged(before, after, actor) {
    const prev = new Set([before.lead, ...((before.members || []).map((m) => m.name))].filter(Boolean))
    const added = [after.lead, ...((after.members || []).map((m) => m.name))].filter((n) => n && !prev.has(n) && n !== actor)
    await notifyByName(added, {
      type: 'project', title: 'Added to a project',
      body: `${actor} added you to “${after.name}”.`,
      sender: actor, link: `/projects/${after.code || after._id}`,
    })
  },

  // Move a task across a kanban column; log activity + refresh progress.
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

  // Assign a task to a sprint (or move to backlog with sprint=null).
  async assignSprint(id, sprintId, actor = 'System') {
    const task = await ProjectTask.findByIdAndUpdate(id, { sprint: sprintId || null }, { new: true })
    if (!task) throw new ApiError(404, 'Task not found')
    await logActivity(task.project, actor, sprintId ? `added "${task.title}" to a sprint` : `moved "${task.title}" to backlog`, task.title)
    return withId(task.toObject())
  },

  // --- Phase 7.2 (TASK 2): attach an uploaded file to a task ---
  // The bytes are stored by the shared multer middleware (as a ProjectFile),
  // this service only links the metadata onto the task. Allowed for the
  // assignee, the creator/lead of the task, the project lead, or a privileged
  // role — everyone who can legitimately work on or manage the task.
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

  // --- Phase 7.2 (TASK 2): assignee starts the server-side task timer ---
  // `startedAt` is persisted on the task (not held in a browser stopwatch), so
  // the running time survives reloads, logouts and other assignees. The start
  // is idempotent and re-startable: pressing Start again after a Returned /
  // Rejected resubmission keeps the ORIGINAL startedAt, so the duration stored
  // at submit time measures the full span the assignee spent on the task.
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

  // --- Phase 7.2 (TASK 2): pause the running timer ---
  // Assignee-only, same guards as startTask. The pause is stamped on the task
  // (`pausedAt`) and the interval is opened in `pauseIntervals`; it is closed
  // by resumeTask or submitTask so the recorded duration never counts paused
  // wall time as working time.
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

  // --- Phase 7.2 (TASK 2): resume a paused timer ---
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

  // --- PHASE: EMPLOYEE TASK STATUS — one endpoint behind the My Tasks status
  // dropdown (Start / Pending / Hold / Complete). Reuses the same assignee-only
  // guards and server-authoritative timer writes as start/pause/resume — a
  // client can never spoof timer fields through the generic task PUT.
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
      // Starting a HELD task resumes it (closes the open pause interval); a
      // not-yet-started task begins its timer. Either way it lands In Progress.
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
      // Reset to the not-started state: drop the timer completely (old pause
      // spans must not leak into the next session).
      task.startedAt = null
      task.completedAt = null
      task.durationSec = 0
      task.pausedAt = null
      task.pauseIntervals = []
      task.status = 'Todo'
    } else if (status === 'complete') {
      // Complete = SUBMIT FOR APPROVAL: the timer is stopped and the task is
      // routed into the review queue (same mechanics as submitTask) — the
      // lead/assigner's Approve/Reject/Return decision is what finally marks it
      // Done. It must never skip straight to Done.
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

  // --- Phase 7.2 (TASK 2): everyone a task may be assigned to ---
  // Powers the assignee picker in the task-creation UI. Scoped to ACTIVE
  // internal users (see TASK_ASSIGNEE_ROLES) so the picker can never offer a
  // Client or a deactivated account, matching the service-layer guard.
  async listTaskAssignees() {
    return User.find({ role: { $in: TASK_ASSIGNEE_ROLES }, status: 'Active' })
      .select('name role designation avatar')
      .sort({ name: 1 })
      .lean()
  },

  // Create a task under a project; log + refresh progress.
  // `user` is the full acting user so RBAC can be enforced in the service layer
  // (defense in depth) rather than only at the route.
  async createTask(body, actor = 'System', user = null) {
    if (!body.project) throw new ApiError(422, 'project is required')
    const project = await Project.findById(body.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    if (user) await assertCanAssign(project, body.assignee, user)

    // Timer + audit fields are server-authoritative: stripped from any client
    // body, they can only be written by the dedicated start/pause/resume/submit
    // endpoints.
    const { startedAt, completedAt, durationSec, pausedAt, pauseIntervals, history, ...clean } = body
    const task = await ProjectTask.create({
      ...clean,
      // Record WHO assigned the task so a submission can be routed back to them.
      assignedBy: actor,
      reporter: body.reporter || actor,
      submissionStatus: 'Not Submitted',
    })
    // First timeline entry: `to` records who the work landed on, so a later
    // handover reads as a real Reassigned transition.
    if (task.assignee) {
      pushHistory(task, 'Assigned', actor, { to: task.assignee })
      await task.save()
    }
    await recomputeProgress(task.project)
    await logActivity(task.project, actor, `created ${task.type.toLowerCase()} "${task.title}"`, task.title)
    notify('team@skew.com', `New ${task.type}`, `${actor} created "${task.title}"`)

    // Notify the assignee privately that work was assigned to them.
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
      // Validate against the assignee AFTER the patch, so a caller cannot move
      // a task onto someone outside the valid assignee pool via an update.
      const nextAssignee = patch.assignee !== undefined ? patch.assignee : existing.assignee
      await assertCanAssign(project, nextAssignee, user)
    }

    // Timer fields are server-authoritative: a client can never spoof a
    // start/end/duration (or the audit history) through the generic task PUT.
    const { startedAt, completedAt, durationSec, pausedAt, pauseIntervals, history, ...safe } = patch
    const task = await ProjectTask.findByIdAndUpdate(id, safe, { new: true, runValidators: true })
    if (!task) throw new ApiError(404, 'Task not found')

    // Record a GENUINE handover only (a due-date or priority patch is not a
    // reassignment); resetting assignmentStatus forces the new assignee to
    // accept the work themselves.
    if (patch.assignee !== undefined && patch.assignee !== existing.assignee) {
      pushHistory(task, 'Reassigned', actor, { from: existing.assignee || null, to: patch.assignee || null })
      task.assignmentStatus = 'Reassigned'
      // A handover resets the timer — the new assignee starts their own clock.
      task.startedAt = null
      task.completedAt = null
      task.durationSec = 0
      task.pausedAt = null
      task.pauseIntervals = []
      await task.save()
    }
    await recomputeProgress(task.project)

    // Notify on genuine reassignment only.
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

  // --- Employee submits their work for review ---
  async submitTask(id, { comment, attachment } = {}, user) {
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) throw new ApiError(422, 'A comment is required when submitting a task')

    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')

    // Only the person the task is assigned to may submit it.
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

    // Attachments: the schema stores files at PROJECT level (ProjectFile), so a
    // submitted attachment is persisted as a real ProjectFile and referenced by
    // the submission. No parallel storage mechanism is invented.
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
    // Stamp completion and persist the authoritative duration: ACTIVE time from
    // the server-side startedAt to this submit minus any paused spans (an open
    // pause is closed here, so a paused task can never submit while still
    // counting). It is 0 when the assignee submits without ever pressing Start
    // (which remains allowed).
    const now = new Date()
    const open = task.pauseIntervals.find((iv) => !iv.to)
    if (open) open.to = now
    task.pausedAt = null
    task.completedAt = now
    task.durationSec = task.startedAt ? activeSeconds(task, now) : 0
    // Reflect the submission on the kanban board without skipping to Done — the
    // lead's approval is what completes the task.
    if (task.status !== 'Done') task.status = 'Review'
    // Carry the submission comment onto the timeline so the history view
    // renders in one pass without a second lookup.
    pushHistory(task, 'Submitted', user.name, { comment: text })
    await task.save()

    await logActivity(task.project, user.name, `submitted "${task.title}" for review`, task.title)

    // Route the review request to the lead who assigned it, falling back to
    // the project's current lead if the assigner is no longer set.
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

  // --- Project lead approves/rejects/returns a submission ---
  async reviewTask(id, action, { comment } = {}, user) {
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) throw new ApiError(422, 'A comment is required when approving or rejecting a task')

    // 'return' is a THIRD outcome — reviewed, not refused, but sent back for
    // rework. Kept distinct from 'reject' so the history can tell "this was
    // wrong" apart from "this needs another pass".
    const status = action === 'approve' ? 'Approved' : action === 'return' ? 'Returned' : 'Rejected'

    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.submissionStatus !== 'Submitted') {
      throw new ApiError(409, 'Only a submitted task can be reviewed')
    }

    const project = await Project.findById(task.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    // The reviewer must be the lead who assigned it, the project lead, a
    // privileged role, or the ASSIGNEE themselves (self-approval — e.g. a
    // one-person task assigned to themselves). An employee can never review
    // another employee's submission.
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
      // Rejected AND returned work both go back to the assignee to redo.
      task.status = 'In Progress'
    }
    // An approval is two distinct facts — the review decision and the task
    // actually reaching completion; recording both keeps 'Completed' meaningful
    // for reporting instead of having to infer it.
    pushHistory(task, status, user.name, { comment: text })
    if (status === 'Approved') pushHistory(task, 'Completed', user.name)
    await task.save()
    await recomputeProgress(task.project)
    await logActivity(task.project, user.name, `${status.toLowerCase()} the submission for "${task.title}"`, task.title)

    // Task updates reach the owning client portal too (user-specific, via the
    // ClientProject mirror), alongside the employee notification below.
    await notifyClientForProject(task.project, {
      title: status === 'Approved' ? 'Task completed' : `Task ${status.toLowerCase()}`,
      body: `"${task.title}" was ${status.toLowerCase()} by ${user.name}.`,
      icon: status === 'Approved' ? 'delivery' : 'update',
    }).catch(() => {})

    // Private notification back to the employee who submitted.
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

  // respondToAssignment() (employee accept/decline) was REMOVED — its routes
  // and history events are gone. The enums keep 'Accepted'/'Declined' for
  // BACKWARD COMPATIBILITY so historical rows still validate and render in
  // Task History.

  // Review queue: tasks awaiting THIS lead's decision.
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

  // --- Sub-collections scoped to a project ---
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
    // Scope tasks to projects the user may access (non-privileged roles only).
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

  // PHASE: EMPLOYEE MY TASKS (REQUIREMENT 7) — count of the logged-in user's
  // tasks, using the EXACT same scope as `tasks()` (accessibleProjectFilter +
  // assignee) so the sidebar badge can never disagree with the My Tasks list.
  // PHASE: EMPLOYEE TASK READ STATE — the count is now UNREAD-only: tasks the
  // assignee has already viewed (their _id in `viewedBy`) are excluded, so the
  // badge reflects work that still needs the assignee's attention.
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

  // PHASE: EMPLOYEE TASK READ STATE — idempotently record that the ASSIGNEE has
  // viewed the task. Only the person the task is assigned to may mark it read
  // (same guard as submitTask/startTask), so no user can clear another user's
  // unread badge.
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
    // PHASE: EMPLOYEE TASK READ STATE (FIX) — the response must carry the
    // frontend `id` key, otherwise MyTasks.applyTaskUpdate (which keys off
    // `task.id`) silently no-ops and the row dot never clears in-place.
    return withTaskViewerState(withId(task.toObject()), uid)
  },

  // --- Task history ---
  // ONE function serves both required views (the same query at a different
  // scope): an employee's own tasks without ?project, every task in one project
  // with ?project=<id>. Scoping reuses accessibleProjectFilter so visibility
  // can never drift from the rest of the projects module.
  //
  // `ownershipVerified` is a server-side-only escape hatch: the Client Portal
  // route has ALREADY proven { projectId, clientId } ownership against the
  // caller, which a staff-shaped membership rule could never satisfy. It is a
  // function argument, never read from `query`, so it cannot be injected over
  // HTTP — clients can still only read their own project's history.
  async taskHistory(query, user, options = {}) {
    const filter = {}
    const project = scalarOrNull(query.project)
    if (project != null) filter.project = project

    const mine = String(query.mine ?? '') === 'true'
    const privileged = PROJECT_FULL_ACCESS.includes(user?.role)
    // Trusted, server-side-only: set by an internal caller that has already
    // proven the caller owns `query.project`.
    const ownershipVerified = options.ownershipVerified === true && project != null

    if (ownershipVerified) {
      // Ownership already established for this exact project; scope is already
      // pinned to it by `filter.project`. No further narrowing to apply.
    } else if (mine || (!project && !privileged)) {
      // Default for an employee: only work assigned to them.
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

    // Resolve project names and task comments in TWO queries total rather than
    // two per task -- this endpoint can legitimately return a whole project.
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

    // The date filter is applied to TIMELINE ENTRIES, not to the task record, so
    // a long-running task still appears for the window in which something
    // actually happened to it -- filtering on updatedAt would hide it.
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
      // If a date filter excludes every event, it excludes the task itself.
      if ((fromTs != null || toTs != null) && !timeline.length) continue
      timeline.sort((a, b) => new Date(a.at) - new Date(b.at))

      out.push({
        ...withTaskViewerState(withId(row), String(user?._id || user?.id || '')),
        projectName: nameById[String(row.project)] || null,
        timeline,
        // Total paused time for the whole working session (includes the open
        // interval when the task is currently paused, so the UI can show a
        // live figure without recomputing it client-side).
        pausedSec: Math.round(pausedSeconds(row) / 1000),
        // Comments already captured elsewhere are surfaced ALONGSIDE the
        // timeline rather than copied into it, so there is still exactly one
        // source of truth for each kind of comment.
        comments: commentsByTask[String(row._id)] || [],
        submissionComments: (row.submissionHistory || []).map((s) => ({ by: s.by, comment: s.comment, at: s.at })),
        reviewComments: (row.reviewHistory || []).map((r) => ({ by: r.reviewer, status: r.status, comment: r.comment, at: r.at })),
      })
    }
    return out
  },

  // Task comments vs project discussion: ProjectComment is ONE collection
  // discriminated by its `task` field (null = project-level). A project-scoped
  // query must pin `task: null` or it also matches every task thread inside
  // that project; the reverse direction (task-scoped) was always safe.
  async comments(query, user) {
    // Scope first, then apply the caller's own filters.
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

  // Write side of the same scoping rule: a TASK comment notifies only the people
  // involved in that task (assignee + assigner); a PROJECT comment notifies the
  // client and/or the project team as before. The Client Portal path supplies
  // no `user` (it has already resolved and authorized the project itself).
  async addComment(body, actor, user = null) {
    // Write-side scope guard for the staff route; the Client Portal path has
    // already resolved and authorized the project and passes no user.
    if (user && body?.project) {
      await projectQueryScope({ project: body.project }, user)
    }
    const comment = await ProjectComment.create({ ...body, author: actor || body.author })
    if (body.project) await logActivity(body.project, comment.author, 'commented', body.taskTitle)

    // --- Task-scoped comment: stays inside the task. ---
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

    // A project comment notifies BOTH directions — the client (when posted by
    // staff) and the assigned project members (when posted via the portal).
    if (body.project) {
      const project = await Project.findById(body.project).select('name lead members').lean()
      if (!body.viaClientPortal) {
        // Staff-authored comment -> tell the client.
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

  // --- Edit/delete own comment (ownership-checked). ---
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

  // All four collection readers below resolve their filter through
  // projectQueryScope(), so an unrelated project id is rejected and an absent
  // one no longer means "the whole organisation".
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

  // Full project detail bundle for the detail page.
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
    // Non-privileged roles (e.g. Employees) must never receive financials or
    // other admin-only fields in the detail payload — defense-in-depth for the
    // scoped employee project view. Privileged roles keep the full document.
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

  // Dashboard + analytics across all projects.
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

    // Task throughput trend (created vs done) over last 6 months.
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

// ---------------------------------------------------------------------------
// Unified Client + Project creation. One call provisions, in order: Client ->
// (optional) Client portal User -> Project -> Finance initialisation ->
// ClientProject mirror.
//
// MongoDB multi-document transactions need a replica set, so a plain
// standalone `mongod` (the default dev install) rejects them. We attempt a real
// transaction first and, only when the server reports transactions unsupported,
// fall back to sequential writes guarded by an explicit compensating-rollback
// stack — either way the caller's guarantee holds: no partial data on failure.
// ---------------------------------------------------------------------------

// Compensating-rollback stack for the non-transactional fallback path.
function rollbackStack() {
  const undo = []
  return {
    add: (fn) => undo.push(fn),
    async run() {
      // Unwind in reverse creation order. A failure while rolling back must
      // never mask the original error, so each step is individually guarded.
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

// Create honouring an optional session (Model.create needs array form for one).
const mk = async (Model, doc, session) =>
  session ? (await Model.create([doc], { session }))[0] : Model.create(doc)

// A project's advance payment is money RECEIVED — it must exist as a real
// Income Transaction for the client portal's billing rows to surface it as
// "Paid Amount". Runs from the unified creation AND the plain POST /project
// route (which previously stored the number but never booked the row).
//
// The reference is PROJECT-scoped (project.code, falling back to the name) —
// deliberately not the CLIENT-scoped `ADV-${clientId}` key of
// clientAdvanceService, so a client with multiple projects gets one advance
// row per project. `session`/`rb` are optional: the transactional caller
// passes both, the plain route passes neither.
export async function recordProjectAdvance({ company, paymentMode, advancePayment, projectCode, projectName, session = null, mk = null, rb = null }) {
  const advance = Number(advancePayment) || 0
  if (advance <= 0) return null
  const doc = {
    title: `Advance payment - ${company}`,
    type: 'Income',
    category: 'Project Advance',
    amount: advance,
    date: new Date().toISOString().slice(0, 10),
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

  // Core provisioning routine, shared by both the transactional and the
  // compensating-rollback paths. `session` is null on the fallback path.
  const core = async (session, rb) => {
    const q = (m) => (session ? m.session(session) : m)

    // --- 1. Resolve the Client. NEVER create a duplicate. ------------------
    // Match on the explicit code first, then company name (case-insensitive),
    // then email -- the three ways an admin can mean 'the same company'.
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
        // Phase 5.7 (Task 4): honour a typed code, generate only when blank.
        clientId: typedCode || `cl-${Date.now()}`,
        company,
        contactPerson: cIn.contactPerson || '',
        email: cIn.email || '',
        phone: cIn.phone || '',
        address: cIn.address || '',
        gst: cIn.gst || '',
        notes: cIn.notes || '',
        // Task 3 commercial terms.
        advancePayment: Number(cIn.advancePayment) || 0,
        monthlyDue: Number(cIn.monthlyDue) || 0,
        // Phase 6.9 (TASK 11): `paymentTerms` removed - no longer on the schema.
        billingCycle: cIn.billingCycle || 'Monthly',
        paymentMode: cIn.paymentMode || 'Bank Transfer',
        // Task 3: status is system-managed.
        status: 'Active',
        joinedDate: new Date().toISOString().slice(0, 10),
      }, session)
      clientCreated = true
      if (rb) rb.add(() => Client.deleteOne({ _id: client._id }))
    }

    // --- 2. Client portal login. Reuse before creating. --------------------
    // Phase 6.6 (TASK 2 / TASK 6 de-duplication): this block used to be an
    // inline copy of the provisioning rules (reuse-existing-user, role-conflict
    // detection, password-policy enforcement, temp-password fallback). It now
    // delegates to services/clientLoginService.js, which
    // controllers/clientController.js createClient() also calls, so
    // "Add Client" and "New Project -> New Client" provision logins through ONE
    // routine. Session / mk / rollback are forwarded, so the transactional and
    // compensating paths behave exactly as before.
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

    // --- 3. Project, linked to the resolved client. ------------------------
    const project = await mk(Project, {
      name: projectName,
      code: pIn.code || '',
      description: pIn.description || '',
      // The Project schema links to a client by company name (existing
      // contract, kept for backward compatibility with every existing query).
      client: client.company,
      lead: pIn.lead || '',
      members: Array.isArray(pIn.members) ? pIn.members : [],
      priority: pIn.priority || 'Medium',
      status: pIn.status || 'Planning',
      budget: Number(pIn.budget) || 0,
      startDate: pIn.startDate || '',
      deadline: pIn.deadline || '',
      color: pIn.color || '#2563EB',
    }, session)
    if (rb) rb.add(() => Project.deleteOne({ _id: project._id }))

    // --- 4. Finance initialisation. ----------------------------------------
    // Only when an advance was actually collected -- we never invent revenue.
    const advance = Number(cIn.advancePayment) || 0
    if (advance > 0) {
      const txn = await mk(Transaction, {
        title: `Advance payment - ${client.company}`,
        type: 'Income',
        category: 'Project Advance',
        amount: advance,
        date: new Date().toISOString().slice(0, 10),
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

  // --- Attempt a real multi-document transaction first. --------------------
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      // No compensating stack inside a transaction: abort handles it.
      result = await core(session, null)
    })
  } catch (err) {
    if (!txUnsupported(err)) throw err
    result = null // standalone mongod -- fall through to the guarded path
  } finally {
    session.endSession()
  }

  // --- Fallback: sequential writes + explicit compensating rollback. -------
  if (!result) {
    const rb = rollbackStack()
    try {
      result = await core(null, rb)
    } catch (err) {
      await rb.run()
      throw err
    }
  }

  // --- 5. Relationship linking (idempotent, safe to run post-commit). ------
  // syncClientProject mirrors the Project into the client portal. It is
  // deliberately outside the transaction because it is an upsert-style
  // reconciliation that can be re-run at any time without side effects.
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
