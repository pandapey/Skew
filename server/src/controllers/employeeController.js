import { employeeService as svc } from '../services/employeeService.js'
import { asyncHandler } from '../utils/asyncHandler.js'

// Thin controller: parse request → call service → shape response.
export const employeeController = {
  list: asyncHandler(async (req, res) => {
    const result = await svc.list(req.query)
    res.json(result)
  }),

  stats: asyncHandler(async (req, res) => {
    res.json(await svc.stats())
  }),

  // Phase 9 (My Profile): returns ONLY the caller's own Employee record. The
  // record is resolved from req.user (the JWT identity) — there is no :id in
  // the path, so an employee can never read another person's profile by
  // changing a URL or request body. Admin/Manager can still view any profile
  // through the existing /employees/:id detail endpoint.
  myProfile: asyncHandler(async (req, res) => {
    const emp = await svc.getSelf(req.user)
    if (!emp) {
      return res.status(404).json({ message: 'No employee profile found for this account' })
    }
    res.json(emp)
  }),

  get: asyncHandler(async (req, res) => {
    res.json(await svc.getById(req.params.id))
  }),

  update: asyncHandler(async (req, res) => {
    res.json(await svc.update(req.params.id, req.body))
  }),

  remove: asyncHandler(async (req, res) => {
    res.json(await svc.remove(req.params.id))
  }),

  bulkRemove: asyncHandler(async (req, res) => {
    res.json(await svc.bulkRemove(req.body.ids))
  }),

  bulkUpdate: asyncHandler(async (req, res) => {
    res.json(await svc.bulkUpdate(req.body.ids, req.body.patch))
  }),

  uploadPhoto: asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded' })
    res.status(201).json(await svc.setPhoto(req.params.id, `/uploads/${req.file.filename}`))
  }),

  uploadDocument: asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No document uploaded' })
    const type = req.file.mimetype.includes('pdf') ? 'pdf'
      : /sheet|excel/.test(req.file.mimetype) ? 'excel'
      : req.file.mimetype.includes('image') ? 'image' : 'word'
    const doc = await svc.addDocument(req.params.id, {
      name: req.file.originalname,
      type,
      category: req.body.category || 'General',
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
    })
    res.status(201).json(doc)
  }),

  // PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — self-edit + private docs.
  // The target Employee is ALWAYS derived from req.user (the JWT), never from
  // a client-supplied id, so an employee can only ever edit/read their own
  // record and can never act on behalf of another employee.
  updateSelf: asyncHandler(async (req, res) => {
    res.json(await svc.updateSelf(req.user, req.body || {}))
  }),

  uploadSelfDocument: asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No document uploaded' })
    const doc = await svc.addSelfDocument(req.user, req.file, req.body?.category)
    res.status(201).json(doc)
  }),

  downloadSelfDocument: asyncHandler(async (req, res) => {
    const { absPath, name, mimeType } = await svc.getSelfDocument(req.user, req.params.docId)
    res.setHeader('Content-Type', mimeType || 'application/octet-stream')
    res.download(absPath, name)
  }),

  deleteSelfDocument: asyncHandler(async (req, res) => {
    res.json(await svc.deleteSelfDocument(req.user, req.params.docId))
  }),

  // Admin/Manager door onto a private employee document (normal
  // employee-management permission — the route is canWrite-guarded).
  downloadDocument: asyncHandler(async (req, res) => {
    const { absPath, name, mimeType } = await svc.getDocumentFor(req.user, req.params.id, req.params.docId)
    res.setHeader('Content-Type', mimeType || 'application/octet-stream')
    res.download(absPath, name)
  }),
}
