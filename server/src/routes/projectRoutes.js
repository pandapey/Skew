import path from 'path'
import { Router } from 'express'
import { Project, Sprint, Milestone } from '../models/projectModels.js'
import { createResourceService } from '../services/resourceFactory.js'
import { projectService as svc, syncClientProject, createProjectWithClient, withId, withIds, hasProjectAccess, PROJECT_FULL_ACCESS } from '../services/projectService.js'
import { projectValidators } from '../validators/projectValidators.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
// Phase 6.12 (TASK 1): the staff side of the ONE shared project-document store.
// ClientProject.documents[] is the same sub-array the client portal writes to;
// `upload` is the same multer middleware; `emitToClient` is the same realtime
// channel the portal already listens on. Nothing here is a new module.
import { ClientProject } from '../models/clientModels.js'
import { upload } from '../middleware/upload.js'
import { emitToClient, emitResource } from '../realtime/index.js'
import { notifyUsersByName } from '../services/notificationService.js'

const router = Router()

// Projects are visible to all authenticated users; writes limited to leads/managers.
// External clients are blocked — they have their own scoped portal under /api/client.
const canWrite = authorize('Admin', 'Manager', 'HR')

// Phase 4 (Part 6): task writes additionally allow a PROJECT LEAD to manage
// tasks on the project they lead. A lead is usually an Employee, so the static
// role list above would reject them outright. This middleware therefore only
// enforces authentication + non-client (already applied by router.use below)
// and delegates the real decision to projectService.assertCanAssign(), which
// verifies lead-ship AND restricts the assignee to that project's members.
// RBAC is tightened, not bypassed: a non-lead without a privileged role still
// receives 403 from the service layer.
const canWriteTask = (req, res, next) => next()

router.use(protect, blockClient)

// Resource router that normalizes _id -> id on every response.
function projectResource(Model, config, validate) {
  const { service } = createResourceService(Model, config)
  const r = Router()
  r.get('/', asyncHandler(async (req, res) => {
    const result = await service.list(req.query)
    res.json({ ...result, data: withIds(result.data) })
  }))
  r.get('/all', asyncHandler(async (req, res) => res.json(withIds(await service.all()))))
  r.get('/:id', asyncHandler(async (req, res) => res.json(withId(await service.get(req.params.id)))))
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
// Phase 5.7 (Task 1): unified Client + Project creation. Declared before the
// generic '/tasks' writes so the path stays unambiguous. Same write guard as
// project creation -- this endpoint can provision a Client and a portal login,
// so it must never be looser than POST /project.
router.post('/with-client', canWrite, asyncHandler(async (req, res) => {
  res.status(201).json(await createProjectWithClient(req.body, req.user.name))
}))

router.post('/tasks', canWriteTask, asyncHandler(async (req, res) => res.status(201).json(await svc.createTask(req.body, req.user.name, req.user))))
router.put('/tasks/:id', canWriteTask, asyncHandler(async (req, res) => res.json(await svc.updateTask(req.params.id, req.body, req.user.name, req.user))))

// --- Phase 4: task submission (Part 7) & project-lead review (Part 8) ---
// Assignee-only submit; lead-only review. Both enforce a mandatory comment in
// the service layer so the rule holds for every caller of these endpoints.
// Declared BEFORE '/tasks/:id' style params above are matched for these exact
// sub-paths, and before the generic project CRUD mounted at the bottom.
router.get('/tasks/review-queue', asyncHandler(async (req, res) => res.json(await svc.reviewQueue(req.user))))

// --- Phase 5.5 (Task 5): task history + assignment acceptance ---
// '/tasks/history' is a LITERAL two-segment path declared here, above the
// '/tasks/:id/...' patterns and well above the generic project '/:id' CRUD
// mounted at the bottom, so it can never be swallowed as an :id.
// Scope is decided in the service from req.user: an employee gets their own
// history, a lead/manager/admin/HR gets project-wise history via ?project=.
router.get('/tasks/history', asyncHandler(async (req, res) => res.json(await svc.taskHistory(req.query, req.user))))

// Phase 6.2 (Task 2): PATCH '/tasks/:id/accept' and '/tasks/:id/decline' were
// REMOVED together with projectService.respondToAssignment(). An employee can
// never accept or refuse assigned work now - a task created by a lead is
// immediately 'Assigned' and the only assignee action is submit (below).
// The LEAD review endpoints that follow are deliberately untouched.
router.post('/tasks/:id/submit', asyncHandler(async (req, res) => res.json(await svc.submitTask(req.params.id, req.body, req.user))))
router.patch('/tasks/:id/review/approve', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'approve', req.body, req.user))))
router.patch('/tasks/:id/review/reject', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'reject', req.body, req.user))))
// Phase 5.5 (Task 5): 'return' sends reviewed work back for rework without
// marking it refused. Same guards and reviewer RBAC as approve/reject.
router.patch('/tasks/:id/review/return', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'return', req.body, req.user))))
router.patch('/tasks/:id/move', canWrite, asyncHandler(async (req, res) => res.json(await svc.moveTask(req.params.id, req.body.status, req.user.name))))
router.patch('/tasks/:id/sprint', canWrite, asyncHandler(async (req, res) => res.json(await svc.assignSprint(req.params.id, req.body.sprint, req.user.name))))
router.delete('/tasks/:id', canWrite, asyncHandler(async (req, res) => res.json(await svc.removeTask(req.params.id))))

// --- Comments / files / activity feed ---
router.get('/comments', asyncHandler(async (req, res) => res.json(await svc.comments(req.query))))
router.post('/comments', asyncHandler(async (req, res) => res.status(201).json(await svc.addComment(req.body, req.user.name))))
router.get('/files', asyncHandler(async (req, res) => res.json(await svc.files(req.query))))
router.post('/files', canWrite, asyncHandler(async (req, res) => res.status(201).json(await svc.addFile(req.body, req.user.name))))
router.get('/activity', asyncHandler(async (req, res) => res.json(await svc.activity(req.query))))

// --- Sprints & milestones (list scoped by project, plus CRUD) ---
router.get('/sprints/list', asyncHandler(async (req, res) => res.json(await svc.sprints(req.query))))
router.get('/milestones/list', asyncHandler(async (req, res) => res.json(await svc.milestones(req.query))))
router.use('/sprints', projectResource(Sprint, { searchFields: ['name', 'goal'], filterFields: ['project', 'status'] }, projectValidators.sprint).router)
router.use('/milestones', projectResource(Milestone, { searchFields: ['title'], filterFields: ['project', 'status'] }, projectValidators.milestone).router)

// Phase 6.9 (Task 15): single RBAC-scoped source for the main Calendar's
// merged Project Start / Deadline / Milestone / Task Deadline events. Declared
// before the generic '/:id' CRUD mount below so 'calendar-events' is never
// swallowed as a project id.
router.get('/calendar-events', asyncHandler(async (req, res) => res.json(await svc.calendarEvents(req.user))))

// =============================================================================
// Phase 6.12 (TASK 1) — STAFF ACCESS TO THE SHARED PROJECT DOCUMENT STORE
//
// ROOT CAUSE of "the employee project page has no Documents tab":
//   Project documents physically live in ONE place - the `documents[]`
//   sub-array of the ClientProject mirror document (models/clientModels.js).
//   Every existing read/write of that array (uploadClientDocument,
//   deleteClientDocument, downloadClientDocument) is mounted on /api/client*,
//   and clientRoutes.js opens with `router.use(protect, authorize('Client'))`.
//   Staff therefore received 403 on every one of those routes, and this router
//   opens with `protect, blockClient`, so a Client can never reach these ones.
//   The two portals were hard-partitioned at the router level: there was no
//   staff-side door into the shared array at all. That is why the employee
//   project page could not show documents - not a missing UI, a missing route.
//
// FIX: open a staff-side door onto the SAME array. No new model, no new
//   collection, no second uploads directory, no duplicated document logic - the
//   handlers below are the staff counterparts of the client ones and mutate the
//   identical `p.documents` sub-document. A file uploaded by an employee is
//   literally the same record the client reads, and vice versa, which is what
//   makes "one shared project document source / no duplicated storage" true.
//
// REALTIME: uploads and deletes re-emit `emitToClient(clientId,
//   'client:document', ...)` - the exact event and payload shape the client
//   portal already subscribes to - so a staff upload appears in the client
//   portal immediately, with no client-side change whatsoever. `emitResource`
//   additionally busts the staff-side caches, which is how the other staff
//   surfaces on this router already notify each other.
//
// RBAC (tightened, never weakened):
//   • This router is already `protect, blockClient`, so Clients cannot use
//     these routes and keep using their own scoped ones.
//   • Every handler resolves the real Project first and then calls the EXISTING
//     `hasProjectAccess(project, user)` - the same helper GET /:id/detail uses -
//     so Admin/Manager/HR keep full access while an Employee must be the lead,
//     a named member, or an assignee of a task in that project. A staff member
//     with no relationship to the project gets 404/403 exactly as before.
//   • Delete keeps the SAME ownership rule the client side enforces: you may
//     only delete a document you uploaded. Privileged roles
//     (PROJECT_FULL_ACCESS) may delete any document on projects they
//     administer, which mirrors their existing authority everywhere else in
//     this router - it grants an Employee nothing.
// =============================================================================

// Resolve the Project + its ClientProject mirror, enforcing project access.
// One helper so the four handlers below cannot drift apart on authorization.
async function loadSharedDocumentStore(req, { lean = false } = {}) {
  const project = await Project.findById(req.params.id).lean()
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
  // Identical document shape to clientController.uploadClientDocument - same
  // fields, same size formatting, same /uploads url - so a single list can
  // render records from either side without special-casing.
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
  // Notify the project team by NAME through the existing shared helper rather
  // than re-implementing the Notification fan-out.
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
  // Same on-disk path-safety pattern as clientController.downloadClientDocument
  // and fileRoutes.js: resolve under ./uploads and refuse anything that escapes.
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
  // Task 5: sync a ClientProject record if a client is named
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
  res.status(201).json(withId(obj))
}))
router.put('/:id', canWrite, asyncHandler(async (req, res) => {
  const before = await Project.findById(req.params.id).lean()
  const updated = await projectStore.update(req.params.id, req.body)
  const obj = updated.toObject ? updated.toObject() : updated
  if (before) await svc.notifyMembersChanged(before, obj, req.user?.name || 'System')
  // Phase 5.4 (Task 3) root cause #1: the Client Portal mirror was only synced
  // on creation (see POST '/' above) and never refreshed on edit, so
  // client-visible status/progress/team/budget/dates went stale the moment a
  // project changed. Mirrors the exact call already used on create.
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
  res.json(withId(obj))
}))
router.delete('/:id', canWrite, asyncHandler(async (req, res) => res.json(await projectStore.remove(req.params.id))))

export default router
