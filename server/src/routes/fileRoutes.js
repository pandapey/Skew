import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { Folder, FileItem } from '../models/fileModels.js'
import { upload } from '../middleware/upload.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect } from '../middleware/auth.js'
import { uploadToDrive, driveDownload, deleteFromDrive } from '../utils/driveUpload.js'

const router = Router()

const STORAGE_LIMIT = Number(process.env.FILE_STORAGE_LIMIT) || 1024 * 1024 * 1024

const norm = (doc) => {
  if (!doc) return doc
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  o.id = String(doc._id)
  return o
}

function detectType(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (/\.(xlsx?|csv)$/i.test(name) || mime.includes('excel') || mime.includes('spreadsheet')) return 'excel'
  if (/\.(docx?|txt|rtf)$/i.test(name) || mime.includes('word') || mime.includes('document') || mime.includes('text/')) return 'word'
  return 'other'
}

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads')
const diskPath = (url) => {
  const p = path.resolve(process.cwd(), String(url).replace(/^\//, ''))
  if (!p.startsWith(UPLOADS_ROOT)) {
    throw new ApiError(400, 'Invalid file path')
  }
  return p
}

const isDriveId = (url) => url && !String(url).startsWith('/')

const GENERAL_FILE_FILTER = { source: { $ne: 'chat' } }

const assertNotChatFile = (file) => {
  if (file && file.source === 'chat') throw new ApiError(404, 'File not found')
}

const blockClient = (req, res, next) =>
  req.user.role === 'Client'
    ? res.status(403).json({ message: 'Forbidden: clients cannot access internal files' })
    : next()
router.use(protect, blockClient)

router.get('/', asyncHandler(async (req, res) => {
  const { folder, search, type, trashed } = req.query
  const isTrashed = trashed === 'true' || trashed === '1'
  const folderId = folder && folder !== 'root' && folder !== 'null' ? folder : null

  const folderFilter = { isTrashed: isTrashed, parent: folderId }
  const fileFilter = { isTrashed: isTrashed, folder: folderId, ...GENERAL_FILE_FILTER }
  if (search) {
    const rx = new RegExp(search, 'i')
    folderFilter.name = rx
    fileFilter.$or = [{ name: rx }, { tags: rx }]
  }
  if (type) fileFilter.type = type

  const [folders, files] = await Promise.all([
    Folder.find(folderFilter).sort({ name: 1 }).lean(),
    FileItem.find(fileFilter).sort({ updatedAt: -1 }).lean(),
  ])
  res.json({ folders: folders.map(norm), files: files.map(norm) })
}))

router.get('/storage', asyncHandler(async (req, res) => {
  const files = await FileItem.find({ isTrashed: false, ...GENERAL_FILE_FILTER }).lean()
  const byType = {}
  let used = 0
  files.forEach((f) => {
    used += f.size || 0
    byType[f.type] = (byType[f.type] || 0) + (f.size || 0)
  })
  res.json({ used, limit: STORAGE_LIMIT, count: files.length, byType })
}))

router.get('/trash', asyncHandler(async (req, res) => {
  const { search } = req.query
  const folderFilter = { isTrashed: true }
  const fileFilter = { isTrashed: true, ...GENERAL_FILE_FILTER }
  if (search) {
    const rx = new RegExp(search, 'i')
    folderFilter.name = rx
    fileFilter.$or = [{ name: rx }, { tags: rx }]
  }
  const [folders, files] = await Promise.all([
    Folder.find(folderFilter).lean(),
    FileItem.find(fileFilter).lean(),
  ])
  res.json({ folders: folders.map(norm), files: files.map(norm) })
}))

router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  if (!ids.length) return res.status(400).json({ message: 'ids array required' })
  if (ids.length > 200) return res.status(400).json({ message: 'Too many files (max 200)' })

  const isPrivileged = ['Admin', 'Manager'].includes(req.user.role)
  const moved = []
  const failed = []

  for (const id of ids) {
    try {
      const file = await FileItem.findById(id)
      if (!file) throw new ApiError(404, 'File not found')
      assertNotChatFile(file)
      const isOwner = file.owner === req.user.name || file.owner === req.user.email
      if (!isPrivileged && !isOwner) throw new ApiError(403, 'You can only delete files you own')
      if (file.isTrashed) throw new ApiError(400, 'Already in the recycle bin')
      file.isTrashed = true
      file.trashedAt = new Date()
      await file.save()
      moved.push(id)
    } catch (e) {
      failed.push({ id, message: e?.message || 'Delete failed' })
    }
  }

  res.json({ moved, failed, movedCount: moved.length, failedCount: failed.length })
}))

router.post('/bulk-hard-delete', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  if (!ids.length) return res.status(400).json({ message: 'ids array required' })
  if (ids.length > 200) return res.status(400).json({ message: 'Too many files (max 200)' })

  const isPrivileged = ['Admin', 'Manager'].includes(req.user.role)
  const deleted = []
  const failed = []

  for (const id of ids) {
    try {
      const file = await FileItem.findById(id)
      if (!file) throw new ApiError(404, 'File not found')
      assertNotChatFile(file)
      const isOwner = file.owner === req.user.name || file.owner === req.user.email
      if (!isPrivileged && !isOwner) throw new ApiError(403, 'You can only delete files you own')
      for (const v of file.versions || []) {
        if (isDriveId(v.filename)) {
          await deleteFromDrive(v.filename)
        } else {
          const p = diskPath(`/uploads/${v.filename}`)
          if (fs.existsSync(p)) fs.unlinkSync(p)
        }
      }
      if (isDriveId(file.url)) {
        await deleteFromDrive(file.url)
      }
      await FileItem.findByIdAndDelete(id)
      deleted.push(id)
    } catch (e) {
      failed.push({ id, message: e?.message || 'Delete failed' })
    }
  }

  res.json({ deleted, failed, deletedCount: deleted.length, failedCount: failed.length })
}))

router.post('/folders', asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ message: 'Folder name required' })
  const parent = req.body.parent && req.body.parent !== 'root' ? req.body.parent : null
  const folder = await Folder.create({ name, parent, owner: req.user.name })
  res.status(201).json(norm(folder))
}))

router.patch('/folders/:id', asyncHandler(async (req, res) => {
  const update = {}
  if (req.body.name) update.name = req.body.name
  if ('parent' in req.body) update.parent = req.body.parent && req.body.parent !== 'root' ? req.body.parent : null
  const folder = await Folder.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  res.json(norm(folder))
}))

router.delete('/folders/:id', asyncHandler(async (req, res) => {
  const folder = await Folder.findById(req.params.id)
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  await Folder.findByIdAndUpdate(req.params.id, { isTrashed: true, trashedAt: new Date() })
  await FileItem.updateMany({ folder: folder._id }, { isTrashed: true, trashedAt: new Date() })
  res.json({ id: String(folder._id), message: 'Moved to recycle bin' })
}))

router.post('/folders/:id/restore', asyncHandler(async (req, res) => {
  const folder = await Folder.findByIdAndUpdate(req.params.id, { isTrashed: false, trashedAt: null }, { new: true })
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  res.json(norm(folder))
}))

router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
  const folder = req.body.folder && req.body.folder !== 'root' ? req.body.folder : null
  const type = detectType(req.file.mimetype, req.file.originalname)
  let driveId = null
  let url = null
  if (process.env.GOOGLE_DRIVE_FOLDER_ID && req.file.buffer) {
    const uploaded = await uploadToDrive({ buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype })
    driveId = uploaded.id
    url = driveId
  } else {
    // fallback local disk (when Drive not configured) — write buffer to uploads
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const filename = `${Date.now()}-${safe}`
    const dest = path.join(process.cwd(), 'uploads', filename)
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, req.file.buffer)
    driveId = filename
    url = `/uploads/${filename}`
  }
  const version = { version: 1, filename: driveId, size: req.file.size, by: req.user.name, uploadedAt: new Date() }

  const existing = await FileItem.findOne({ name: req.file.originalname, folder: folder || null, isTrashed: false, source: { $ne: 'chat' } })
  if (existing) {
    const next = (existing.versions?.length || 0) + 1
    existing.versions.push({ ...version, version: next })
    existing.url = url
    existing.size = req.file.size
    existing.mimeType = req.file.mimetype
    existing.type = type
    await existing.save()
    return res.status(200).json(norm(existing))
  }

  const file = await FileItem.create({
    name: req.file.originalname, originalName: req.file.originalname, mimeType: req.file.mimetype,
    type, size: req.file.size, url, folder, owner: req.user.name, versions: [version],
  })
  res.status(201).json(norm(file))
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  res.json(norm(file))
}))

router.get('/:id/download', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file || !file.url) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  if (isDriveId(file.url)) {
    return driveDownload(file.url, res)
  }
  const p = diskPath(file.url)
  if (!fs.existsSync(p)) return res.status(404).json({ message: 'File missing on disk' })
  res.download(p, file.originalName || file.name)
}))

router.get('/:id/raw', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file || !file.url) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  if (isDriveId(file.url)) {
    return driveDownload(file.url, res)
  }
  const p = diskPath(file.url)
  if (!fs.existsSync(p)) return res.status(404).json({ message: 'File missing on disk' })
  res.sendFile(p)
}))

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await FileItem.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(existing)
  const update = {}
  if (req.body.name) update.name = req.body.name
  if ('folder' in req.body) update.folder = req.body.folder && req.body.folder !== 'root' ? req.body.folder : null
  if (req.body.permission) update.permission = req.body.permission
  if (typeof req.body.starred === 'boolean') update.starred = req.body.starred
  if (Array.isArray(req.body.tags)) update.tags = req.body.tags
  const file = await FileItem.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!file) return res.status(404).json({ message: 'File not found' })
  res.json(norm(file))
}))

router.post('/:id/share', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const { user, permission = 'view' } = req.body
  if (!user) return res.status(400).json({ message: 'User required' })
  const idx = file.sharedWith.findIndex((s) => s.user === user)
  if (idx > -1) file.sharedWith[idx].permission = permission
  else file.sharedWith.push({ user, permission })
  await file.save()
  res.json(norm(file))
}))
router.delete('/:id/share', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  file.sharedWith = file.sharedWith.filter((s) => s.user !== req.body.user)
  await file.save()
  res.json(norm(file))
}))

router.post('/:id/version/:versionId/restore', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const v = file.versions.id(req.params.versionId)
  if (!v) return res.status(404).json({ message: 'Version not found' })
  file.url = isDriveId(v.filename) ? v.filename : `/uploads/${v.filename}`
  file.size = v.size
  await file.save()
  res.json(norm(file))
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await FileItem.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(existing)
  const file = await FileItem.findByIdAndUpdate(req.params.id, { isTrashed: true, trashedAt: new Date() }, { new: true })
  if (!file) return res.status(404).json({ message: 'File not found' })
  res.json({ id: String(file._id), message: 'Moved to recycle bin' })
}))

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await FileItem.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(existing)
  const file = await FileItem.findByIdAndUpdate(req.params.id, { isTrashed: false, trashedAt: null }, { new: true })
  if (!file) return res.status(404).json({ message: 'File not found' })
  res.json(norm(file))
}))

async function collectFolderIds(rootId) {
  const ids = [rootId]
  const queue = [rootId]
  while (queue.length) {
    const parent = queue.shift()
    const children = await Folder.find({ parent })
    for (const c of children) {
      ids.push(String(c._id))
      queue.push(String(c._id))
    }
  }
  return ids
}

router.delete('/:id/hard', asyncHandler(async (req, res) => {
  const folder = await Folder.findById(req.params.id)
  if (folder) {
    const isOwner = folder.owner === req.user.name || folder.owner === req.user.email
    if (!['Admin', 'Manager'].includes(req.user.role) && !isOwner) {
      return res.status(403).json({ message: 'You can only delete files you own' })
    }
    const folderIds = await collectFolderIds(String(folder._id))
    const files = await FileItem.find({ folder: { $in: folderIds } })
    for (const f of files) {
      for (const v of f.versions || []) {
        if (isDriveId(v.filename)) await deleteFromDrive(v.filename)
        else {
          const p = diskPath(`/uploads/${v.filename}`)
          if (fs.existsSync(p)) fs.unlinkSync(p)
        }
      }
      if (isDriveId(f.url)) await deleteFromDrive(f.url)
    }
    await FileItem.deleteMany({ folder: { $in: folderIds } })
    await Folder.deleteMany({ _id: { $in: folderIds } })
    return res.json({ id: String(folder._id), message: 'Folder permanently deleted' })
  }

  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const isOwner = file.owner === req.user.name || file.owner === req.user.email
  if (!['Admin', 'Manager'].includes(req.user.role) && !isOwner) {
    return res.status(403).json({ message: 'You can only delete files you own' })
  }
  for (const v of file.versions || []) {
    if (isDriveId(v.filename)) await deleteFromDrive(v.filename)
    else {
      const p = diskPath(`/uploads/${v.filename}`)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  }
  if (isDriveId(file.url)) await deleteFromDrive(file.url)
  await FileItem.findByIdAndDelete(req.params.id)
  res.json({ id: String(file._id), message: 'Permanently deleted' })
}))

export default router
