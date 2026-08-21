import path from 'path'
import { Router } from 'express'
import { Project, Sprint, Milestone } from '../models/projectModels.js'
import { createResourceService } from '../services/resourceFactory.js'
import { projectService as svc, syncClientProject, createProjectWithClient, recordProjectAdvance, withId, withIds, hasProjectAccess, projectQueryScope, PROJECT_FULL_ACCESS, resolveProjectRef } from '../services/projectService.js'
import { projectValidators } from '../validators/projectValidators.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
// Staff side of the ONE shared project-document store: ClientProject.documents[]
// is the same sub-array the client portal writes to, `upload` the same multer
// middleware, `emitToClient` the same realtime channel. Nothing new is created.
import { ClientProject } from '../models/clientModels.js'
import { upload } from '../middleware/upload.js'
import { emitToClient, emitResource } from '../realtime/index.js'
import { notifyUsersByName } from '../services/notificationService.js'

const router = Router()

// Projects are visible to all authenticated users; writes limited to leads/managers.
// External clients are blocked — they have their own scoped portal under /api/client.
const canWrite = authorize('Admin', 'Manager')

// Task writes additionally allow a PROJECT LEAD to manage tasks on the project
// they lead (usually an Employee, so a static role list would reject them). The
// real decision lives in projectService.assertCanAssign() — a non-lead without
// a privileged role still receives 403 from the service layer.
const canWriteTask = (req, res, next) => next()

router.use(protect, blockClient)

// Resource router that normalizes _id -> id on every response. The generic
// resource service has no concept of project access, so the READ handlers are
// filtered by the same projectQueryScope() used everywhere else; writes keep
// their existing `canWrite` guard and are untouched.
function projectResource(Model, config, validate) {
  const { service } = createResourceService(Model, config)
  const r = Router()
  r.get('/', asyncHandler(async (req, res) => {
    const scope = await projectQueryScope(req.query, req.user)
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 8))
    const [data, total] = await Promise.all([
      Model.find(scope).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(scope),
    ])
    res.json({ data: withIds(data), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) })
  }))
  r.get('/all', asyncHandler(async (req, res) => {
    const scope = await projectQueryScope(req.query, req.user)
    res.json(withIds(await Model.find(scope).sort({ createdAt: -1 }).lean()))
  }))
  r.get('/:id', asyncHandler(async (req, res) => {
    const doc = await service.get(req.params.id)
    // Resolving the owning project through the shared scope helper throws 403
    // when the caller may not open it, and 404 when the project is gone.
    await projectQueryScope({ project: String(doc.project || '') }, req.user)
    res.json(withId(doc))
  }))
  const createChain = validate ? [canWrite, validate] : [canWrite]
  r.post('/', ...createChain, asyncHandler(async (req, res) => res.status(201).json(withId((await service.create(req.body)).toObject()))))
  r.put('/:id', canWrite, asyncHandler(async (req, res) => {
    const doc = await service.update(req.params.id, req.body)
    res.json(withId(doc.toObject ? doc.toObject() : doc))
  }))
  r.delete('/:id', canWrite, asyncHandler(async (req, res) => res.json(await service.remove(req.params.id))))
  return { router: r, service }
}

// --- Dashboard + analytics ---
router.get('/stats', asyncHandler(async (req, res) => res.json(await svc.stats(req.user))))

// --- Tasks (custom: move, sprint assign, progress-aware CRUD) ---
router.get('/tasks', asyncHandler(async (req, res) => res.json(await svc.tasks(req.query, req.user))))
// PHASE: EMPLOYEE MY TASKS (REQUIREMENT 7) — sidebar badge count for the
// signed-in user's own tasks. Same assignee + project-scope rule as /tasks.
router.get('/tasks/mine/count', asyncHandler(async (req, res) => res.json(await svc.myTasksCount(req.user))))
// Unified Client + Project creation. Same write guard as project creation —
// this endpoint can provision a Client and a portal login, so it must never
// be looser than POST /project.
router.post('/with-client', canWrite, asyncHandler(async (req, res) => {
  res.status(201).json(await createProjectWithClient(req.body, req.user.name))
}))

router.post('/tasks', canWriteTask, asyncHandler(async (req, res) => res.status(201).json(await svc.createTask(req.body, req.user.name, req.user))))
router.put('/tasks/:id', canWriteTask, asyncHandler(async (req, res) => res.json(await svc.updateTask(req.params.id, req.body, req.user.name, req.user))))

// --- Task submission & review ---
// Assignee-only submit; lead-only review (both enforce a mandatory comment in
// the service layer). Declared before '/tasks/:id' patterns and the generic
// project CRUD at the bottom so the exact sub-paths resolve first.
router.get('/tasks/review-queue', asyncHandler(async (req, res) => res.json(await svc.reviewQueue(req.user))))

// --- Task history ---
// '/tasks/history' is a LITERAL two-segment path declared here, above the
// '/tasks/:id/...' patterns, so it can never be swallowed as an :id. Scope is
// decided in the service from req.user: employees get their own history,
// leads/managers/admins get project-wise history via ?project=.
router.get('/tasks/history', asyncHandler(async (req, res) => res.json(await svc.taskHistory(req.query, req.user))))

// Assignee pool for the task-creation UI, scoped to ACTIVE internal users by
// the service so it can never offer a Client or a deactivated account.
router.get('/assignees', asyncHandler(async (req, res) => res.json(await svc.listTaskAssignees())))

// PATCH '/tasks/:id/accept' and '/tasks/:id/decline' were REMOVED: an employee
// can never accept or refuse assigned work now — a task created by a lead is
// immediately 'Assigned' and the only assignee action is submit (below).
router.post('/tasks/:id/submit', asyncHandler(async (req, res) => res.json(await svc.submitTask(req.params.id, req.body, req.user))))
// Assignee-only Start Task (guarded in the service layer, same as submit).
router.post('/tasks/:id/start', asyncHandler(async (req, res) => res.json(await svc.startTask(req.params.id, req.user))))
// PHASE: EMPLOYEE TASK READ STATE — assignee-only "mark viewed" for the unread
// badge. Same guard pattern as start/submit; idempotent, so the badge can
// never go negative or be cleared by anyone but the assignee.
router.post('/tasks/:id/view', asyncHandler(async (req, res) => res.json(await svc.markTaskViewed(req.params.id, req.user))))
// Pause/resume of the running timer. Same assignee-only guard as start; an
// open pause is closed by resume or by submit.
router.post('/tasks/:id/pause', asyncHandler(async (req, res) => res.json(await svc.pauseTask(req.params.id, req.body, req.user))))
router.post('/tasks/:id/resume', asyncHandler(async (req, res) => res.json(await svc.resumeTask(req.params.id, req.user))))
// PHASE: EMPLOYEE TASK STATUS — the single status endpoint behind the My Tasks
// status dropdown (start / pending / hold / complete). Assignee-only, guarded
// in the service layer exactly like start/pause/resume.
router.patch('/tasks/:id/status', asyncHandler(async (req, res) => res.json(await svc.setTaskStatus(req.params.id, req.body.status, req.user))))
// Task attachments: bytes stored via the existing ProjectFile mechanism, with
// the metadata attached to the task. Guarded in the service layer.
router.post('/tasks/:id/attachments', upload.single('file'), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addTaskAttachment(req.params.id, req.file, req.body, req.user))
}))
router.patch('/tasks/:id/review/approve', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'approve', req.body, req.user))))
router.patch('/tasks/:id/review/reject', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'reject', req.body, req.user))))
// 'return' sends reviewed work back for rework without marking it refused.
router.patch('/tasks/:id/review/return', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'return', req.body, req.user))))
router.patch('/tasks/:id/move', canWrite, asyncHandler(async (req, res) => res.json(await svc.moveTask(req.params.id, req.body.status, req.user.name))))
router.patch('/tasks/:id/sprint', canWrite, asyncHandler(async (req, res) => res.json(await svc.assignSprint(req.params.id, req.body.sprint, req.user.name))))
router.delete('/tasks/:id', canWrite, asyncHandler(async (req, res) => res.json(await svc.removeTask(req.params.id))))

// --- Comments / files / activity feed ---
// Every reader forwards `req.user` to projectService.projectQueryScope(), which
// enforces project access — a caller-supplied ?project=<id> is rejected for
// projects the user cannot open, and an omitted one no longer returns the whole
// organisation's rows.
router.get('/comments', asyncHandler(async (req, res) => res.json(await svc.comments(req.query, req.user))))
router.post('/comments', asyncHandler(async (req, res) => res.status(201).json(await svc.addComment(req.body, req.user.name, req.user))))
router.get('/files', asyncHandler(async (req, res) => res.json(await svc.files(req.query, req.user))))
router.post('/files', canWrite, asyncHandler(async (req, res) => res.status(201).json(await svc.addFile(req.body, req.user.name))))
router.get('/activity', asyncHandler(async (req, res) => res.json(await svc.activity(req.query, req.user))))

// --- Sprints & milestones (list scoped by project, plus CRUD) ---
router.get('/sprints/list', asyncHandler(async (req, res) => res.json(await svc.sprints(req.query, req.user))))
router.get('/milestones/list', asyncHandler(async (req, res) => res.json(await svc.milestones(req.query, req.user))))
router.use('/sprints', projectResource(Sprint, { searchFields: ['name', 'goal'], filterFields: ['project', 'status'] }, projectValidators.sprint).router)
router.use('/milestones', projectResource(Milestone, { searchFields: ['title'], filterFields: ['project', 'status'] }, projectValidators.milestone).router)

// Single RBAC-scoped source for the main Calendar's merged Project Start /
// Deadline / Milestone / Task Deadline events. Declared before the generic
// '/:id' CRUD mount so 'calendar-events' is never swallowed as a project id.
router.get('/calendar-events', asyncHandler(async (req, res) => res.json(await svc.calendarEvents(req.user))))

// =============================================================================
// STAFF ACCESS TO THE SHARED PROJECT DOCUMENT STORE
//
// Project documents physically live in ONE place — the `documents[]` sub-array
// of the ClientProject mirror — but every existing handler was mounted on
// /api/client*, which opens with `authorize('Client')`, and this router opens
// with `protect, blockClient`: staff had no door into the shared array at all.
// The handlers below open that door onto the SAME array — no new model, no
// second uploads directory, no duplicated document logic. A file uploaded by
// an employee is literally the same record the client reads.
//
// Uploads/deletes re-emit the portal's existing 'client:document' event (with
// `emitResource` busting staff caches) so both sides stay in sync.
//
// RBAC (tightened, never weakened): Clients cannot use these routes (they keep
// their own scoped ones); every handler resolves the real Project and enforces
// the EXISTING hasProjectAccess() rule (Admin/Manager/HR full access, an
// Employee must be lead / member / task-assignee); delete keeps the same
// ownership rule the client side enforces — you may only delete a document you
// uploaded, unless privileged.
// =============================================================================

// Resolve the Project + its ClientProject mirror, enforcing project access.
// One helper so the four handlers below cannot drift apart on authorization.
async function loadSharedDocumentStore(req, { lean = false } = {}) {
  const project = await resolveProjectRef(req.params.id)
  if (!project) throw new ApiError(404, 'Project not found')
  if (!(await hasProjectAccess(project, req.user))) {
    throw new ApiError(403, 'You do not have access to this project')
  }
  // ClientProject is the mirror row; `sourceProjectId` is the existing link
  // field between the two collections (see syncClientProject).
  const query = ClientProject.findOne({ sourceProjectId: project._id })
  const cp = lean ? await query.lean() : await query
  return { project, cp }
}

// GET — list. Returns [] (not 404) when a project has no client mirror yet, so
// the tab renders its normal empty state instead of an error.
router.get('/:id/documents', asyncHandler(async (req, res) => {
  const { cp } = await loadSharedDocumentStore(req, { lean: true })
  res.json(cp?.documents || [])
}))

router.post('/:id/documents', upload.single('file'), asyncHandler(async (req, res) => {
  const { cp } = await loadSharedDocumentStore(req)
  if (!cp) throw new ApiError(404, 'This project has no client workspace, so it cannot store documents')
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  const uploader = req.user?.name || 'Staff'
  // Identical document shape to the client-side upload handler — same fields,
  // same size formatting, same /uploads url — so a single list can render
  // records from either side without special-casing.
  const doc = {
    name: req.file.originalname,
    type: String(req.body?.category || 'Other'),
    size: `${(req.file.size / 1024).toFixed(1)} KB`,
    uploadedBy: uploader,
    uploadedAt: new Date().toISOString().slice(0, 10),
    url: `/uploads/${req.file.filename}`,
  }
  cp.documents.push(doc)
  cp.activity.push({ text: `${uploader} uploaded document "${doc.name}"`, at: new Date().toISOString(), by: uploader })
  await cp.save()
  // Push to the client portal on its existing channel, and to staff caches.
  emitToClient(cp.clientId, 'client:document', { project: cp, document: doc })
  emitResource('project-documents', 'post', { id: String(cp._id) })
  // Notify the project team by NAME through the existing shared helper.
  const teamNames = [...new Set((cp.team || []).map((t) => t.name).filter((n) => n && n !== uploader))]
  if (teamNames.length) {
    await notifyUsersByName(teamNames, {
      type: 'project',
      title: `New document on ${cp.name}`,
      body: `${uploader} uploaded "${doc.name}"`,
      sender: uploader,
    }).catch(() => {})
  }
  res.status(201).json(doc)
}))

router.delete('/:id/documents/:docId', asyncHandler(async (req, res) => {
  const { cp } = await loadSharedDocumentStore(req)
  if (!cp) throw new ApiError(404, 'Project not found')
  const doc = cp.documents.id(req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  const privileged = PROJECT_FULL_ACCESS.includes(req.user?.role)
  if (!privileged && doc.uploadedBy !== (req.user?.name || '')) {
    throw new ApiError(403, 'You can only delete documents you uploaded')
  }
  doc.deleteOne()
  await cp.save()
  emitToClient(cp.clientId, 'client:document', { project: cp, deletedId: req.params.docId })
  emitResource('project-documents', 'delete', { id: String(cp._id) })
  res.json({ deleted: true })
}))

router.get('/:id/documents/:docId/download', asyncHandler(async (req, res) => {
  const { cp } = await loadSharedDocumentStore(req, { lean: true })
  if (!cp) throw new ApiError(404, 'Project not found')
  const doc = (cp.documents || []).find((d) => String(d._id) === req.params.docId)
  if (!doc) throw new ApiError(404, 'Document not found')
  // Same on-disk path-safety pattern as the client download handler: resolve
  // under ./uploads and refuse anything that escapes.
  const uploadsRoot = path.resolve(process.cwd(), 'uploads')
  const abs = path.resolve(process.cwd(), '.' + doc.url)
  if (!abs.startsWith(uploadsRoot)) throw new ApiError(400, 'Invalid file path')
  res.download(abs, doc.name)
}))

// --- Project detail bundle ---
router.get('/:id/detail', asyncHandler(async (req, res) => res.json(await svc.detail(req.params.id, req.user))))

// --- Projects CRUD (mounted last so /stats, /tasks etc. resolve first) ---
// Reads are RBAC-scoped (employees only see projects they belong to); writes
// stay limited to leads/managers and fan out notifications to assigned members.
const projectStore = createResourceService(Project, { searchFields: ['name', 'code', 'client'], filterFields: ['status', 'priority', 'lead'] }).service
router.get('/', asyncHandler(async (req, res) => res.json(await svc.listScoped(req.query, req.user))))
router.get('/all', asyncHandler(async (req, res) => res.json(await svc.allScoped(req.user))))
router.get('/:id', asyncHandler(async (req, res) => res.json(await svc.getScoped(req.params.id, req.user))))
router.post('/', canWrite, projectValidators.project, asyncHandler(async (req, res) => {
  const created = await projectStore.create(req.body)
  const obj = created.toObject ? created.toObject() : created
  await svc.notifyProjectCreated(obj, req.user?.name || 'System')
  // Sync a ClientProject record if a client is named.
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
  // Company name must match what syncClientProject matched Client.company
  // against, so the advance Transaction is scoped identically to how
  // buildBillingRows() will later look it up (`party: company`).
  await recordProjectAdvance({
    company: obj.client || '',
    paymentMode: obj.paymentMode || '',
    advancePayment: obj.advancePayment || 0,
    projectCode: obj.code || '',
    projectName: obj.name || '',
  }).catch(() => {})
  res.status(201).json(withId(obj))
}))
router.put('/:id', canWrite, asyncHandler(async (req, res) => {
  const resolved = await resolveProjectRef(req.params.id)
  if (!resolved) throw new ApiError(404, 'Project not found')
  const before = await Project.findById(resolved._id).lean()
  const updated = await projectStore.update(resolved._id, req.body)
  const obj = updated.toObject ? updated.toObject() : updated
  if (before) await svc.notifyMembersChanged(before, obj, req.user?.name || 'System')
  // The Client Portal mirror must refresh on edit too, or client-visible
  // status/progress/team/budget/dates go stale the moment a project changes.
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
  res.json(withId(obj))
}))
router.delete('/:id', canWrite, asyncHandler(async (req, res) => {
  const resolved = await resolveProjectRef(req.params.id)
  if (!resolved) throw new ApiError(404, 'Project not found')
  res.json(await projectStore.remove(resolved._id))
}))

export default router
