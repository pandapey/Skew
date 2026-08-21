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

// A rejected file type is a bad request, not a server fault: give the error a
// 4xx status so the global errorHandler (middleware/error.js) honours it.
const filterError = (message) => Object.assign(new Error(message), { statusCode: 400 })

// Image-only variant for profile photos.
export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(filterError('Only image files are allowed')),
})

// --- Chat attachments ---
// Stored in their OWN directory (NOT the publicly-served `uploads/`): chat
// files are only ever reachable through the authenticated
// GET /api/chat/conversations/:id/attachments/:fileId route, which checks
// conversation participation before serving bytes.
const CHAT_UPLOAD_DIR = 'chat-uploads'
if (!fs.existsSync(CHAT_UPLOAD_DIR)) fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true })

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CHAT_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    cb(null, `${Date.now()}-${safe}`)
  },
})

const ALLOWED_CHAT_TYPES = [
  'image/', 'video/', 'audio/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]

export const uploadChat = multer({
  storage: chatStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED_CHAT_TYPES.some((t) => file.mimetype.startsWith(t))
      ? cb(null, true)
      : cb(filterError('File type is not allowed in chat')),
})

// --- Private employee profile documents ---
// Stored in their OWN directory (NOT the publicly-served `uploads/`): a
// self-uploaded profile document (ID proof, address proof, certificates…) is
// private to its owner and is only ever served through the authorized
// /api/employees/me/documents/:docId route — never through a guessable public
// URL. Admin/Manager reach the same bytes through the existing
// /api/employees/:id/documents/:docId route (their normal employee-management
// permission).
const PROFILE_UPLOAD_DIR = 'profile-uploads'
if (!fs.existsSync(PROFILE_UPLOAD_DIR)) fs.mkdirSync(PROFILE_UPLOAD_DIR, { recursive: true })

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    cb(null, `${Date.now()}-${safe}`)
  },
})

const ALLOWED_PROFILE_TYPES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]

export const uploadProfileDoc = multer({
  storage: profileStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED_PROFILE_TYPES.some((t) => file.mimetype.startsWith(t))
      ? cb(null, true)
      : cb(filterError('File type is not allowed for profile documents')),
})
