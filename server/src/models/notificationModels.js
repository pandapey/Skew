import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// A single notification delivered to a user.
const notificationSchema = new Schema({
  recipient: { type: String, required: true, index: true }, // user email / id
  // Phase 5.1 (Task 1): 'admin' was MISSING here while the client has always
  // treated it as a first-class category (NOTIF_TYPES in
  // features/notifications/constants.js declares it, and the admin pages emit
  // it for user/role/status changes). The enum was the incomplete side of the
  // contract, so every admin-category notification was rejected with
  // "`admin` is not a valid enum value for path `type`" — surfacing as an error
  // toast after an otherwise successful user creation. Aligning the enum with
  // the client's declared type list fixes the cause rather than the symptom.
  type: {
    type: String,
    enum: ['task', 'leave', 'attendance', 'meeting', 'project', 'announcement', 'admin'],
    default: 'announcement', index: true,
  },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  sender: { type: String, default: 'System' },
  link: { type: String, default: null },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  read: { type: Boolean, default: false, index: true },
}, opts)

// Per-user notification preferences.
const settingsSchema = new Schema({
  user: { type: String, required: true, unique: true },
  task: { type: Boolean, default: true },
  leave: { type: Boolean, default: true },
  attendance: { type: Boolean, default: true },
  meeting: { type: Boolean, default: true },
  project: { type: Boolean, default: true },
  announcement: { type: Boolean, default: true },
  // Phase 5.1: mute preference for the 'admin' category, so the new type is
  // controllable on the Notification Settings screen like every other one.
  admin: { type: Boolean, default: true },
  push: { type: Boolean, default: true },
  emailDigest: { type: Boolean, default: false },
}, opts)

export const Notification = model('Notification', notificationSchema)
export const NotificationSettings = model('NotificationSettings', settingsSchema)
