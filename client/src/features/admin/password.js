// Shared password policy for the frontend (mirrors server/src/utils/password.js).
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${PASSWORD_MIN} characters`, test: (p) => p.length >= PASSWORD_MIN },
  { id: 'lower', label: 'One lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { id: 'upper', label: 'One uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: 'One number (0–9)', test: (p) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character (!@#$…)', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

// Returns { valid, errors:[{id,label,passed}] } for live UI rendering.
export function validatePassword(pw = '') {
  const errors = PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, passed: r.test(pw) }))
  return { valid: pw.length > 0 && pw.length <= PASSWORD_MAX && errors.every((e) => e.passed), errors }
}

// Categorise strength for the meter.
export function strength(pw = '') {
  if (!pw) return null
  const passed = PASSWORD_RULES.filter((r) => r.test(pw)).length
  if (pw.length < PASSWORD_MIN || passed <= 2) return 'Weak'
  if (passed === 3) return 'Medium'
  if (passed === 4) return 'Strong'
  return 'Excellent'
}
