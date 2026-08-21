import mongoose from 'mongoose'
import { ApiError } from '../utils/asyncHandler.js'

// TASK 12/13: a shared, honest guard for path ids. `'undefined'` / `'null'` are
// the strings an absent client-side id turns into once interpolated into a URL,
// so they are rejected explicitly rather than being left to cast-fail.
function assertValidId(id, modelName = 'Record') {
  const raw = String(id ?? '')
  if (!raw || raw === 'undefined' || raw === 'null') {
    throw new ApiError(400, `A valid ${modelName} id is required (received "${raw || 'empty'}").`)
  }
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw new ApiError(400, `"${raw}" is not a valid ${modelName} id.`)
  }
}

// Recursively remove MongoDB operator keys (anything beginning with `$`) and
// nested objects that carry them. Prevents NoSQL operator injection where a
// crafted query string like `?status[$ne]=x` would otherwise be passed
// straight through to Mongoose as `{ status: { $ne: 'x' } }`.
function sanitizeQuery(input) {
  if (Array.isArray(input)) return input.map(sanitizeQuery)
  if (input && typeof input === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(input)) {
      if (k.startsWith('$')) continue
      out[k] = sanitizeQuery(v)
    }
    return out
  }
  return input
}

// Escape regex metacharacters so user-supplied search text can't be used to
// mount a ReDoS / catastrophic-backtracking attack against `$regex` queries.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// PHASE SALARY/BILLING/ADMIN (TASK 12 + TASK 13) ROOT CAUSE — "delete failed /
// invalid_id : undefined" on Admin -> Backup, and the same on Restore.
//
// TRACE (delete): pages/admin/Backup.jsx `setDeleting(r)` -> ConfirmDialog
//   -> `remove.mutate(deleting.id)` -> adminApi.backups.remove(id)
//   -> DELETE /api/admin/backups/:id -> buildResourceRouter -> service.remove()
//   -> Model.findByIdAndDelete(id).
//
// The id is `undefined` BEFORE the request is ever sent. Every read in this
// factory ends in `.lean()`, and a lean result is a raw driver document: it
// carries `_id` and, because lean deliberately skips virtuals, it NEVER carries
// `id`. The Backup table renders rows straight off that payload, so `r.id` is
// undefined, the axios template literal stringifies it into the URL as the
// literal text "undefined", and Mongoose then fails to cast it:
//     CastError { path: '_id', value: 'undefined' }
// which middleware/error.js renders as `Invalid _id: undefined` — the exact
// message reported. Nothing was wrong with the route, the guard or the query.
//
// The same defect silently broke the DOWNLOAD button on that page
// (`adminApi.backups.download(row.id)`), which is why it is fixed here in the
// SHARED factory rather than by patching `deleting._id` into one component:
// every resource built through this factory had the identical gap.
//
// This mirrors the `withId` convention controllers/userController.js and
// controllers/clientController.js already established for exactly this trap.
// Purely ADDITIVE: `_id` is preserved untouched, so any consumer already
// reading `_id` keeps working.
// ---------------------------------------------------------------------------
export const withId = (doc) => (doc && doc._id ? { ...doc, id: String(doc._id) } : doc)

// Mongoose documents (create/update return them, not lean objects) must be
// converted before the spread, otherwise `{ ...doc }` copies internal state
// instead of the fields.
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc)
const normalize = (doc) => withId(plain(doc))

// Generic repository + service factory for HR resources.
// Mirrors the layered Employee pattern but parameterized by Model + config,
// so all 10 HR collections share one tested implementation.
export function createResourceService(Model, { searchFields = [], filterFields = [] } = {}) {
  const repository = {
    findPaginated: ({ filter, sort, skip, limit }) =>
      Promise.all([
        Model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
        Model.countDocuments(filter),
      ]),
    findById: (id) => Model.findById(id).lean(),
    findAll: () => Model.find().sort({ createdAt: -1 }).lean(),
    create: (payload) => Model.create(payload),
    updateById: (id, patch) => Model.findByIdAndUpdate(id, patch, { new: true, runValidators: true }),
    deleteById: (id) => Model.findByIdAndDelete(id),
  }

  const service = {
    async list(query) {
      const { search = '', page = 1, limit = 8 } = query
      // An empty `sortBy` (sent by the client as its default) would build
      // `{ '': 1 }` and crash Mongoose. Fall back to a safe default.
      const sortBy = (typeof query.sortBy === 'string' && query.sortBy.trim()) ? query.sortBy.trim() : 'createdAt'
      const order = query.order === 'asc' ? 'asc' : 'desc'
      // Strip `$` operator keys from the raw query before reading filters out
      // of it (NoSQL injection defense).
      const clean = sanitizeQuery(query)
      const filter = {}
      if (search && searchFields.length) {
        const safe = escapeRegex(search).slice(0, 100)
        filter.$or = searchFields.map((f) => ({ [f]: { $regex: safe, $options: 'i' } }))
      }
      // Apply any allowed exact-match filters present in the query. Only scalar
      // values are accepted; operator objects are rejected by sanitizeQuery and
      // the typeof guard below.
      //
      // PHASE ADMIN ATTENDANCE (TASK 3B): an EMPTY STRING is now skipped. Every
      // filter UI in this app sends `''` for its "All …" option (see the Module /
      // Severity / Level selects on the admin log pages, and the department /
      // status selects elsewhere), and `filter.module = ''` matches no document
      // at all - so choosing "All Modules" would have emptied the table and
      // reported 0 records. `''` means "no filter", which is exactly the absent
      // case, so it must not reach the query.
      filterFields.forEach((f) => {
        const v = clean[f]
        if (v != null && v !== '' && typeof v !== 'object') filter[f] = v
      })

      const pageNum = Math.max(1, Number(page))
      const limitNum = Math.min(100, Math.max(1, Number(limit)))
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 }
      const [data, total] = await repository.findPaginated({ filter, sort, skip: (pageNum - 1) * limitNum, limit: limitNum })
      // TASK 12/13: expose `id` alongside `_id` — see withId() above.
      return { data: data.map(withId), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
    },
    all: async () => (await repository.findAll()).map(withId),
    async get(id) {
      assertValidId(id, Model.modelName)
      const doc = await repository.findById(id)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return withId(doc)
    },
    async create(payload) {
      return normalize(await repository.create(payload))
    },
    async update(id, patch) {
      assertValidId(id, Model.modelName)
      const doc = await repository.updateById(id, patch)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return normalize(doc)
    },
    async remove(id) {
      // TASK 12: reject a malformed id with an honest 400 BEFORE it reaches
      // Mongoose. Previously `undefined` cast-failed deep inside the driver and
      // surfaced as the opaque `Invalid _id: undefined`, which described the
      // symptom and named neither the resource nor the real problem. The id flow
      // itself is fixed above; this is the guard that keeps a future regression
      // legible instead of cryptic.
      assertValidId(id, Model.modelName)
      const doc = await repository.deleteById(id)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return { id: String(id) }
    },
  }

  return { repository, service }
}
