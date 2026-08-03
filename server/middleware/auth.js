import jwt from 'jsonwebtoken'
import { User, LEGACY_ROLE_MAP } from '../models/User.js'

// Sign an access token.
export const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  })

export const signRefreshToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  })

// Verify JWT and attach the user to req.
export async function protect(req, res, next) {
  // Idempotent: if a parent router already authenticated the request, skip the
  // (redundant) token verify + DB lookup. This lets resource routers safely call
  // `protect` even when an upstream router already did.
  if (req.user) return next()
  try {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token' })
    }
    const token = header.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id)
    if (!user) return res.status(401).json({ message: 'User no longer exists' })
    // Phase 4: fold retired roles (Super Admin / Sales / Finance) into the role
    // that inherited their permissions. Persisted once so the document stops
    // violating the ROLES enum on its next save.
    const merged = LEGACY_ROLE_MAP[user.role]
    if (merged) {
      user.role = merged
      await User.updateOne({ _id: user._id }, { $set: { role: merged } })
    }
    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token failed' })
  }
}

// Restrict route to specific roles.
export const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permissions' })
  }
  next()
}

// Block the external Client role from an internal resource. Used by routers that
// expose company-wide data so clients (who live entirely in the /api/client tree)
// can never read internal records. Assumes `protect` has already run.
export const blockClient = (req, res, next) =>
  req.user?.role === 'Client'
    ? res.status(403).json({ message: 'Forbidden: clients cannot access this resource' })
    : next()
