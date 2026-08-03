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
}
