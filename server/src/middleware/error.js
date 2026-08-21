// Central error handler + 404.
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

export function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` })
}

// PHASE ADMIN ATTENDANCE (TASK 4): this is the natural producer for the System
// Log — every failed API request already funnels through here, and a failed
// request is exactly the kind of technical, actor-less event the SystemLog model
// describes. Nothing else about the handler's behaviour changes: the same status
// codes and the same response bodies are returned, and the write is
// fire-and-forget so a logging failure can never affect the response.
//
// Auth-route failures are attributed to 'auth-service' and everything else to
// 'api-gateway', which is why those two names exist in the Source filter.
const sourceFor = (req) =>
  String(req?.originalUrl || '').startsWith('/api/auth')
    ? SYSTEM_LOG_SOURCES.AUTH
    : SYSTEM_LOG_SOURCES.API

// 5xx is a fault in the application; 4xx is a rejected request. Recording them
// at different levels is what makes the "System Errors" tile on the Admin hub
// (SystemLog.countDocuments({ level: 'ERROR' })) mean something.
const record = (req, status, message) => {
  systemLog(
    status >= 500 ? 'ERROR' : 'WARN',
    `${status} ${req?.method || '?'} ${req?.originalUrl || '?'} — ${message}`,
    sourceFor(req),
  )
}

export function errorHandler(err, req, res, next) {
  console.error(err)

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    record(req, 400, `Invalid ${err.path}: ${err.value}`)
    return res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` })
  }
  // Mongoose validation
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ')
    record(req, 422, message)
    return res.status(422).json({ message })
  }
  // Duplicate key
  if (err.code === 11000) {
    const message = `Duplicate value for ${Object.keys(err.keyValue).join(', ')}`
    record(req, 409, message)
    return res.status(409).json({ message })
  }
  // Multer upload errors
  if (err.name === 'MulterError') {
    record(req, 400, `Upload error: ${err.message}`)
    return res.status(400).json({ message: `Upload error: ${err.message}` })
  }
  // Malformed multipart bodies (e.g. a boundary-less Content-Type) surface as
  // raw busboy errors with no statusCode; treat them as bad requests rather
  // than 500s so the client gets a clean 400 instead of a server fault.
  if (err.message && /multipart|boundary/i.test(err.message)) {
    record(req, 400, `Upload error: ${err.message}`)
    return res.status(400).json({ message: 'Upload error: invalid multipart body' })
  }

  const status = err.statusCode || 500
  const message = err.message || 'Internal Server Error'
  record(req, status, message)
  res.status(status).json({
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}
