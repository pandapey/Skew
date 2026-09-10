import { employeeService as svc } from '../services/employeeService.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { saveBufferToGridFS, streamGridFSFile } from '../utils/mongoStorage.js'
import fs from 'fs'
import path from 'path'

const legacyProfilePath = (diskName) => {
  const abs = path.resolve(process.cwd(), 'profile-uploads', String(diskName || ''))
  if (!abs.startsWith(path.resolve(process.cwd(), 'profile-uploads'))) return null
  return abs
}

export const employeeController = {
  list: asyncHandler(async (req, res) => {
    const result = await svc.list(req.query)
    res.json(result)
  }),

  stats: asyncHandler(async (req, res) => {
    res.json(await svc.stats())
  }),

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
    if (!req.file.buffer) return res.status(400).json({ message: 'Photo upload failed' })
    // MongoDB Atlas only — photo bytes in GridFS, avatar stores the GridFS id.
    const gridFsId = await saveBufferToGridFS(req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      metadata: { kind: 'employee-photo', employee: req.params.id },
    })
    res.status(201).json(await svc.setPhoto(req.params.id, gridFsId))
  }),

  uploadDocument: asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No document uploaded' })
    if (!req.file.buffer) return res.status(400).json({ message: 'Document upload failed' })
    const type = req.file.mimetype.includes('pdf') ? 'pdf'
      : /sheet|excel/.test(req.file.mimetype) ? 'excel'
      : req.file.mimetype.includes('image') ? 'image' : 'word'
    // MongoDB Atlas only — document bytes in GridFS.
    const gridFsId = await saveBufferToGridFS(req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      metadata: { kind: 'employee-doc', employee: req.params.id },
    })
    const doc = await svc.addDocument(req.params.id, {
      name: req.file.originalname,
      type,
      category: req.body.category || 'General',
      size: req.file.size,
      mimeType: req.file.mimetype,
      contentType: req.file.mimetype,
      diskName: gridFsId,
      fileId: gridFsId,
      storage: 'gridfs',
      url: `/employees/${req.params.id}/documents/`,
    })
    // fix url to real API path now that we know the subdoc id
    const realUrl = `/employees/${req.params.id}/documents/${String(doc._id)}`
    try {
      const { Employee } = await import('../models/Employee.js')
      const parent = await Employee.findOne({ 'documents._id': doc._id })
      if (parent) {
        await Employee.updateOne(
          { _id: parent._id, 'documents._id': doc._id },
          { $set: { 'documents.$.url': realUrl } },
        )
      }
    } catch {}
    res.status(201).json({ ...(doc.toObject ? doc.toObject() : doc), url: realUrl })
  }),

  updateSelf: asyncHandler(async (req, res) => {
    res.json(await svc.updateSelf(req.user, req.body || {}))
  }),

  uploadSelfDocument: asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No document uploaded' })
    const doc = await svc.addSelfDocument(req.user, req.file, req.body?.category)
    res.status(201).json(doc)
  }),

  downloadSelfDocument: asyncHandler(async (req, res) => {
    const result = await svc.getSelfDocument(req.user, req.params.docId)
    if (result.isGridFS) {
      return streamGridFSFile(result.gridFsId, res, {
        filename: result.name,
        contentType: result.mimeType,
        disposition: 'attachment',
      })
    }
    const abs = legacyProfilePath(result.legacyDiskName)
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ message: 'Document not found' })
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream')
    res.download(abs, result.name)
  }),

  deleteSelfDocument: asyncHandler(async (req, res) => {
    res.json(await svc.deleteSelfDocument(req.user, req.params.docId))
  }),

  downloadDocument: asyncHandler(async (req, res) => {
    const result = await svc.getDocumentFor(req.user, req.params.id, req.params.docId)
    if (result.isGridFS) {
      return streamGridFSFile(result.gridFsId, res, {
        filename: result.name,
        contentType: result.mimeType,
        disposition: 'attachment',
      })
    }
    const abs = legacyProfilePath(result.legacyDiskName)
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ message: 'Document not found' })
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream')
    res.download(abs, result.name)
  }),
}
