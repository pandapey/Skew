import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { User } from '../models/User.js'
import { signToken, signRefreshToken } from '../middleware/auth.js'

// POST /api/auth/login
export async function login(req, res) {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' })

  const user = await User.findOne({ email }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' })
  }

  // Only Active accounts may authenticate.
  if (user.status && user.status !== 'Active') {
    const reason =
      user.status === 'Pending' ? 'Your account is awaiting approval'
        : user.status === 'Suspended' ? 'Your account has been suspended'
          : user.status === 'Blocked' ? 'Your account has been blocked'
            : 'Your account is not active'
    return res.status(403).json({ message: `${reason}. Contact an administrator.` })
  }

  user.lastLogin = new Date()
  await user.save({ validateBeforeSave: false })

  const safe = user.toObject()
  delete safe.password
  res.json({ user: safe, token: signToken(user), refreshToken: signRefreshToken(user) })
}

// GET /api/auth/me
export async function me(req, res) {
  res.json(req.user)
}

// POST /api/auth/me/avatar
// Self-serve profile picture upload for the CURRENT authenticated user. Reuses
// the shared `uploadImage` multer middleware (see middleware/upload.js) and the
// same static `/uploads` serving as every other image upload — no duplicate
// upload logic. A user can only ever change their OWN avatar (req.user), so this
// grants no cross-user access and does not affect RBAC.
export async function updateAvatar(req, res) {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' })
  const avatar = `/uploads/${req.file.filename}`
  req.user.avatar = avatar
  await req.user.save({ validateBeforeSave: false })
  const safe = req.user.toObject()
  delete safe.password
  res.json({ avatar, user: safe })
}

// DELETE /api/auth/me/avatar
// Phase 6.3 (TASK 9) - "Delete Avatar (if architecture supports it)".
// It does: `User.avatar` is a plain string field that already defaults to '',
// and every consumer (the <Avatar/> component, the Navbar, the Dashboard)
// already falls back to generated initials when it is empty - that fallback is
// what an account renders before its first upload. So clearing the field is a
// fully supported state and needs no schema change.
//
// Deliberately mirrors updateAvatar exactly: same route prefix, same `protect`
// middleware, same response shape ({ avatar, user }), and it likewise derives
// the target from req.user so a caller can only ever clear their OWN picture.
// RBAC is unchanged and no id is accepted from the client.
//
// The file on disk is intentionally left in /uploads rather than unlinked: the
// same uploaded file may still be referenced by an Employee record or an older
// document, and this codebase has no reference-counting for uploads. Unlinking
// blindly could break unrelated images, so only the reference is cleared.
export async function deleteAvatar(req, res) {
  req.user.avatar = ''
  await req.user.save({ validateBeforeSave: false })
  const safe = req.user.toObject()
  delete safe.password
  res.json({ avatar: '', user: safe })
}

// POST /api/auth/refresh
export async function refresh(req, res) {
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token required' })
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
    const user = await User.findById(decoded.id)
    if (!user) return res.status(401).json({ message: 'Invalid refresh token' })
    res.json({ token: signToken(user) })
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' })
  }
}

// POST /api/auth/forgot-password
export async function forgotPassword(req, res) {
  const { email } = req.body
  const user = await User.findOne({ email })
  // Always return 200 to avoid user enumeration.
  if (user) {
    const token = crypto.randomBytes(32).toString('hex')
    user.resetToken = crypto.createHash('sha256').update(token).digest('hex')
    user.resetTokenExpiry = Date.now() + 30 * 60 * 1000
    await user.save({ validateBeforeSave: false })
    // TODO: send `token` via Nodemailer using SMTP env vars. Never log the raw
    // reset token — it is a credential.
  }
  res.json({ message: 'If that email exists, a reset link has been sent.' })
}

// Phase 5.5 (Task 1) — shared password strength policy.
//
// Declared once and exported so the self-serve change-password flow and any
// future caller (admin reset, forced rotation) validate against the SAME rule
// instead of each re-implementing a regex. The frontend mirrors these rules for
// instant feedback, but this function is the authority.
export const PASSWORD_MIN_LENGTH = 8

export function validatePasswordStrength(password) {
  const value = String(password || '')
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`
  }
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter'
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter'
  if (!/[0-9]/.test(value)) return 'Password must contain at least one number'
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain at least one special character'
  return null
}

// POST /api/auth/me/password
// Phase 5.5 (Task 1): self-serve password change for the CURRENT authenticated
// user, for EVERY role including Client. Until now the only ways to change a
// password were the emailed forgot/reset flow and an admin edit — a signed-in
// user had no way to rotate their own credential.
//
// Reuses the existing auth primitives rather than adding a parallel system:
//   - `protect` establishes req.user (so a user can only change their OWN
//     password; there is no id parameter to tamper with, and no RBAC change).
//   - `user.comparePassword()` verifies the current password with bcrypt.
//   - Assigning `user.password` and calling save() lets the model's existing
//     pre('save') hook hash it. The hash is never computed here, so there is
//     exactly one hashing implementation in the codebase.
export async function changePassword(req, res) {
  const { currentPassword, newPassword, confirmPassword } = req.body || {}

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' })
  }
  // Only enforced when the client sends it, so API callers are not forced to
  // duplicate a purely UI-level confirmation field.
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'New password and confirmation do not match' })
  }

  const strengthError = validatePasswordStrength(newPassword)
  if (strengthError) return res.status(422).json({ message: strengthError })

  // `password` is `select: false` on the schema, so req.user (loaded by
  // `protect`) does NOT carry the hash. Re-read the document explicitly.
  const user = await User.findById(req.user._id).select('+password')
  if (!user) return res.status(404).json({ message: 'User not found' })

  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ message: 'Current password is incorrect' })
  }

  if (await user.comparePassword(newPassword)) {
    return res.status(422).json({ message: 'New password must be different from your current password' })
  }

  user.password = newPassword
  // Any outstanding emailed reset token is invalidated: the credential just
  // changed, so a previously issued reset link must not stay usable.
  user.resetToken = undefined
  user.resetTokenExpiry = undefined
  await user.save()

  // No token is reissued. The existing JWT stays valid because it is keyed to
  // the user id and role, neither of which changed. There is no session store
  // in this codebase, so "log out other sessions" is genuinely not supported
  // and is therefore NOT claimed here.
  res.json({ message: 'Password changed successfully' })
}

// POST /api/auth/reset-password
export async function resetPassword(req, res) {
  const { token, password } = req.body
  const hashed = crypto.createHash('sha256').update(token || '').digest('hex')
  const user = await User.findOne({ resetToken: hashed, resetTokenExpiry: { $gt: Date.now() } }).select('+resetToken')
  if (!user) return res.status(400).json({ message: 'Invalid or expired token' })
  user.password = password
  user.resetToken = undefined
  user.resetTokenExpiry = undefined
  await user.save()
  res.json({ message: 'Password reset successful' })
}
