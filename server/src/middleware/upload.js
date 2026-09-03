import multer from 'multer'

const storage = multer.memoryStorage()

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
})

const filterError = (message) => Object.assign(new Error(message), { statusCode: 400 })

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(filterError('Only image files are allowed')),
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

const BLOCKED_CHAT_MIMES = [
  'application/x-msdownload', 'application/x-msdos-program',
  'application/x-sh', 'application/x-executable',
]
export const uploadChat = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase()
    if (BLOCKED_CHAT_MIMES.some((t) => mime.startsWith(t) || mime.includes('executable'))) {
      return cb(filterError('Executable files are not allowed in chat'))
    }
    if (mime === 'application/x-msdownload' || file.originalname.toLowerCase().endsWith('.exe')) {
      return cb(filterError('Executable files are not allowed in chat'))
    }
    return cb(null, true)
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
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED_PROFILE_TYPES.some((t) => file.mimetype.startsWith(t))
      ? cb(null, true)
      : cb(filterError('File type is not allowed for profile documents')),
})
