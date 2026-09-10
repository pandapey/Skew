import dotenv from 'dotenv'

dotenv.config()

const normalize = (s) => String(s || '').trim().replace(/\/+$/, '')

function getAllowedOrigins() {
  const raw = [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN,
    process.env.ALLOWED_ORIGINS,
  ]
    .filter(Boolean)
    .join(',')
  const fallback = 'https://skew-client.onrender.com'
  const list = (raw || fallback).split(',').map(normalize).filter(Boolean)
  // De-duplicate while preserving order
  return [...new Set(list)]
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export const isAllowedOrigin = (origin) => {
  if (!origin) return true // curl / mobile apps / same-origin (no Origin header)
  const clean = normalize(origin)
  const allowed = getAllowedOrigins()
  if (allowed.includes(clean)) return true
  if (allowed.includes('*')) return true
  if (LOCALHOST_RE.test(clean)) return true
  return false
}

export const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true)
    console.warn(
      `[CORS] Blocked origin "${origin}". Allowed: ${getAllowedOrigins().join(', ') || '(none)'}. ` +
        `Set CLIENT_URL (comma-separated) on the backend to include your live frontend URL.`
    )
    return cb(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
}

export function getAllowedOriginsList() {
  return getAllowedOrigins()
}

export const ALLOWED_ORIGINS = getAllowedOrigins()
