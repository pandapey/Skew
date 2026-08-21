import { ApiError } from '../utils/asyncHandler.js'

// Field-level validators (dependency-free) mirroring the frontend Zod schemas.
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// Build a validate middleware from a list of required fields + optional checks.
export const makeValidator = (required = [], checks = {}) => (req, _res, next) => {
  const b = req.body || {}
  const errors = []
  required.forEach((f) => {
    if (b[f] == null || String(b[f]).trim() === '') errors.push(`${f} is required`)
  })
  Object.entries(checks).forEach(([field, rule]) => {
    if (b[field] != null && !rule.test(b[field])) errors.push(rule.message)
  })
  if (errors.length) return next(new ApiError(422, `Validation failed: ${errors.join(', ')}`))
  next()
}

export const validators = {
  department: makeValidator(['name', 'code']),
  designation: makeValidator(['title', 'department']),
  job: makeValidator(['title', 'department']),
  candidate: makeValidator(['name', 'email', 'position'], {
    email: { test: (v) => isEmail(v), message: 'email must be valid' },
  }),
  interview: makeValidator(['candidate', 'interviewer']),
  offer: makeValidator(['candidate', 'position', 'ctc'], {
    ctc: { test: (v) => !isNaN(Number(v)) && Number(v) >= 0, message: 'ctc must be a positive number' },
  }),
  review: makeValidator(['employee', 'period']),
  movement: makeValidator(['type', 'employee']),
}
