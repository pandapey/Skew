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

const TASK_STATUSES = ['Todo', 'In Progress', 'Review', 'Done']

// Roles that may see every project. Everyone else is scoped to membership.
export const PROJECT_FULL_ACCESS = ['Admin', 'Manager', 'HR']

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

// Phase 4: the name->email fan-out helper moved to ./notificationService.js so
// the leave workflow can reuse the exact same emitter instead of duplicating
// it. This local alias keeps the existing call sites below unchanged.
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

// Authoritative server-side guard for task creation/reassignment.
// Privileged roles (Admin / Manager / HR) keep their existing unrestricted
// behaviour — this only ADDS the ability for a lead to manage their own
// project, under a strict assignee allow-list. No existing permission is lost.
async function assertCanAssign(project, assignee, user) {
  const privileged = PROJECT_FULL_ACCESS.includes(user?.role)
  const lead = isProjectLead(project, user)

  if (!privileged && !lead) {
    throw new ApiError(403, 'Only the project lead or a privileged role can manage tasks on this project')
  }

  // Privileged roles may assign freely (unchanged pre-existing behaviour).
  if (privileged) return

  // Lead path: the assignee must be on this project.
  if (!assignee) throw new ApiError(422, 'An assignee is required')
  const pool = projectAssigneePool(project)
  if (!pool.includes(assignee)) {
    throw new ApiError(403, 'A project lead can only assign tasks to members of that project')
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

// --- Phase 5.5 (Task 5): append one entry to a task's unified timeline ---
// Takes the task DOCUMENT (not an id) so the caller can fold the history push
// into the save it is already performing: no extra round trip, and the entry
// can never drift out of sync with the state change it describes.
// This is deliberately NOT the same thing as logActivity() -- that writes a
// project-wide activity feed keyed by free-text action strings, which cannot
// be filtered or reported on. This writes structured, enumerated task events.
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

// ---------------------------------------------------------------------------
// Phase 6.3 (Tasks 3, 6 & 7) - PROJECT PROGRESS / TIMELINE RECALCULATION
//
// ROOT CAUSE (one defect, three visible symptoms):
// recomputeProgress() wrote the recalculated share-of-Done onto the internal
// `Project.progress` ONLY. The Client Portal never reads Project - it reads the
// `ClientProject` mirror, and that mirror's `progress` was written in exactly
// two places: syncClientProject(), which is called only from POST /project and
// PUT /project (projectRoutes.js), and the Admin-only
// PUT /admin/projects/:id/progress endpoint.
//
// So the whole task lifecycle - assign -> submit -> review -> approve ->
// recomputeProgress() - updated the internal number and left the client-facing
// mirror frozen at whatever it was when the project row was last saved (0 for a
// brand-new project). That single gap is why:
//   * Task 3: the Client Dashboard "Task Progress" widget never moved. It
//     averages `p.progress` across active projects, and every value was stale.
//   * Task 7: project progress "was not recalculated" - it WAS recalculated,
//     but the recalculated value never reached the surface that displays it.
//   * Task 6: ClientProject.timeline was NEVER populated by anything. The
//     schema defaults it to [] and syncClientProject() simply omits the field,
//     so every stage rendered as pending and `timelinePercent` was always 0.
//
// FIX: recomputeProgress() is now the single place that recalculates, and it
// propagates the SAME computed numbers to the mirror plus a timeline derived
// from real project + task state. No second calculation engine, no hardcoded
// percentages, and no fabricated dates - every stage date comes from a real
// stored value (startDate / updatedAt) or is left blank.
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
  // Phase 5.4 (Task 3) root cause #2 (deeper than "never called on update"):
  // this used to look the mirror up by `projectId: String(project._id)` - the
  // raw Mongo id - while the create branch below always assigns a DIFFERENT id
  // shape (`cp-<last 6 chars>`). Those strings can never match, so the lookup
  // always reported "not found", even for a project that already had a mirror.
  // Every re-sync therefore fell into the create branch and tried to insert a
  // second row with that same deterministic `cp-...` id, colliding with the
  // unique `projectId` index and throwing - an error both call sites in
  // projectRoutes.js swallow with `.catch(() => {})`. Net effect: the Client
  // Portal mirror was written once at creation and then silently never updated
  // again, which would have defeated the update-route wiring on its own.
  // Fix: derive the id once, reuse it for both the lookup and the write.
  const cpProjectId = `cp-${String(project._id).slice(-6)}`
  const existingCp = await ClientProject.findOne({ projectId: cpProjectId }).lean()
  // Phase 6.23 (TASK 2): the lead used to be concatenated in front of
  // members[] with no identity check, and the lead is normally ALSO a member of
  // their own project - so the same person was mirrored into ClientProject.team
  // twice and the portal rendered two cards. buildProjectTeam() is now the ONE
  // place this transformation lives (utils/team.js); it collapses the lead and
  // any duplicate member rows onto a single record.
  const teamMembers = buildProjectTeam(project)
  const cpData = {
    clientId: clientRec.clientId,
    // Phase 5.4 (Task 4): explicit back-reference to the internal Project, so
    // client-portal features can resolve the real Project._id directly.
    sourceProjectId: project._id,
    name: project.name,
    code: project.code || '',
    status: project.status || 'Planning',
    progress: project.progress || 0,
    priority: project.priority || 'Medium',
    startDate: project.startDate || '',
    deliveryDate: project.deadline || '',
    budget: project.budget || 0,
    team: teamMembers,
    // Phase 6.9 (TASK 10): `accountManager` no longer mirrored onto the
    // client-facing project. The field is gone from both the Client and
    // ClientProject schemas, so writing it would be silently dropped anyway.
  }
  // Phase 6.3 (Task 6): derive the client-facing timeline here too, so the
  // stepper is populated the moment the mirror is first created rather than
  // waiting for the first task event. Uses the same single builder as
  // recomputeProgress - one derivation rule, not two.
  const cpTasks = await ProjectTask.find({ project: project._id }).lean()
  cpData.timeline = buildTimelineStages(project, cpTasks, existingCp?.timeline)
  // Progress must follow the tasks, not the possibly-stale Project.progress
  // column, so creating the mirror can never publish a wrong number.
  if (cpTasks.length) {
    cpData.progress = Math.round((cpTasks.filter((t) => t.status === 'Done').length / cpTasks.length) * 100)
  }
  if (existingCp) {
    await ClientProject.findOneAndUpdate({ projectId: cpProjectId }, { $set: cpData })
    // Phase 5.8 (Task 9): project completion -> notify the client exactly once,
    // on the transition into 'Completed' (never re-fired on later no-op syncs).
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
    // Phase 6.3: mirror updates (status/progress/timeline/team) now reach the
    // client's open portal session immediately instead of only on next refetch.
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
    const project = await Project.findById(id).lean()
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
      sender: actor, link: `/projects/${project._id}`,
    })
  },

  // Notify only members who were newly added on an update.
  async notifyMembersChanged(before, after, actor) {
    const prev = new Set([before.lead, ...((before.members || []).map((m) => m.name))].filter(Boolean))
    const added = [after.lead, ...((after.members || []).map((m) => m.name))].filter((n) => n && !prev.has(n) && n !== actor)
    await notifyByName(added, {
      type: 'project', title: 'Added to a project',
      body: `${actor} added you to “${after.name}”.`,
      sender: actor, link: `/projects/${after._id}`,
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

  // Create a task under a project; log + refresh progress.
  // `user` is the full acting user so RBAC can be enforced in the service layer
  // (defense in depth) rather than only at the route.
  async createTask(body, actor = 'System', user = null) {
    if (!body.project) throw new ApiError(422, 'project is required')
    const project = await Project.findById(body.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    if (user) await assertCanAssign(project, body.assignee, user)

    const task = await ProjectTask.create({
      ...body,
      // Record WHO assigned the task so a submission can be routed back to them.
      assignedBy: actor,
      reporter: body.reporter || actor,
      submissionStatus: 'Not Submitted',
    })
    // Phase 5.5 (Task 5): the first timeline entry. `to` records who the work
    // landed on, so a later handover reads as a real Reassigned transition
    // rather than an unexplained change of owner.
    if (task.assignee) {
      pushHistory(task, 'Assigned', actor, { to: task.assignee })
      await task.save()
    }
    await recomputeProgress(task.project)
    await logActivity(task.project, actor, `created ${task.type.toLowerCase()} "${task.title}"`, task.title)
    notify('team@skew.com', `New ${task.type}`, `${actor} created "${task.title}"`)

    // Part 9: notify the assignee privately that work was assigned to them.
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
      // Validate against the assignee AFTER the patch, so a lead cannot move a
      // task onto someone outside the project via an update.
      const nextAssignee = patch.assignee !== undefined ? patch.assignee : existing.assignee
      await assertCanAssign(project, nextAssignee, user)
    }

    const task = await ProjectTask.findByIdAndUpdate(id, patch, { new: true, runValidators: true })
    if (!task) throw new ApiError(404, 'Task not found')

    // Phase 5.5 (Task 5): record a GENUINE handover only. A patch that merely
    // touches a due date or priority is not a reassignment, and logging one
    // would make the timeline noise. Resetting assignmentStatus forces the new
    // assignee to accept the work themselves instead of silently inheriting
    // the previous person's acceptance.
    if (patch.assignee !== undefined && patch.assignee !== existing.assignee) {
      pushHistory(task, 'Reassigned', actor, { from: existing.assignee || null, to: patch.assignee || null })
      task.assignmentStatus = 'Reassigned'
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

  // --- Phase 4 (Part 7): employee submits their work for review ---
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
    // Reflect the submission on the kanban board without skipping to Done — the
    // lead's approval is what completes the task.
    if (task.status !== 'Done') task.status = 'Review'
    // Phase 5.5 (Task 5): carry the submission comment onto the timeline so the
    // history view renders in one pass without a second lookup.
    pushHistory(task, 'Submitted', user.name, { comment: text })
    await task.save()

    await logActivity(task.project, user.name, `submitted "${task.title}" for review`, task.title)

    // Part 8/9: route the review request to the lead who assigned it, falling
    // back to the project's current lead if the assigner is no longer set.
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

  // --- Phase 4 (Part 8): project lead approves/rejects a submission ---
  async reviewTask(id, action, { comment } = {}, user) {
    const text = typeof comment === 'string' ? comment.trim() : ''
    if (!text) throw new ApiError(422, 'A comment is required when approving or rejecting a task')

    // Phase 5.5 (Task 5): 'return' is a THIRD outcome -- reviewed, not refused,
    // but sent back for rework. Kept distinct from 'reject' so the history can
    // tell "this was wrong" apart from "this needs another pass". Any value
    // other than approve/return still falls through to 'Rejected', so existing
    // callers are unaffected.
    const status = action === 'approve' ? 'Approved' : action === 'return' ? 'Returned' : 'Rejected'

    const task = await ProjectTask.findById(id)
    if (!task) throw new ApiError(404, 'Task not found')
    if (task.submissionStatus !== 'Submitted') {
      throw new ApiError(409, 'Only a submitted task can be reviewed')
    }

    const project = await Project.findById(task.project).lean()
    if (!project) throw new ApiError(404, 'Project not found')

    // The reviewer must be the lead who assigned it, the project lead, or a
    // privileged role. An employee can never review their own submission.
    const allowed =
      PROJECT_FULL_ACCESS.includes(user?.role) ||
      user?.name === task.assignedBy ||
      isProjectLead(project, user)
    if (!allowed) throw new ApiError(403, 'Only the project lead who assigned this task can review it')
    if (user?.name === task.submission?.by && !PROJECT_FULL_ACCESS.includes(user?.role)) {
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
    // Phase 5.5 (Task 5): an approval is two distinct facts -- the review
    // decision, and the task actually reaching completion. Recording both keeps
    // 'Completed' meaningful for reporting instead of having to infer it.
    pushHistory(task, status, user.name, { comment: text })
    if (status === 'Approved') pushHistory(task, 'Completed', user.name)
    await task.save()
    await recomputeProgress(task.project)
    await logActivity(task.project, user.name, `${status.toLowerCase()} the submission for "${task.title}"`, task.title)

    // Phase 5.8 (Task 9): task update -> the owning client is notified too
    // (user-specific, via the ClientProject mirror), alongside the existing
    // employee notification below.
    await notifyClientForProject(task.project, {
      title: status === 'Approved' ? 'Task completed' : `Task ${status.toLowerCase()}`,
      body: `"${task.title}" was ${status.toLowerCase()} by ${user.name}.`,
      icon: status === 'Approved' ? 'delivery' : 'update',
    }).catch(() => {})

    // Part 9: private notification back to the employee who submitted.
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

  // Phase 6.2 (Task 2): respondToAssignment() (employee accept/decline) was
  // REMOVED. Its routes are gone too, and the 'Accepted' assignmentStatus /
  // history events can no longer be produced. The enums keep those values for
  // BACKWARD COMPATIBILITY so historical rows still validate and still render
  // correctly in Task History - dropping them would break existing documents.

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
    for (const k of ['project', 'sprint', 'status', 'type', 'priority', 'assignee']) {
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
    return withIds(rows)
  },

  // --- Phase 5.5 (Task 5): task history ---
  // ONE function serves both required views, because they are the same query
  // at a different scope:
  //   * Employee "My Task History" -> no ?project, scoped to their own tasks
  //   * Lead/Manager/Admin/HR      -> ?project=<id>, every task in that project
  // Reuses accessibleProjectFilter so visibility can never drift away from the
  // rest of the projects module.
  // Phase 6.3 (Task 4) - THE REAL CAUSE OF THE CLIENT "403 Insufficient
  // Permission" ON My Projects -> Task History.
  //
  // The route and the middleware were both correct. clientRoutes.js runs
  // `protect, authorize('Client')`, and getProjectTaskHistory already performs
  // the correct ownership check - it loads the ClientProject by
  // { projectId, clientId } and 404s if the row is not the caller's. By the time
  // it calls this function, ownership is PROVEN.
  //
  // The 403 came from this function re-deriving authorisation a second time,
  // using a staff-shaped rule that a Client can never satisfy:
  //   1. `privileged` = PROJECT_FULL_ACCESS.includes('Client') -> false.
  //   2. `project` is set, so the employee branch is skipped.
  //   3. accessibleProjectFilter(user) builds { $or: [ { lead: user.name },
  //      { 'members.name': user.name } ] } plus that user's assigned task ids.
  //   4. A Client is, by design, never a project lead, never in members[] and
  //      never a task assignee -> `ids` comes back EMPTY.
  //   5. ids.includes(project) is false -> throw ApiError(403).
  // So the endpoint rejected the client for failing a STAFF membership test that
  // is irrelevant to client ownership. Nothing was actually misconfigured.
  //
  // FIX (does not bypass RBAC - it relocates the check to the only layer that
  // can evaluate it): the caller states, via a THIRD argument, that it has
  // already verified ownership itself. This flag is deliberately NOT read from
  // `query`, so it can never be injected over HTTP by a staff caller hitting
  // GET /project/tasks/history?ownershipVerified=true - that route passes
  // req.query straight through as `query` and cannot reach this parameter.
  // Requesting a project is still impossible without first passing the
  // { projectId, clientId } ownership lookup, so a client can only ever read
  // their own project's history and no other.
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
        ...withId(row),
        projectName: nameById[String(row.project)] || null,
        timeline,
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

  // --- Phase 6.2 (Task 4): task comments vs project discussion ---
  // ROOT CAUSE (single defect, in this one function):
  // ProjectComment is ONE collection holding both kinds of comment, correctly
  // discriminated by its `task` field (models/projectModels.js: `task` is an
  // ObjectId ref that defaults to null for a project-level comment). A TASK
  // comment, however, also carries `project` - it must, so the task thread can
  // resolve its project, log activity and scope permissions.
  //
  // This filter only ever ADDED constraints: given { project } it produced
  // `{ project }` with NO constraint on `task`, so the query matched
  // project-level comments AND every task comment inside that project. The
  // Project Discussion tab (ProjectDetail.jsx -> <CommentsPanel projectId={id} />,
  // which sends `{ project }` only) therefore displayed the task threads too.
  //
  // The reverse direction was never broken: the task view sends { task }, which
  // pins `task` to one id, so project comments never leaked into a task.
  //
  // FIX: make "project scope" explicit instead of unconstrained. Asking for a
  // project WITHOUT a task now means "the project's own discussion", i.e.
  // `task: null`. Nothing is duplicated or migrated - the same single
  // collection and the same documents are simply queried correctly.
  //
  // BACKWARD COMPATIBILITY: `task: null` matches both an explicit null and a
  // missing field in MongoDB, so pre-existing project comments written before
  // the `task` field was introduced still match.
  async comments(query) {
    const filter = {}
    const project = scalarOrNull(query.project)
    const task = scalarOrNull(query.task)
    if (project != null) filter.project = project
    if (task != null) {
      filter.task = task
    } else if (project != null) {
      filter.task = null
    }
    const rows = await ProjectComment.find(filter).sort({ createdAt: 1 }).lean()
    return withIds(await enrichComments(rows))
  },

  // Phase 6.2 (Task 4), write side of the same root cause. A TASK comment was
  // fanned out exactly like a PROJECT comment: it notified every project member
  // with the title "New project comment" and pushed a client-portal
  // notification ("New message from your project team"). So internal task
  // chatter surfaced as project discussion for the whole team AND for the
  // external client. The reads are now correctly scoped (see comments() above);
  // the notifications must be scoped the same way or the leak just moves from
  // the thread into the notification feed.
  //
  // A task comment is now routed only to the people actually involved in that
  // task - its assignee and the lead who assigned it - reusing the SAME
  // notifyByName() helper. No new notification store, no duplicated comment.
  async addComment(body, actor) {
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

    // Phase 5.8 (Task 9): a project comment notifies BOTH directions — the
    // client (when the comment was posted by staff) and the assigned project
    // members (when it was posted via the Client Portal). User-specific only.
    if (body.project) {
      const project = await Project.findById(body.project).select('name lead members').lean()
      if (!body.viaClientPortal) {
        // Staff-authored comment -> tell the client. This closes the gap where
        // only client->team comments produced a client-visible notification.
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

  // --- Phase 5.8 (Task 2): edit/delete own comment (ownership-checked). ---
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

  files: async (query) => withIds(await ProjectFile.find(scalarOrNull(query.project) != null ? { project: query.project } : {}).sort({ createdAt: -1 }).lean()),

  async addFile(body, actor) {
    const file = await ProjectFile.create({ ...body, uploadedBy: actor || body.uploadedBy })
    await logActivity(body.project, file.uploadedBy, `uploaded ${file.name}`, file.name)
    return withId(file.toObject())
  },

  activity: async (query) => withIds(await ProjectActivity.find(scalarOrNull(query.project) != null ? { project: query.project } : {}).sort({ createdAt: -1 }).limit(clampLimit(query.limit, 50)).lean()),

  sprints: async (query) => withIds(await Sprint.find(scalarOrNull(query.project) != null ? { project: query.project } : {}).sort({ createdAt: -1 }).lean()),

  milestones: async (query) => withIds(await Milestone.find(scalarOrNull(query.project) != null ? { project: query.project } : {}).sort({ dueDate: 1 }).lean()),

  // Full project detail bundle for the detail page.
  async detail(id, user) {
    const project = await Project.findById(id).lean()
    if (!project) throw new ApiError(404, 'Project not found')
    if (!(await hasProjectAccess(project, user))) throw new ApiError(403, 'You do not have access to this project')
    const [tasks, sprints, milestones, files, activity] = await Promise.all([
      ProjectTask.find({ project: id }).sort({ order: 1 }).lean(),
      Sprint.find({ project: id }).lean(),
      Milestone.find({ project: id }).sort({ dueDate: 1 }).lean(),
      ProjectFile.find({ project: id }).sort({ createdAt: -1 }).lean(),
      ProjectActivity.find({ project: id }).sort({ createdAt: -1 }).limit(30).lean(),
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
// Phase 5.7 (Task 1): unified Client + Project creation.
//
// One call provisions, in order: Client -> (optional) Client portal User ->
// Project -> Finance initialisation -> ClientProject mirror.
//
// ATOMICITY NOTE (important, and deliberately not hidden):
// MongoDB multi-document transactions require a replica set or mongos. A
// plain standalone `mongod` -- which is what a default local dev install is --
// does NOT support them and fails with code 20 / 'Transaction numbers are only
// allowed on a replica set member or mongos'. Writing a transaction-only
// implementation would therefore break every standalone deployment outright.
// So we attempt a real transaction first and, only when the server tells us
// transactions are unsupported, fall back to sequential writes guarded by an
// explicit compensating-rollback stack. Either way the caller's guarantee
// holds: on failure no partial data is left behind.
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
