// Generic CRUD controller factory — keeps route modules DRY.
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'

export const crudController = (Model) => ({
  list: async (req, res) => {
    const { page = 1, limit = 100, search } = req.query
    const filter = search ? { name: { $regex: escapeRegex(search), $options: 'i' } } : {}
    const safeLimit = clampLimit(limit, 100)
    const docs = await Model.find(filter)
      .skip((clampPage(page) - 1) * safeLimit)
      .limit(safeLimit)
      .sort({ createdAt: -1 })
    res.json(docs)
  },
  get: async (req, res) => {
    const doc = await Model.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Not found' })
    res.json(doc)
  },
  create: async (req, res) => {
    const doc = await Model.create(req.body)
    res.status(201).json(doc)
  },
  update: async (req, res) => {
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!doc) return res.status(404).json({ message: 'Not found' })
    res.json(doc)
  },
  remove: async (req, res) => {
    const doc = await Model.findByIdAndDelete(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Not found' })
    res.json({ message: 'Deleted', id: req.params.id })
  },
})
