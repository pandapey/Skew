import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { Folder, FileItem } from '../models/fileModels.js'
import { upload } from '../middleware/upload.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect } from '../middleware/auth.js'

const router = Router()

const STORAGE_LIMIT = Number(process.env.FILE_STORAGE_LIMIT) || 1024 * 1024 * 1024 // 1 GB

// Normalize Mongo docs to the frontend's `.id` key.
const norm = (doc) => {
  if (!doc) return doc
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  o.id = String(doc._id)
  return o
}

// Classify an uploaded file into a coarse type for icon/preview routing.
function detectType(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (/\.(xlsx?|csv)$/i.test(name) || mime.includes('excel') || mime.includes('spreadsheet')) return 'excel'
  if (/\.(docx?|txt|rtf)$/i.test(name) || mime.includes('word') || mime.includes('document') || mime.includes('text/')) return 'word'
  return 'other'
}

// Resolve the absolute path of a stored file from its url, asserting it stays
// inside the uploads directory (defense-in-depth against path traversal).
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads')
const diskPath = (url) => {
  const p = path.resolve(process.cwd(), String(url).replace(/^\//, ''))
  if (!p.startsWith(UPLOADS_ROOT)) {
    throw new ApiError(400, 'Invalid file path')
  }
  return p
}

// PHASE: EMPLOYEE CHAT ATTACHMENT PRIVACY — the Files module only ever
// surfaces NORMAL company files. Chat attachments carry `source: 'chat'` (see
// chatService.uploadChatAttachment) and are served exclusively through the
// participant-checked chat routes. This filter is applied to every collection
// query below, and `{ $ne: 'chat' }` (rather than `{ $eq: 'files' }`) keeps
// legacy records created before the field existed visible exactly as before.
const GENERAL_FILE_FILTER = { source: { $ne: 'chat' } }

// A chat attachment must never be reachable through a general Files route
// (metadata read, download, preview, rename, share, trash, restore or hard
// delete). Returning 404 — not 403 — avoids leaking that the resource exists.
const assertNotChatFile = (file) => {
  if (file && file.source === 'chat') throw new ApiError(404, 'File not found')
}

// The external Client role is blocked from the internal file repository so
// company documents never leak to clients (the portal uses its own scoped
// document endpoints under client projects).
const blockClient = (req, res, next) =>
  req.user.role === 'Client'
    ? res.status(403).json({ message: 'Forbidden: clients cannot access internal files' })
    : next()
router.use(protect, blockClient)

// --- List folders + files (filter by folder / search / type / trash) ---
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

// --- Storage usage summary ---
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

// --- Trash list ---
// PHASE: EMPLOYEE FILES (BIN CONSISTENCY) — honors the same `search` param the
// active view uses, so the Bin's search box behaves identically to Files.
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

// --- Bulk move-to-Bin (soft delete) ---
// PHASE: EMPLOYEE FILES (BULK DELETE FIX) — the active-view "Delete" bulk
// action must move files to the Recycle Bin, NOT permanently remove them:
// the old implementation unlinked disk bytes and deleted the records, so
// "Delete" in Files behaved like "Delete Forever" and any selected file the
// user did not own made the WHOLE batch fail (403), leaving the files visible
// and the bin empty. Each file is now soft-deleted individually (isTrashed),
// reusing the exact ownership rule of the single delete path (Admin/Manager
// may delete anything; anyone else may only delete files they own) and
// failures are reported per file so one foreign/locked file never blocks the
// rest. Declared before '/:id' so the literal segment wins.
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

// --- Bulk permanent delete (record + disk), used from the Recycle Bin ---
// PHASE: EMPLOYEE FILES (BIN REQUIREMENT) — the Bin's "Delete Permanently"
// action. Same per-file ownership rule as bulk-delete; each file's version
// binaries are removed from disk (missing binaries are tolerated — the record
// is still removed so the bin never gets stuck on orphaned rows) and the
// records are deleted. Failures are reported per file.
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
        const p = diskPath(`/uploads/${v.filename}`)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
      await FileItem.findByIdAndDelete(id)
      deleted.push(id)
    } catch (e) {
      failed.push({ id, message: e?.message || 'Delete failed' })
    }
  }

  res.json({ deleted, failed, deletedCount: deleted.length, failedCount: failed.length })
}))

// --- Create folder ---
router.post('/folders', asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ message: 'Folder name required' })
  const parent = req.body.parent && req.body.parent !== 'root' ? req.body.parent : null
  const folder = await Folder.create({ name, parent, owner: req.user.name })
  res.status(201).json(norm(folder))
}))

// --- Rename / move folder ---
router.patch('/folders/:id', asyncHandler(async (req, res) => {
  const update = {}
  if (req.body.name) update.name = req.body.name
  if ('parent' in req.body) update.parent = req.body.parent && req.body.parent !== 'root' ? req.body.parent : null
  const folder = await Folder.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  res.json(norm(folder))
}))

// --- Soft-delete folder (cascade to its direct files) ---
router.delete('/folders/:id', asyncHandler(async (req, res) => {
  const folder = await Folder.findById(req.params.id)
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  await Folder.findByIdAndUpdate(req.params.id, { isTrashed: true, trashedAt: new Date() })
  await FileItem.updateMany({ folder: folder._id }, { isTrashed: true, trashedAt: new Date() })
  res.json({ id: String(folder._id), message: 'Moved to recycle bin' })
}))

// --- Restore folder ---
router.post('/folders/:id/restore', asyncHandler(async (req, res) => {
  const folder = await Folder.findByIdAndUpdate(req.params.id, { isTrashed: false, trashedAt: null }, { new: true })
  if (!folder) return res.status(404).json({ message: 'Folder not found' })
  res.json(norm(folder))
}))

// --- Upload a file (auto-versions if same name exists in the folder) ---
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
  const folder = req.body.folder && req.body.folder !== 'root' ? req.body.folder : null
  const type = detectType(req.file.mimetype, req.file.originalname)
  const url = `/uploads/${req.file.filename}`
  const version = { version: 1, filename: req.file.filename, size: req.file.size, by: req.user.name, uploadedAt: new Date() }

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

// --- File metadata ---
router.get('/:id', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  res.json(norm(file))
}))

// --- Force download ---
router.get('/:id/download', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file || !file.url) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const p = diskPath(file.url)
  if (!fs.existsSync(p)) return res.status(404).json({ message: 'File missing on disk' })
  res.download(p, file.originalName || file.name)
}))

// --- Raw file stream (used for inline preview of image/video/pdf) ---
router.get('/:id/raw', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file || !file.url) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const p = diskPath(file.url)
  if (!fs.existsSync(p)) return res.status(404).json({ message: 'File missing on disk' })
  res.sendFile(p)
}))

// --- Update file (rename / move / permission / star / tags) ---
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

// --- Share / unshare ---
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

// --- Restore a previous version (make it current) ---
router.post('/:id/version/:versionId/restore', asyncHandler(async (req, res) => {
  const file = await FileItem.findById(req.params.id)
  if (!file) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(file)
  const v = file.versions.id(req.params.versionId)
  if (!v) return res.status(404).json({ message: 'Version not found' })
  file.url = `/uploads/${v.filename}`
  file.size = v.size
  await file.save()
  res.json(norm(file))
}))

// --- Soft delete (recycle bin) ---
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await FileItem.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(existing)
  const file = await FileItem.findByIdAndUpdate(req.params.id, { isTrashed: true, trashedAt: new Date() }, { new: true })
  if (!file) return res.status(404).json({ message: 'File not found' })
  res.json({ id: String(file._id), message: 'Moved to recycle bin' })
}))

// --- Restore from recycle bin ---
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await FileItem.findById(req.params.id)
  if (!existing) return res.status(404).json({ message: 'File not found' })
  assertNotChatFile(existing)
  const file = await FileItem.findByIdAndUpdate(req.params.id, { isTrashed: false, trashedAt: null }, { new: true })
  if (!file) return res.status(404).json({ message: 'File not found' })
  res.json(norm(file))
}))

// Recursively collect a folder and all of its descendant folder ids.
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

// --- Hard delete (remove from disk + DB) ---
// Works for both files and folders. A folder hard-delete cascades to every
// descendant folder and contained file, wiping their binaries from disk too.
// PHASE: EMPLOYEE FILES (OWNERSHIP) — non-privileged users may only hard-delete
// records they own, matching the ownership rule enforced by the bulk endpoints.
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
        const p = diskPath(`/uploads/${v.filename}`)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
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
    const p = diskPath(`/uploads/${v.filename}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  await FileItem.findByIdAndDelete(req.params.id)
  res.json({ id: String(file._id), message: 'Permanently deleted' })
}))

export default router
