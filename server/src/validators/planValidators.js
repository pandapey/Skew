import { ApiError } from '../utils/asyncHandler.js'
import { Plan } from '../models/clientModels.js'

// ---------------------------------------------------------------------------
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7 + TASK 13) — Plan validation
// ---------------------------------------------------------------------------
// Mirrors the shape of validators/hrValidators.js (a small, dependency-free
// middleware factory per resource) rather than introducing a validation library
// that nothing else in this server uses. It is the SERVER-side authority; the
// browser also validates through features/client/planForm.js's zod schema, but
// that is inline feedback, not the gate.
//
// TASK 13 — why the duplicate check lives here and not only on the index:
// models/clientModels.js declares a case-insensitive UNIQUE index on Plan.name,
// which is the race-proof backstop and surfaces as a 409 through the existing
// duplicate-key branch in middleware/error.js. That message is generic
// ("Duplicate value for name"). This check runs first so the common case gets an
// honest, specific message naming the offending plan, without weakening the
// index that actually guarantees the constraint.

const trimmed = (v) => String(v ?? '').trim()

// Case-insensitive name collision, excluding the record being updated.
async function assertNameAvailable(name, excludeId) {
  const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
  if (excludeId) filter._id = { $ne: excludeId }
  const clash = await Plan.findOne(filter).lean()
  if (clash) {
    throw new ApiError(409, `A plan named "${clash.name}" already exists. Plan names must be unique.`)
  }
}

/**
 * Validate a Plan create/update body.
 * Used for POST (create) and for PUT (update), where `req.params.id` is present
 * and is excluded from the duplicate lookup so saving a plan without renaming it
 * is not rejected as a clash with itself.
 */
export const validatePlan = async (req, _res, next) => {
  try {
    const body = req.body || {}
    const name = trimmed(body.name)

    // On UPDATE a partial patch is legitimate: only validate `name` when the
    // caller actually sent the key. On CREATE it is always required.
    const isUpdate = Boolean(req.params?.id)
    if (!isUpdate || body.name !== undefined) {
      if (name.length < 2) {
        throw new ApiError(422, 'Validation failed: plan name is required (at least 2 characters)')
      }
      await assertNameAvailable(name, req.params?.id)
      // Normalise so the stored value is exactly what the Client dropdown will
      // offer and what Client.plan will hold — no stray whitespace.
      req.body.name = name
    }

    if (body.price !== undefined && body.price !== '' && body.price !== null) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(422, 'Validation failed: price must be a non-negative number')
      }
      req.body.price = price
    }

    if (body.status !== undefined && !['Active', 'Inactive'].includes(body.status)) {
      throw new ApiError(422, "Validation failed: status must be 'Active' or 'Inactive'")
    }

    next()
  } catch (err) {
    next(err)
  }
}

export default validatePlan
