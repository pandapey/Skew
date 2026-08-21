// Helpers for safely turning untrusted `req.query` input into Mongoose filters.
//
// These defend against two classes of bug:
//  1. NoSQL operator injection — a crafted query string such as
//     `?status[$ne]=x` would otherwise be copied verbatim into the filter as
//     `{ status: { $ne: 'x' } }`, bypassing intended equality filters.
//  2. ReDoS — user-supplied search text fed raw into `$regex` can be used to
//     trigger catastrophic backtracking.

// Recursively drop any MongoDB operator key (begins with `$`) and any value
// that is itself an operator object. Returns a sanitised copy.
export function sanitizeQuery(input) {
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

// Only allow plain scalar values (string / number / boolean) through. Operator
// objects from the query are rejected, so callers can safely assign the result
// to a Mongoose filter field. Empty / whitespace-only strings are treated as
// "no value" (null) so a client's "All" selection (sent as `?field=`) does not
// become a `{ field: '' }` filter that matches zero documents.
export function scalarOrNull(value) {
  if (value == null) return null
  if (typeof value === 'object') return null
  if (typeof value === 'string' && value.trim() === '') return null
  return value
}

// Escape regex metacharacters so user-supplied search text can't be weaponised
// for a ReDoS attack. Also length-bounded.
export function escapeRegex(str, maxLen = 100) {
  return String(str == null ? '' : str)
    .slice(0, maxLen)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Clamp a user-supplied page size to a sane maximum.
export function clampLimit(value, max = 100) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return max
  return Math.min(max, Math.max(1, Math.floor(n)))
}

export function clampPage(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.floor(n)
}
