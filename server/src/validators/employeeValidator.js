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

  // PHASE 6 (TASK 2): the edit form now also submits `dob`. An empty date input
  // arrives as '', which Mongoose cannot cast to a Date - it would throw a 500
  // instead of simply leaving the field alone. Same treatment userController's
  // sanitizePatch already gives `joiningDate`, applied to both date columns.
  for (const key of ['joiningDate', 'dob']) {
    if (b[key] === '') delete req.body[key]
  }

  if (errors.length) return next(new ApiError(422, `Validation failed: ${errors.join(', ')}`))
  if (b.salary != null && typeof b.salary !== 'object') req.body.salary = { ctc: Number(b.salary) }
  next()
}
