import { ApiError } from '../utils/asyncHandler.js'

// Minimal dependency-free validators mirroring the frontend Zod schema.
// (Swap for Joi/express-validator if preferred — same call sites.)
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// Partial validation for updates — only checks provided fields.
export function validateEmployeeUpdate(req, _res, next) {
  const b = req.body || {}
  const errors = []
  if (b.email != null && !isEmail(b.email)) errors.push('email must be valid')
  if (b.name != null && b.name.trim().length < 2) errors.push('name too short')
  if (b.salary != null && typeof b.salary !== 'object' && (isNaN(Number(b.salary)) || Number(b.salary) < 0)) errors.push('salary invalid')

  if (errors.length) return next(new ApiError(422, `Validation failed: ${errors.join(', ')}`))
  if (b.salary != null && typeof b.salary !== 'object') req.body.salary = { ctc: Number(b.salary) }
  next()
}
