import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { Activity } from '../models/adminModels.js'
import { signToken, signRefreshToken } from '../middleware/auth.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'
import { uploadToDrive } from '../utils/driveUpload.js'
import fs from 'fs'
import path from 'path'

const stringOf = (v, fallback = 'Unknown') => {
  const s = String(v || '').trim().slice(0, 80)
  return s || fallback
}

export async function login(req, res) {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' })

  const user = await User.findOne({ email }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' })
  }

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

  let sessionId = ''
  try {
    const session = await Activity.create({
      userId: user._id,
      user: user.email,
      role: user.role,
      device: stringOf(req.body.device),
      browser: stringOf(req.body.browser),
      os: stringOf(req.body.os),
      ip: req.ip || '0.0.0.0',
      location: '',
      startedAt: new Date(),
      currentUrl: '/',
      active: true,
    })
    sessionId = String(session._id)
  } catch (err) {
    systemLog('WARN', `Failed to record login session for ${user.email}: ${err?.message || err}`, SYSTEM_LOG_SOURCES.API)
  }

  const safe = user.toObject()
  delete safe.password
  res.json({ user: safe, token: signToken(user), refreshToken: signRefreshToken(user), sessionId })
}

export async function logout(req, res) {
  const { sessionId } = req.body || {}
  let target = null
  if (sessionId && mongoose.isValidObjectId(sessionId)) {
    target = await Activity.findOne({ _id: sessionId, userId: req.user._id })
  }
  if (!target) {
    target = await Activity.findOne({ userId: req.user._id, active: true, logoutAt: null })
      .sort({ startedAt: -1 })
  }
  if (target) {
    target.logoutAt = new Date()
    target.active = false
    await target.save()
  }
  res.json({ ok: true })
}

export async function me(req, res) {
  res.json(req.user)
}

export async function updateAvatar(req, res) {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' })
  let avatar = null
  if (process.env.GOOGLE_DRIVE_FOLDER_ID && req.file.buffer) {
    const uploaded = await uploadToDrive({ buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype })
    avatar = uploaded.id
  } else {
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const filename = `${Date.now()}-${safe}`
    const dest = path.join(process.cwd(), 'uploads', filename)
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, req.file.buffer)
    avatar = `/uploads/${filename}`
  }
  req.user.avatar = avatar
  await req.user.save({ validateBeforeSave: false })
  const safe = req.user.toObject()
  delete safe.password
  res.json({ avatar, user: safe })
}

export async function deleteAvatar(req, res) {
  req.user.avatar = ''
  await req.user.save({ validateBeforeSave: false })
  const safe = req.user.toObject()
  delete safe.password
  res.json({ avatar: '', user: safe })
}

export async function getAvatar(req, res) {
  const fileId = req.params.fileId
  if (!fileId) return res.status(400).json({ message: 'File ID required' })
  // Drive fileId (no slash) -> proxy via Drive
  if (!String(fileId).startsWith('/')) {
    try {
      const { driveDownload } = await import('../utils/driveUpload.js')
      return driveDownload(fileId, res)
    } catch (e) {
      return res.status(404).json({ message: 'Avatar not found' })
    }
  }
  // fallback old local path
  const p = path.join(process.cwd(), String(fileId).replace(/^\//, ''))
  if (!fs.existsSync(p)) return res.status(404).json({ message: 'Avatar not found' })
  res.sendFile(p)
}

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

export async function changePassword(req, res) {
  const { currentPassword, newPassword, confirmPassword } = req.body || {}

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' })
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'New password and confirmation do not match' })
  }

  const strengthError = validatePasswordStrength(newPassword)
  if (strengthError) return res.status(422).json({ message: strengthError })

  const user = await User.findById(req.user._id).select('+password')
  if (!user) return res.status(404).json({ message: 'User not found' })

  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ message: 'Current password is incorrect' })
  }

  if (await user.comparePassword(newPassword)) {
    return res.status(422).json({ message: 'New password must be different from your current password' })
  }

  user.password = newPassword
  user.resetToken = undefined
  user.resetTokenExpiry = undefined
  await user.save()

  res.json({ message: 'Password changed successfully' })
}
