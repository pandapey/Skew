// Phase 4 — single, shared notification emitter.
//
// Before Phase 4 the only fan-out helper (`notifyByName`) lived privately inside
// projectService.js, so the leave workflow had no way to emit in-app
// notifications without duplicating it. It is lifted here unchanged in
// behaviour and reused by BOTH leaveService and projectService — no duplicate
// API surface, no second implementation to keep in sync.
//
// PRIVACY GUARANTEE (Part 9: "notifications must remain individual"):
// The Notification collection stores ONE document per recipient, keyed by that
// user's email in `recipient`. There is no shared/broadcast document and no
// multi-recipient array. Every read path filters on the caller's own email, so
// a notification is structurally impossible to share between users.

import { User } from '../models/User.js'
import { Notification, NotificationSettings } from '../models/notificationModels.js'

// Resolve internal member/lead NAMES to user emails and create one notification
// each. People are referenced by name across projects and leave requests, so we
// look up their accounts to address notifications. Client-role users are never
// notified through this path.
export async function notifyUsersByName(names, payload) {
  const unique = [...new Set((names || []).filter(Boolean))]
  if (!unique.length) return []
  const users = await User.find({ name: { $in: unique }, role: { $ne: 'Client' } })
    .select('email name')
    .lean()
  if (!users.length) return []
  return deliver(users.map((u) => u.email), payload)
}

// Deliver to explicit email addresses (used when the recipient is already known).
export async function notifyUsersByEmail(emails, payload) {
  const unique = [...new Set((emails || []).filter(Boolean))]
  if (!unique.length) return []
  return deliver(unique, payload)
}

// Insert one private document per recipient, honouring each user's per-category
// notification preferences (the NotificationSettings collection already exists
// and is surfaced in the UI, so we must not bypass it).
async function deliver(emails, payload) {
  const { type = 'announcement' } = payload
  const settings = await NotificationSettings.find({ user: { $in: emails } }).lean()
  const muted = new Set(
    settings.filter((s) => s[type] === false).map((s) => s.user)
  )
  const targets = emails.filter((email) => !muted.has(email))
  if (!targets.length) return []
  return Notification.insertMany(targets.map((email) => ({ ...payload, recipient: email })))
}
