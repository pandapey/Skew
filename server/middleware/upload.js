import multer from 'multer'
import path from 'path'
import fs from 'fs'

const UPLOAD_DIR = 'uploads'
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    cb(null, `${Date.now()}-${safe}`)
  },
})

// Reusable upload middleware (10 MB cap).
export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
})

// Image-only variant for profile photos.
export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed')),
})
