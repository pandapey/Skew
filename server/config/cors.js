// Shared CORS configuration for both the Express app and the Socket.IO server.
//
// We never reflect a wildcard together with `credentials: true`: browsers
// reject that combination, and a wildcard would let any origin call the API
// with the user's cookies. Instead we allow an explicit allowlist (the
// configured CLIENT_URL, comma-separated for multiple) plus common local dev
// hosts. Non-browser clients (curl, test harnesses, server-to-server) send no
// Origin header, which we treat as allowed.

const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'https://skew-server-tkkj.onrender.com')
  .split(',').map((s) => s.trim()).filter(Boolean)

const isAllowedOrigin = (origin) => {
  if (!origin) return true
  if (ALLOWED_ORIGINS.includes(origin)) return true
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

export const corsOptions = {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
}

export { ALLOWED_ORIGINS, isAllowedOrigin }
