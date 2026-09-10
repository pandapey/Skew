import { Router } from 'express'
import { Project, Sprint, Milestone, ProjectFile, ProjectActivity } from '../models/projectModels.js'
import { createResourceService } from '../services/resourceFactory.js'
import { projectService as svc, syncClientProject, createProjectWithClient, recordProjectAdvance, withId, withIds, hasProjectAccess, projectQueryScope, PROJECT_FULL_ACCESS, resolveProjectRef } from '../services/projectService.js'
import { projectValidators } from '../validators/projectValidators.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
import { ClientProject } from '../models/clientModels.js'
import { upload } from '../middleware/upload.js'
import { emitToClient, emitResource } from '../realtime/index.js'
import { notifyUsersByName } from '../services/notificationService.js'

const router = Router()

const canWrite = authorize('Admin', 'Manager')

const canWriteTask = (req, res, next) => next()

router.use(protect, blockClient)

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

router.get('/stats', asyncHandler(async (req, res) => res.json(await svc.stats(req.user))))

router.get('/tasks', asyncHandler(async (req, res) => res.json(await svc.tasks(req.query, req.user))))

router.get('/tasks/mine/count', asyncHandler(async (req, res) => res.json(await svc.myTasksCount(req.user))))

router.post('/with-client', canWrite, asyncHandler(async (req, res) => {
  res.status(201).json(await createProjectWithClient(req.body, req.user.name))
}))

router.post('/tasks', canWriteTask, asyncHandler(async (req, res) => res.status(201).json(await svc.createTask(req.body, req.user.name, req.user))))
router.put('/tasks/:id', canWriteTask, asyncHandler(async (req, res) => res.json(await svc.updateTask(req.params.id, req.body, req.user.name, req.user))))

router.get('/tasks/review-queue', asyncHandler(async (req, res) => res.json(await svc.reviewQueue(req.user))))

router.get('/tasks/history', asyncHandler(async (req, res) => res.json(await svc.taskHistory(req.query, req.user))))

router.get('/assignees', asyncHandler(async (req, res) => res.json(await svc.listTaskAssignees())))

router.post('/tasks/:id/submit', asyncHandler(async (req, res) => res.json(await svc.submitTask(req.params.id, req.body, req.user))))

router.post('/tasks/:id/start', asyncHandler(async (req, res) => res.json(await svc.startTask(req.params.id, req.user))))

router.post('/tasks/:id/view', asyncHandler(async (req, res) => res.json(await svc.markTaskViewed(req.params.id, req.user))))

router.post('/tasks/:id/pause', asyncHandler(async (req, res) => res.json(await svc.pauseTask(req.params.id, req.body, req.user))))
router.post('/tasks/:id/resume', asyncHandler(async (req, res) => res.json(await svc.resumeTask(req.params.id, req.user))))

router.patch('/tasks/:id/status', asyncHandler(async (req, res) => res.json(await svc.setTaskStatus(req.params.id, req.body.status, req.user))))

router.post('/tasks/:id/attachments', upload.single('file'), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addTaskAttachment(req.params.id, req.file, req.body, req.user))
}))
router.patch('/tasks/:id/review/approve', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'approve', req.body, req.user))))
router.patch('/tasks/:id/review/reject', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'reject', req.body, req.user))))
router.patch('/tasks/:id/review/return', asyncHandler(async (req, res) => res.json(await svc.reviewTask(req.params.id, 'return', req.body, req.user))))
router.patch('/tasks/:id/move', canWrite, asyncHandler(async (req, res) => res.json(await svc.moveTask(req.params.id, req.body.status, req.user.name))))
router.patch('/tasks/:id/sprint', canWrite, asyncHandler(async (req, res) => res.json(await svc.assignSprint(req.params.id, req.body.sprint, req.user.name))))
router.delete('/tasks/:id', canWrite, asyncHandler(async (req, res) => res.json(await svc.removeTask(req.params.id))))

router.get('/comments', asyncHandler(async (req, res) => res.json(await svc.comments(req.query, req.user))))
router.post('/comments', asyncHandler(async (req, res) => res.status(201).json(await svc.addComment(req.body, req.user.name, req.user))))
router.get('/files', asyncHandler(async (req, res) => res.json(await svc.files(req.query, req.user))))
router.post('/files', canWrite, asyncHandler(async (req, res) => res.status(201).json(await svc.addFile(req.body, req.user.name))))
router.get('/activity', asyncHandler(async (req, res) => res.json(await svc.activity(req.query, req.user))))

router.get('/sprints/list', asyncHandler(async (req, res) => res.json(await svc.sprints(req.query, req.user))))
router.get('/milestones/list', asyncHandler(async (req, res) => res.json(await svc.milestones(req.query, req.user))))
router.use('/sprints', projectResource(Sprint, { searchFields: ['name', 'goal'], filterFields: ['project', 'status'] }, projectValidators.sprint).router)
router.use('/milestones', projectResource(Milestone, { searchFields: ['title'], filterFields: ['project', 'status'] }, projectValidators.milestone).router)

router.get('/calendar-events', asyncHandler(async (req, res) => res.json(await svc.calendarEvents(req.user))))

async function loadSharedDocumentStore(req, { lean = false } = {}) {
  const project = await resolveProjectRef(req.params.id)
  if (!project) throw new ApiError(404, 'Project not found')
  if (!(await hasProjectAccess(project, req.user))) {
    throw new ApiError(403, 'You do not have access to this project')
  }
  const query = ClientProject.findOne({ sourceProjectId: project._id })
  const cp = lean ? await query.lean() : await query
  return { project, cp }
}

// Opt2: primary doc store is ProjectFile, legacy cp.documents as fallback
router.get('/:id/documents', asyncHandler(async (req, res) => {
  const { project, cp } = await loadSharedDocumentStore(req, { lean: true })
  const files = await ProjectFile.find({ project: project._id }).sort({ createdAt: -1 }).lean().catch(()=>[])
  const fileDocs = files.map(f => ({
    _id: f._id, name: f.name, type: f.type, size: `${(f.size/1024).toFixed(1)} KB`, uploadedBy: f.uploadedBy, uploadedAt: f.createdAt, url: f.url, source: 'project'
  }))
  const legacyDocs = cp?.documents || []
  // merge, ProjectFile first
  res.json([...fileDocs, ...legacyDocs])
}))

router.post('/:id/documents', upload.single('file'), asyncHandler(async (req, res) => {
  const { project, cp } = await loadSharedDocumentStore(req)
  if (!req.file) throw new ApiError(400, 'No file uploaded')
  if (!req.file.buffer) throw new ApiError(400, 'No file uploaded')
  const uploader = req.user?.name || 'Staff'
  const { saveBufferToGridFS } = await import('../utils/mongoStorage.js')
  // MongoDB Atlas only — bytes in GridFS.
  const gridFsId = await saveBufferToGridFS(req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    metadata: { kind: 'project-document', project: String(project._id) },
  })
  const doc = {
    name: req.file.originalname,
    type: String(req.body?.category || 'Other'),
    size: `${(req.file.size / 1024).toFixed(1)} KB`,
    uploadedBy: uploader,
    uploadedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    url: '',
    fileId: gridFsId,
  }
  // Opt2: store in ProjectFile (source of truth) + mirror to legacy for portal compat if exists
  const fileDoc = await ProjectFile.create({
    project: project._id,
    name: doc.name, type: doc.type.toLowerCase(), size: req.file.size,
    url: '', fileId: gridFsId, mimeType: req.file.mimetype, contentType: req.file.mimetype,
    storage: 'gridfs', uploadedBy: uploader,
  }).catch(()=>null)
  if (fileDoc) {
    fileDoc.url = `/project/files/${String(fileDoc._id)}/download`
    await fileDoc.save().catch(()=>{})
    doc.url = fileDoc.url
  }
  await ProjectActivity.create({ project: project._id, actor: uploader, action: `uploaded document "${doc.name}"`, target: doc.name }).catch(()=>{})
  if (cp) {
    cp.documents.push(doc)
    cp.activity.push({ text: `${uploader} uploaded document "${doc.name}"`, at: new Date().toISOString(), by: uploader })
    await cp.save().catch(()=>{})
    emitToClient(cp.clientId, 'client:document', { project: cp, document: doc })
    emitResource('project-documents', 'post', { id: String(cp._id) })
  }
  if (project.clientId) emitToClient(project.clientId, 'client:document', { project, document: doc })
  emitResource('project-documents', 'post', { id: String(project._id) })
  // notify team via Project members
  const teamNames = cp ? [...new Set((cp.team || []).map((t) => t.name).filter((n) => n && n !== uploader))] : [...new Set((project.members || []).map(m=>m.name).filter(n=>n && n!==uploader))]
  if (teamNames.length) {
    await notifyUsersByName(teamNames, {
      type: 'project',
      title: `New document on ${project.name}`,
      body: `${uploader} uploaded "${doc.name}"`,
      sender: uploader,
    }).catch(() => {})
  }
  res.status(201).json(fileDoc ? { ...doc, _id: fileDoc._id, source: 'project' } : doc)
}))

router.delete('/:id/documents/:docId', asyncHandler(async (req, res) => {
  const { project, cp } = await loadSharedDocumentStore(req)
  // Try ProjectFile first
  let pf = null
  try { pf = await ProjectFile.findOne({ _id: req.params.docId, project: project._id }) } catch {}
  if (pf) {
    const privileged = PROJECT_FULL_ACCESS.includes(req.user?.role)
    if (!privileged && pf.uploadedBy !== (req.user?.name || '')) throw new ApiError(403, 'You can only delete documents you uploaded')
    const { deleteGridFSFile, isGridFsId } = await import('../utils/mongoStorage.js')
    if (pf.fileId && isGridFsId(pf.fileId)) await deleteGridFSFile(pf.fileId)
    await pf.deleteOne()
    if (cp) {
      const legacyDoc = cp.documents.id(req.params.docId)
      if (legacyDoc) { legacyDoc.deleteOne(); await cp.save().catch(()=>{}) }
    }
    if (project.clientId) emitToClient(project.clientId, 'client:document', { project, deletedId: req.params.docId })
    if (cp) emitToClient(cp.clientId, 'client:document', { project: cp, deletedId: req.params.docId })
    emitResource('project-documents', 'delete', { id: String(project._id) })
    return res.json({ deleted: true })
  }
  if (!cp) throw new ApiError(404, 'Document not found')
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
  const { project, cp } = await loadSharedDocumentStore(req, { lean: true })
  // Try ProjectFile first (GridFS)
  try {
    const pf = await ProjectFile.findOne({ _id: req.params.docId, project: project._id }).lean()
    if (pf) {
      const { streamGridFSFile, isGridFsId } = await import('../utils/mongoStorage.js')
      const gid = pf.fileId && isGridFsId(pf.fileId) ? pf.fileId : null
      if (gid) {
        return streamGridFSFile(gid, res, {
          filename: pf.name,
          contentType: pf.contentType || pf.mimeType,
          disposition: 'attachment',
        })
      }
      // legacy disk fallback
      if (pf.url && String(pf.url).startsWith('/uploads/')) {
        const path = await import('path')
        const fs = await import('fs')
        const abs = path.resolve(process.cwd(), `.${pf.url}`)
        const root = path.resolve(process.cwd(), 'uploads')
        if (!abs.startsWith(root)) throw new ApiError(400, 'Invalid file path')
        return res.download(abs, pf.name)
      }
      throw new ApiError(410, 'This file was stored outside MongoDB. Please re-upload it.')
    }
  } catch (e) {
    if (e?.statusCode) throw e
  }
  if (cp) {
    const legacy = (cp.documents || []).find((d) => String(d._id) === req.params.docId)
    if (legacy) {
      // legacy embedded docs had no binary store of their own — check for GridFS ref
      const { streamGridFSFile, isGridFsId } = await import('../utils/mongoStorage.js')
      if (legacy.fileId && isGridFsId(legacy.fileId)) {
        return streamGridFSFile(legacy.fileId, res, { filename: legacy.name, disposition: 'attachment' })
      }
      if (legacy.url && String(legacy.url).startsWith('/project/files/')) {
        const m = String(legacy.url).match(/\/project\/files\/([0-9a-fA-F]{24})\/download/)
        if (m) {
          const pf2 = await ProjectFile.findById(m[1]).lean()
          if (pf2?.fileId && isGridFsId(pf2.fileId)) {
            return streamGridFSFile(pf2.fileId, res, { filename: pf2.name, contentType: pf2.contentType, disposition: 'attachment' })
          }
        }
      }
    }
  }
  throw new ApiError(404, 'Document not found')
}))

// Direct GridFS download for any ProjectFile (used by task attachments + doc urls)
router.get('/files/:fileId/download', asyncHandler(async (req, res) => {
  const pf = await ProjectFile.findById(req.params.fileId).lean()
  if (!pf) throw new ApiError(404, 'File not found')
  // access check: must have project access
  const { resolveProjectRef, hasProjectAccess } = await import('../services/projectService.js')
  const project = await resolveProjectRef(String(pf.project))
  if (!project || !(await hasProjectAccess(project, req.user))) throw new ApiError(403, 'No access to this project')
  const { streamGridFSFile, isGridFsId } = await import('../utils/mongoStorage.js')
  if (pf.fileId && isGridFsId(pf.fileId)) {
    return streamGridFSFile(pf.fileId, res, {
      filename: pf.name,
      contentType: pf.contentType || pf.mimeType,
      disposition: 'attachment',
    })
  }
  if (pf.url && String(pf.url).startsWith('/uploads/')) {
    const path = await import('path')
    const abs = path.resolve(process.cwd(), `.${pf.url}`)
    const root = path.resolve(process.cwd(), 'uploads')
    if (!abs.startsWith(root)) throw new ApiError(400, 'Invalid file path')
    return res.download(abs, pf.name)
  }
  throw new ApiError(410, 'This file was stored outside MongoDB. Please re-upload it.')
}))

router.get('/:id/detail', asyncHandler(async (req, res) => res.json(await svc.detail(req.params.id, req.user))))

const projectStore = createResourceService(Project, { searchFields: ['name', 'code', 'client'], filterFields: ['status', 'priority', 'lead'] }).service
router.get('/', asyncHandler(async (req, res) => res.json(await svc.listScoped(req.query, req.user))))
router.get('/all', asyncHandler(async (req, res) => res.json(await svc.allScoped(req.user))))
router.get('/:id', asyncHandler(async (req, res) => res.json(await svc.getScoped(req.params.id, req.user))))
router.post('/', canWrite, projectValidators.project, asyncHandler(async (req, res) => {
  const created = await projectStore.create(req.body)
  const obj = created.toObject ? created.toObject() : created
  await svc.notifyProjectCreated(obj, req.user?.name || 'System')
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
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
  await syncClientProject(obj, req.user?.name || 'System').catch(() => {})
  res.json(withId(obj))
}))
router.delete('/:id', canWrite, asyncHandler(async (req, res) => {
  const resolved = await resolveProjectRef(req.params.id)
  if (!resolved) throw new ApiError(404, 'Project not found')
  res.json(await projectStore.remove(resolved._id))
}))

export default router
