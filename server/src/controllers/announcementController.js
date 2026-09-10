import { Post } from '../models/announcementModels.js'
import { crudController } from './crudController.js'
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'

const base = crudController(Post)
const viewerId = (req) => String(req.user?._id || req.user?.id || '')
const withViewerState = (doc, req) => {
  const json = typeof doc?.toJSON === 'function' ? doc.toJSON() : { ...doc }
  const uid = viewerId(req)
  const likedBy = Array.isArray(json.likedBy) ? json.likedBy : []
  const readBy = Array.isArray(json.readBy) ? json.readBy : []
  delete json.likedBy
  delete json.readBy
  return { ...json, liked: Boolean(uid) && likedBy.includes(uid), read: Boolean(uid) && readBy.includes(uid) }
}

export const announcementController = {
  ...base,

  get: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    res.json(withViewerState(doc, req))
  },

  list: async (req, res) => {
    const { search, type, pinned, sort = 'recent', page = 1, limit = 100 } = req.query
    const filter = {}
    if (search) filter.title = { $regex: escapeRegex(search), $options: 'i' }
    if (type && type !== 'all') filter.type = type
    if (pinned) filter.pinned = pinned === 'true' || pinned === true
    const sortOpt = sort === 'likes' ? { likes: -1 } : { date: -1 }
    const safeLimit = clampLimit(limit, 100)
    const docs = await Post.find(filter)
      .sort(sortOpt)
      .skip((clampPage(page) - 1) * safeLimit)
      .limit(safeLimit)
    res.json(docs.map((d) => withViewerState(d, req)))
  },

  like: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const likedBy = Array.isArray(doc.likedBy) ? doc.likedBy : []
    const already = likedBy.includes(uid)
    doc.likedBy = already ? likedBy.filter((x) => x !== uid) : [...likedBy, uid]
    doc.likes = Math.max(0, (doc.likes || 0) + (already ? -1 : 1))
    await doc.save()
    res.json(withViewerState(doc, req))
  },

  markRead: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const readBy = Array.isArray(doc.readBy) ? doc.readBy : []
    if (!readBy.includes(uid)) {
      doc.readBy = [...readBy, uid]
      await doc.save()
    }
    res.json(withViewerState(doc, req))
  },

  unreadCount: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const count = await Post.countDocuments({ readBy: { $ne: uid } })
    res.json({ count })
  },

  comment: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const { body } = req.body
    if (!body || !body.trim()) return res.status(400).json({ message: 'Comment body is required' })
    doc.comments.push({
      author: req.user?.name || 'Anonymous',
      body: body.trim(),
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    })
    await doc.save()
    res.status(201).json(withViewerState(doc, req))
  },

  uploadMedia: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (!req.file.buffer) return res.status(400).json({ message: 'No file uploaded' })
    const type = req.file.mimetype.startsWith('image/')
      ? 'image'
      : req.file.mimetype.startsWith('video/')
        ? 'video'
        : 'file'
    // MongoDB Atlas only — bytes in GridFS.
    const { saveBufferToGridFS } = await import('../utils/mongoStorage.js')
    const gridFsId = await saveBufferToGridFS(req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      metadata: { kind: 'announcement', post: String(doc._id) },
    })
    doc.attachments.push({
      name: req.file.originalname,
      type,
      url: '',
      fileId: gridFsId,
      contentType: req.file.mimetype,
      storage: 'gridfs',
      size: req.file.size,
    })
    await doc.save()
    // fill download url now that we know the attachment subdoc id
    const att = doc.attachments.at(-1)
    att.url = `/announcements/${String(doc._id)}/attachments/${String(att._id)}/download`
    await doc.save()
    res.status(201).json(withViewerState(doc, req))
  },

  downloadMedia: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const att = doc.attachments.id(req.params.attId)
    if (!att) return res.status(404).json({ message: 'Attachment not found' })
    const { streamGridFSFile, isGridFsId } = await import('../utils/mongoStorage.js')
    if (att.fileId && isGridFsId(att.fileId)) {
      return streamGridFSFile(att.fileId, res, {
        filename: att.name,
        contentType: att.contentType,
        disposition: att.type === 'image' || att.type === 'video' ? 'inline' : 'attachment',
      })
    }
    if (att.url && String(att.url).startsWith('/uploads/')) {
      const path = await import('path')
      const abs = path.resolve(process.cwd(), `.${att.url}`)
      const root = path.resolve(process.cwd(), 'uploads')
      if (!abs.startsWith(root)) return res.status(400).json({ message: 'Invalid file path' })
      const fs = await import('fs')
      if (!fs.existsSync(abs)) return res.status(404).json({ message: 'File not found' })
      return res.sendFile(abs)
    }
    return res.status(410).json({ message: 'This file was stored outside MongoDB. Please re-upload it.' })
  },
}
