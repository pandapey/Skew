import mongoose from 'mongoose'
import { GridFSBucket, ObjectId } from 'mongodb'

const BUCKET_NAME = process.env.GRIDFS_BUCKET || 'uploads'

let bucket = null
let bucketDb = null

export function getBucket() {
  const db = mongoose.connection?.db
  if (!db) throw new Error('MongoDB not connected')
  if (!bucket || bucketDb !== db) {
    bucket = new GridFSBucket(db, {
      bucketName: BUCKET_NAME,
      chunkSizeBytes: 255 * 1024,
    })
    bucketDb = db
  }
  return bucket
}

export const isGridFsId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || '').trim())

export const toObjectId = (v) => {
  if (!isGridFsId(v)) throw new Error('Invalid file id')
  return new ObjectId(String(v).trim())
}

/**
 * Store a buffer in MongoDB Atlas (GridFS) — bytes only, no disk, no Drive.
 * Returns the GridFS file _id as a string.
 */
export async function saveBufferToGridFS(buffer, { filename, contentType, metadata } = {}) {
  if (!buffer || !buffer.length) throw new Error('Empty file buffer')
  const bkt = getBucket()
  const safe = String(filename || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 200) || 'file'
  return new Promise((resolve, reject) => {
    const uploadStream = bkt.openUploadStream(safe, {
      contentType: contentType || 'application/octet-stream',
      metadata: metadata || {},
    })
    uploadStream.on('error', reject)
    uploadStream.on('finish', () => resolve(String(uploadStream.id)))
    uploadStream.end(buffer)
  })
}

export async function getGridFSFileMeta(gridFsId) {
  const bkt = getBucket()
  const _id = toObjectId(gridFsId)
  const files = await bkt.find({ _id }).toArray()
  return files[0] || null
}

export async function deleteGridFSFile(gridFsId) {
  if (!gridFsId) return
  if (!isGridFsId(gridFsId)) return // legacy Drive/disk ref — nothing to do in GridFS
  try {
    await getBucket().delete(toObjectId(gridFsId))
  } catch {
    // ignore missing file
  }
}

/**
 * Stream a GridFS file to an Express response.
 * Sets Content-Type / Content-Length / Content-Disposition.
 */
export async function streamGridFSFile(gridFsId, res, { filename, contentType, disposition = 'attachment' } = {}) {
  const meta = await getGridFSFileMeta(gridFsId)
  if (!meta) {
    res.status(404).json({ message: 'File not found' })
    return
  }
  const name = filename || meta.filename || 'file'
  const type = contentType || meta.contentType || 'application/octet-stream'
  res.setHeader('Content-Type', type)
  if (typeof meta.length === 'number') res.setHeader('Content-Length', String(meta.length))
  // inline for preview (images/pdf/video), attachment for downloads
  const safeName = String(name).replace(/"/g, '')
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`)
  const bkt = getBucket()
  const stream = bkt.openDownloadStream(toObjectId(gridFsId))
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ message: 'File not found' })
    else res.end()
  })
  stream.pipe(res)
}

/**
 * Extract a GridFS id from the various legacy stored shapes:
 * - pure GridFS id ("65f...")
 * - FileItem.url that IS the gridfs id
 * - version.filename that IS the gridfs id
 * Returns the id string or null.
 */
export function extractGridFsId(...candidates) {
  for (const c of candidates) {
    if (c && isGridFsId(c)) return String(c).trim()
  }
  return null
}
