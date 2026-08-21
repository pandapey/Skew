import { Notification, NotificationSettings } from '../models/notificationModels.js'
import { asyncHandler } from '../utils/asyncHandler.js'

const norm = (doc) => {
  if (!doc) return doc
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  o.id = String(doc._id)
  return o
}

// Phase 5.1 (Task 1): 'admin' added to match the notification type enum and the
// client's NOTIF_TYPES list. updateSettings only copies keys present here, so
// without this entry the admin mute toggle could never be persisted.
const DEFAULT_SETTINGS = {
  task: true, leave: true, attendance: true, meeting: true,
  project: true, announcement: true, admin: true, push: true, emailDigest: false,
}

// List notifications for the current user, optionally filtered by type / unread.
export const listNotifications = asyncHandler(async (req, res) => {
  const { type, unread } = req.query
  const filter = { recipient: req.user.email }
  if (type && type !== 'all') filter.type = type
  if (unread === '1' || unread === 'true') filter.read = false
  const items = await Notification.find(filter).sort({ createdAt: -1 }).lean()
  res.json(items.map(norm))
})

// Mark a single notification read.
export const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user.email },
    { read: true }, { new: true },
  )
  if (!n) return res.status(404).json({ message: 'Notification not found' })
  res.json(norm(n))
})

// Mark every notification for the user as read.
export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.email, read: false }, { read: true })
  res.json({ ok: true })
})

// Get the user's notification preferences (falls back to defaults).
export const getSettings = asyncHandler(async (req, res) => {
  const existing = await NotificationSettings.findOne({ user: req.user.email }).lean()
  res.json(existing ? { ...DEFAULT_SETTINGS, ...existing, user: req.user.email } : { ...DEFAULT_SETTINGS, user: req.user.email })
})

// Update (merge) the user's notification preferences.
export const updateSettings = asyncHandler(async (req, res) => {
  const patch = {}
  Object.keys(DEFAULT_SETTINGS).forEach((k) => {
    if (typeof req.body[k] === 'boolean') patch[k] = req.body[k]
  })
  const settings = await NotificationSettings.findOneAndUpdate(
    { user: req.user.email }, patch, { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  res.json({ ...DEFAULT_SETTINGS, ...settings.toObject(), user: req.user.email })
})

// Create a notification (used by other modules and the real-time simulator).
export const createNotification = asyncHandler(async (req, res) => {
  const { type, title, body, sender, link, priority } = req.body
  if (!title) return res.status(400).json({ message: 'Title is required' })
  const notification = await Notification.create({
    recipient: req.body.recipient || req.user.email,
    type, title, body, sender, link, priority,
  })
  res.status(201).json(norm(notification))
})

// Unread count (lightweight, handy for the navbar badge / polling).
export const unreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user.email, read: false })
  res.json({ count })
})
