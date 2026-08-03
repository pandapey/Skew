import { ApiError } from '../utils/asyncHandler.js'

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
      filterFields.forEach((f) => {
        const v = clean[f]
        if (v != null && typeof v !== 'object') filter[f] = v
      })

      const pageNum = Math.max(1, Number(page))
      const limitNum = Math.min(100, Math.max(1, Number(limit)))
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 }
      const [data, total] = await repository.findPaginated({ filter, sort, skip: (pageNum - 1) * limitNum, limit: limitNum })
      return { data, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
    },
    all: () => repository.findAll(),
    async get(id) {
      const doc = await repository.findById(id)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return doc
    },
    create: (payload) => repository.create(payload),
    async update(id, patch) {
      const doc = await repository.updateById(id, patch)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return doc
    },
    async remove(id) {
      const doc = await repository.deleteById(id)
      if (!doc) throw new ApiError(404, `${Model.modelName} not found`)
      return { id }
    },
  }

  return { repository, service }
}
