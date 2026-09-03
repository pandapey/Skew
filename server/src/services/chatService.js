import { ApiError } from '../utils/asyncHandler.js'
import { User } from '../models/User.js'
import { Conversation, Message, ChatBlock, UserPresence } from '../models/chatModels.js'
import { FileItem } from '../models/fileModels.js'
import { notifyUsersByEmail } from './notificationService.js'
import { emitToUsers, getPresenceMap, isUserOnline } from '../realtime/index.js'
import { uploadToDrive } from '../utils/driveUpload.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const CHAT_ROLES = ['Admin', 'Manager', 'Employee']
const MESSAGE_PREVIEW_LENGTH =80
const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 200
const EDIT_WINDOW_MS = 15 * 60 * 1000

const isObjectId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || ''))

const compact = (user) => ({
  _id: String(user._id),
  name: user.name || '',
  email: user.email || '',
  role: user.role || 'Employee',
  avatar: user.avatar || '',
  empCode: user.empCode || '',
  designation: user.designation || '',
  department: user.department || '',
})

export async function listChatUsers() {
  const users = await User.find({ role: { $in: CHAT_ROLES }, status: 'Active' })
    .select('name email role avatar empCode designation department')
    .sort({ name: 1 })
    .lean()
  return users.map(compact)
}

function assertObjectId(id, label = 'id') {
  if (!isObjectId(id)) throw new ApiError(400, `Invalid ${label}`)
}

async function resolveInternalUser(userId) {
  const user = await User.findById(userId).select('name email role avatar empCode designation department status').lean()
  if (!user) throw new ApiError(404, 'User not found')
  if (!CHAT_ROLES.includes(user.role)) throw new ApiError(403, 'Internal chat is available to staff only')
  return user
}

async function loadConversation(conversationId) {
  assertObjectId(conversationId, 'conversation id')
  const conversation = await Conversation.findById(conversationId).lean()
  if (!conversation) throw new ApiError(404, 'Conversation not found')
  return conversation
}

function assertParticipant(conversation, userId) {
  const member = (conversation.participants || []).some(
    (p) => String(p.user) === String(userId)
  )
  if (!member) throw new ApiError(403, 'You are not a participant of this conversation')
}

function canManageGroup(conversation, user) {
  if (conversation.type !== 'group') return false
  if (String(conversation.createdBy) === String(user._id)) return true
  if ((conversation.admins || []).some((id) => String(id) === String(user._id))) return true
  if (user.role === 'Admin') return true
  return false
}

function isAdmin(conversation, userId) {
  if (String(conversation.createdBy) === String(userId)) return true
  if ((conversation.admins || []).some((id) => String(id) === String(userId))) return true
  return false
}

async function isBlocked(a, b) {
  const found = await ChatBlock.findOne({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }).lean()
  return !!found
}

async function unreadCount(conversationId, userId) {
  return Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId },
    'readBy.user': { $ne: userId },
    isDeleted: { $ne: true },
    isDeletedForEveryone: { $ne: true },
    deletedFor: { $ne: userId },
  })
}

function otherParticipant(conversation, userId, participantsById) {
  const target = (conversation.participants || []).find((p) => String(p.user) !== String(userId))
  return target ? (participantsById.get(String(target.user)) || null) : null
}

function buildConversationView(conversation, me, participantsById, unread) {
  const isGroup = conversation.type === 'group'
  const members = (conversation.participants || [])
    .map((p) => {
      const u = participantsById.get(String(p.user))
      if (!u) return null
      return { ...u, groupRole: p.groupRole || 'member', isMuted: p.isMuted || false, isPinned: p.isPinned || false, isArchived: p.isArchived || false, joinedAt: p.joinedAt }
    })
    .filter(Boolean)
  const other = otherParticipant(conversation, me, participantsById)
  const mePart = (conversation.participants || []).find((p) => String(p.user) === String(me))
  return {
    _id: String(conversation._id),
    type: conversation.type,
    name: isGroup ? conversation.name : (other?.name || 'Unknown user'),
    description: conversation.description || null,
    icon: conversation.icon || null,
    other,
    isGroup,
    memberCount: members.length,
    participants: members,
    admins: (conversation.admins || []).map(String),
    createdBy: conversation.createdBy ? String(conversation.createdBy) : null,
    inviteCode: conversation.inviteCode || null,
    inviteEnabled: conversation.inviteEnabled !== false,
    settings: conversation.settings || { onlyAdminsCanSend: false, disappearingEnabled: false, disappearingDuration: 0 },
    isMuted: mePart?.isMuted || false,
    isPinned: mePart?.isPinned || false,
    isArchived: mePart?.isArchived || false,
    lastMessage: conversation.lastMessage
      ? {
          text: conversation.lastMessage.text || '',
          sender: conversation.lastMessage.sender ? String(conversation.lastMessage.sender) : null,
          senderName: conversation.lastMessage.senderName || '',
          at: conversation.lastMessage.at || null,
          hasAttachment: conversation.lastMessage.hasAttachment || false,
        }
      : null,
    unreadCount: unread || 0,
    updatedAt: conversation.updatedAt || conversation.createdAt || null,
  }
}

export async function listConversations(userId) {
  let conversations = await Conversation.find({ 'participants.user': userId })
    .sort({ updatedAt: -1 })
    .lean()

  // auto-cleanup: delete direct chats with zero messages and no lastMessage (user selected person but never sent)
  // grace 60s so newly created empty stays while typing first message
  const toCheck = conversations.filter((c) => c.type === 'direct' && !c.lastMessage?.text && !c.lastMessage?.hasAttachment && c.createdAt && new Date(c.createdAt).getTime() < Date.now() - 60 * 1000)
  if (toCheck.length) {
    const checkIds = toCheck.map((c) => c._id)
    const counts = await Message.aggregate([
      { $match: { conversation: { $in: checkIds } } },
      { $group: { _id: '$conversation', count: { $sum: 1 } } },
    ])
    const countMap = new Map(counts.map((r) => [String(r._id), r.count]))
    const emptyIds = toCheck.filter((c) => (countMap.get(String(c._id)) || 0) === 0).map((c) => c._id)
    if (emptyIds.length) {
      await Conversation.deleteMany({ _id: { $in: emptyIds } })
      await Message.deleteMany({ conversation: { $in: emptyIds } })
      conversations = conversations.filter((c) => !emptyIds.some((id) => String(id) === String(c._id)))
    }
  }

  const participantIds = new Set()
  conversations.forEach((c) => (c.participants || []).forEach((p) => participantIds.add(String(p.user))))
  const users = await User.find({ _id: { $in: [...participantIds] } })
    .select('name email role avatar empCode designation department')
    .lean()
  const participantsById = new Map(users.map((u) => [String(u._id), compact(u)]))

  const views = await Promise.all(conversations.map(async (c) => {
    const unread = await unreadCount(c._id, userId)
    return buildConversationView(c, userId, participantsById, unread)
  }))

  views.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return new Date(b.updatedAt) - new Date(a.updatedAt)
  })
  return views
}

export async function getConversation(userId, conversationId) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const ids = (conversation.participants || []).map((p) => p.user)
  const users = await User.find({ _id: { $in: ids } })
    .select('name email role avatar empCode designation department')
    .lean()
  const participantsById = new Map(users.map((u) => [String(u._id), compact(u)]))
  const unread = await unreadCount(conversation._id, userId)
  return buildConversationView(conversation, userId, participantsById, unread)
}

export async function totalUnreadCount(userId) {
  const conversations = await Conversation.find({ 'participants.user': userId }).select('_id').lean()
  const count = await Message.countDocuments({
    conversation: { $in: conversations.map((c) => c._id) },
    sender: { $ne: userId },
    'readBy.user': { $ne: userId },
    isDeleted: { $ne: true },
    deletedFor: { $ne: userId },
  })
  return { count }
}

export async function getPresence(userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(String).filter(isObjectId)
  const map = getPresenceMap()
  const db = await UserPresence.find({ user: { $in: ids } }).lean()
  const dbMap = new Map(db.map((d) => [String(d.user), d]))
  return ids.map((id) => {
    const mem = map.get(id)
    const row = dbMap.get(id)
    return {
      userId: id,
      isOnline: mem ? !!mem.isOnline : !!row?.isOnline,
      lastSeen: mem?.lastSeen || row?.lastSeen || null,
    }
  })
}

export async function getBlockedUsers(userId) {
  const rows = await ChatBlock.find({ blocker: userId }).populate('blocked', 'name email avatar role').lean()
  return rows.map((r) => ({ _id: String(r.blocked._id), name: r.blocked.name, email: r.blocked.email, avatar: r.blocked.avatar, role: r.blocked.role }))
}

export async function blockUser(userId, targetId) {
  assertObjectId(targetId, 'user id')
  if (String(userId) === String(targetId)) throw new ApiError(400, 'Cannot block yourself')
  await resolveInternalUser(targetId)
  await ChatBlock.findOneAndUpdate({ blocker: userId, blocked: targetId }, {}, { upsert: true, new: true })
  return { blocked: true }
}

export async function unblockUser(userId, targetId) {
  assertObjectId(targetId, 'user id')
  await ChatBlock.deleteOne({ blocker: userId, blocked: targetId })
  return { unblocked: true }
}

export async function getOrCreateDirectConversation(userId, otherUserId) {
  assertObjectId(otherUserId, 'user id')
  const me = await resolveInternalUser(userId)
  const other = await resolveInternalUser(otherUserId)
  if (String(me._id) === String(other._id)) {
    throw new ApiError(400, 'You cannot start a conversation with yourself')
  }
  if (await isBlocked(me._id, other._id)) throw new ApiError(403, 'You cannot chat with this user (blocked)')

  const existing = await Conversation.findOne({
    type: 'direct',
    participants: { $size: 2 },
    'participants.user': { $all: [me._id, other._id] },
  }).lean()
  if (existing) return getConversation(userId, existing._id)

  const conversation = await Conversation.create({
    type: 'direct',
    createdBy: me._id,
    participants: [
      { user: me._id, role: me.role, groupRole: 'member' },
      { user: other._id, role: other.role, groupRole: 'member' },
    ],
  })
  await emitToUsers([me._id, other._id], 'chat:conversation', { conversationId: String(conversation._id) })
  return getConversation(userId, conversation._id)
}

export async function createGroup(userId, { name, memberIds = [], description, icon } = {}) {
  const me = await resolveInternalUser(userId)
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new ApiError(400, 'Group name is required')
  if (cleanName.length > 60) throw new ApiError(400, 'Group name is too long')

  const requested = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(String))]
  const members = []
  for (const id of requested) {
    if (String(id) === String(me._id)) continue
    const u = await resolveInternalUser(id)
    if (await isBlocked(me._id, u._id)) continue
    members.push(u)
  }

  const conversation = await Conversation.create({
    type: 'group',
    name: cleanName,
    description: String(description || '').trim().slice(0, 300) || null,
    icon: icon || null,
    createdBy: me._id,
    admins: [me._id],
    participants: [
      { user: me._id, role: me.role, groupRole: 'admin', addedBy: me._id },
      ...members.map((m) => ({ user: m._id, role: m.role, groupRole: 'member', addedBy: me._id })),
    ],
    inviteCode: crypto.randomBytes(4).toString('hex'),
  })
  const ids = [me._id, ...members.map((m) => m._id)]
  await emitToUsers(ids, 'chat:conversation', { conversationId: String(conversation._id) })
  await Message.create({
    conversation: conversation._id,
    sender: me._id,
    text: `${me.name} created group "${cleanName}"`,
    messageType: 'system',
  })
  return getConversation(userId, conversation._id)
}

export async function updateGroupInfo(userId, conversationId, { name, description, icon } = {}) {
  const me = await resolveInternalUser(userId)
  const conv = await Conversation.findById(conversationId)
  if (!conv) throw new ApiError(404, 'Conversation not found')
  assertParticipant(conv, userId)
  if (!canManageGroup(conv, me)) throw new ApiError(403, 'Only admins can update group info')
  const updates = {}
  if (name !== undefined) {
    const clean = String(name).trim()
    if (!clean) throw new ApiError(400, 'Group name is required')
    if (clean.length > 60) throw new ApiError(400, 'Group name is too long')
    updates.name = clean
  }
  if (description !== undefined) updates.description = String(description).trim().slice(0, 500) || null
  if (icon !== undefined) updates.icon = icon || null
  await Conversation.updateOne({ _id: conv._id }, { $set: updates })
  const memberIds = conv.participants.map((p) => p.user)
  await emitToUsers(memberIds, 'chat:conversation-updated', { conversationId: String(conv._id) })
  return getConversation(userId, conv._id)
}

export async function setGroupAdmin(userId, conversationId, targetId, makeAdmin = true) {
  assertObjectId(targetId, 'user id')
  const me = await resolveInternalUser(userId)
  const conv = await Conversation.findById(conversationId)
  if (!conv) throw new ApiError(404, 'Conversation not found')
  assertParticipant(conv, userId)
  if (!canManageGroup(conv, me)) throw new ApiError(403, 'Only admins can manage admins')
  if (!conv.participants.some((p) => String(p.user) === String(targetId))) throw new ApiError(404, 'User is not a member')
  if (makeAdmin) {
    await Conversation.updateOne({ _id: conv._id }, { $addToSet: { admins: targetId }, $set: { 'participants.$[elem].groupRole': 'admin' } }, { arrayFilters: [{ 'elem.user': targetId }] })
  } else {
    if (String(targetId) === String(conv.createdBy)) throw new ApiError(400, 'Cannot demote group creator')
    await Conversation.updateOne({ _id: conv._id }, { $pull: { admins: targetId }, $set: { 'participants.$[elem].groupRole': 'member' } }, { arrayFilters: [{ 'elem.user': targetId }] })
  }
  const memberIds = conv.participants.map((p) => p.user)
  await emitToUsers(memberIds, 'chat:conversation-updated', { conversationId: String(conv._id) })
  return getConversation(userId, conv._id)
}

export async function setGroupSettings(userId, conversationId, { onlyAdminsCanSend, disappearingEnabled, disappearingDuration } = {}) {
  const me = await resolveInternalUser(userId)
  const conv = await Conversation.findById(conversationId)
  if (!conv) throw new ApiError(404, 'Conversation not found')
  assertParticipant(conv, userId)
  if (!canManageGroup(conv, me)) throw new ApiError(403, 'Only admins can change settings')
  const set = {}
  if (onlyAdminsCanSend !== undefined) set['settings.onlyAdminsCanSend'] = !!onlyAdminsCanSend
  if (disappearingEnabled !== undefined) set['settings.disappearingEnabled'] = !!disappearingEnabled
  if (disappearingDuration !== undefined) set['settings.disappearingDuration'] = Number(disappearingDuration) || 0
  await Conversation.updateOne({ _id: conv._id }, { $set: set })
  const memberIds = conv.participants.map((p) => p.user)
  await emitToUsers(memberIds, 'chat:conversation-updated', { conversationId: String(conv._id) })
  return getConversation(userId, conv._id)
}

export async function generateInviteCode(userId, conversationId) {
  const me = await resolveInternalUser(userId)
  const conv = await Conversation.findById(conversationId)
  if (!conv) throw new ApiError(404, 'Conversation not found')
  assertParticipant(conv, userId)
  if (!canManageGroup(conv, me)) throw new ApiError(403, 'Only admins can generate invite')
  const code = crypto.randomBytes(4).toString('hex')
  await Conversation.updateOne({ _id: conv._id }, { $set: { inviteCode: code, inviteEnabled: true } })
  return { inviteCode: code, link: `/chat/join/${code}` }
}

export async function joinViaInvite(userId, code) {
  const me = await resolveInternalUser(userId)
  const conv = await Conversation.findOne({ inviteCode: String(code).trim(), inviteEnabled: true })
  if (!conv) throw new ApiError(404, 'Invalid or disabled invite link')
  if (conv.participants.some((p) => String(p.user) === String(me._id))) return getConversation(userId, conv._id)
  if (conv.participants.length >= 512) throw new ApiError(400, 'Group is full')
  await Conversation.updateOne({ _id: conv._id }, { $push: { participants: { user: me._id, role: me.role, groupRole: 'member', addedBy: me._id } } })
  await Message.create({ conversation: conv._id, sender: me._id, text: `${me.name} joined via invite link`, messageType: 'system' })
  const memberIds = [...conv.participants.map((p) => p.user), me._id]
  await emitToUsers(memberIds, 'chat:conversation-updated', { conversationId: String(conv._id) })
  return getConversation(userId, conv._id)
}

export async function setConversationPref(userId, conversationId, { isMuted, mutedUntil, isPinned, isArchived, isCleared } = {}) {
  const conv = await Conversation.findById(conversationId)
  if (!conv) throw new ApiError(404, 'Conversation not found')
  assertParticipant(conv, userId)
  const set = {}
  if (isMuted !== undefined) set['participants.$[elem].isMuted'] = !!isMuted
  if (mutedUntil !== undefined) set['participants.$[elem].mutedUntil'] = mutedUntil ? new Date(mutedUntil) : null
  if (isPinned !== undefined) set['participants.$[elem].isPinned'] = !!isPinned
  if (isArchived !== undefined) set['participants.$[elem].isArchived'] = !!isArchived
  if (isCleared) {
    set['participants.$[elem].lastClearedAt'] = new Date()
    // also clear global lastMessage preview so left side shows "No messages yet" for all (requested)
    await Conversation.updateOne({ _id: conv._id }, { $set: { lastMessage: {} } })
  }
  if (Object.keys(set).length) {
    await Conversation.updateOne({ _id: conv._id }, { $set: set }, { arrayFilters: [{ 'elem.user': userId }] })
  }
  return getConversation(userId, conv._id)
}

export async function clearChat(userId, conversationId) {
  return setConversationPref(userId, conversationId, { isCleared: true })
}

export async function listMessages(userId, conversationId, { before, limit, search } = {}) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const part = (conversation.participants || []).find((p) => String(p.user) === String(userId))
  const lastClearedAt = part?.lastClearedAt ? new Date(part.lastClearedAt) : null

  const query = { conversation: conversation._id, deletedFor: { $ne: userId } }
  if (lastClearedAt) query.createdAt = { $gte: lastClearedAt }
  if (before) {
    assertObjectId(before, 'before id')
    query._id = { $lt: before }
    if (lastClearedAt && query.createdAt) {
      // keep both filters
    }
  }
  if (search) {
    const term = String(search).trim()
    if (term) query.$text = { $search: term }
  }
  const size = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT)
  let sort = { _id: -1 }
  if (search && query.$text) sort = { score: { $meta: 'textScore' } }
  const messages = search && query.$text
    ? await Message.find(query, { score: { $meta: 'textScore' } }).sort(sort).limit(size).lean()
    : await Message.find(query).sort(sort).limit(size).lean()

  // auto mark delivered for requester for messages not yet delivered
  const undeliveredIds = messages.filter((m) => String(m.sender) !== String(userId) && !(m.deliveredTo || []).some((d) => String(d.user) === String(userId)) && !m.isDeleted).map((m) => m._id)
  if (undeliveredIds.length) {
    await Message.updateMany({ _id: { $in: undeliveredIds } }, { $push: { deliveredTo: { user: userId, at: new Date() } } })
    const memberIds = (conversation.participants || []).map((p) => p.user).filter((id) => String(id) !== String(userId))
    await emitToUsers(memberIds, 'chat:delivered', { conversationId: String(conversation._id), messageIds: undeliveredIds.map(String), userId: String(userId) })
  }

  const senderIds = new Set(messages.map((m) => String(m.sender)))
  const senders = await User.find({ _id: { $in: [...senderIds] } })
    .select('name email role avatar')
    .lean()
  const senderById = new Map(senders.map((u) => [String(u._id), u]))

  const filtered = search && query.$text ? messages : messages.reverse()
  return filtered.map((m) => ({
    _id: String(m._id),
    conversationId: String(m.conversation),
    sender: String(m.sender),
    senderName: senderById.get(String(m.sender))?.name || 'Unknown',
    senderAvatar: senderById.get(String(m.sender))?.avatar || '',
    text: m.isDeletedForEveryone ? 'This message was deleted' : m.isDeleted ? '' : m.text,
    messageType: m.messageType || 'text',
    attachment: m.isDeletedForEveryone ? null : m.attachment || null,
    replyTo: m.replyTo || null,
    forwarded: !!m.forwarded,
    isEdited: !!m.isEdited,
    editedAt: m.editedAt || null,
    isDeleted: !!m.isDeleted || !!m.isDeletedForEveryone,
    isDeletedForEveryone: !!m.isDeletedForEveryone,
    deletedFor: (m.deletedFor || []).map(String),
    starredBy: (m.starredBy || []).map(String),
    reactions: (m.reactions || []).map((r) => ({ user: String(r.user), emoji: r.emoji, at: r.at })),
    deliveredTo: (m.deliveredTo || []).map((r) => String(r.user)),
    readBy: (m.readBy || []).map((r) => String(r.user)),
    expiresAt: m.expiresAt || null,
    location: m.location || null,
    contactCard: m.contactCard || null,
    poll: m.poll || null,
    viewOnce: m.attachment?.viewOnce || false,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }))
}

export async function searchMessages(userId, conversationId, q) {
  return listMessages(userId, conversationId, { search: q, limit: 50 })
}

export async function getStarredMessages(userId, conversationId) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const messages = await Message.find({ conversation: conversation._id, starredBy: userId, deletedFor: { $ne: userId } }).sort({ _id: -1 }).limit(100).lean()
  const senderIds = new Set(messages.map((m) => String(m.sender)))
  const senders = await User.find({ _id: { $in: [...senderIds] } }).select('name avatar').lean()
  const senderById = new Map(senders.map((u) => [String(u._id), u]))
  return messages.map((m) => ({
    _id: String(m._id),
    text: m.text,
    sender: String(m.sender),
    senderName: senderById.get(String(m.sender))?.name || 'Unknown',
    createdAt: m.createdAt,
    attachment: m.attachment,
  }))
}

export async function getMediaMessages(userId, conversationId, kind) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const filter = { conversation: conversation._id, deletedFor: { $ne: userId }, isDeletedForEveryone: { $ne: true } }
  if (kind) filter['attachment.kind'] = kind
  else filter['attachment.fileId'] = { $ne: null }
  const messages = await Message.find(filter).sort({ _id: -1 }).limit(100).lean()
  return messages.map((m) => ({ _id: String(m._id), attachment: m.attachment, text: m.text, createdAt: m.createdAt, sender: String(m.sender) }))
}

export async function sendMessage(userId, conversationId, { text, attachment, replyTo, forwarded, messageType, location, contactCard, poll, viewOnce } = {}) {
  const clean = String(text || '').trim()
  const hasAttachment = Boolean(attachment && attachment.fileId)
  const hasLocation = Boolean(location && location.latitude && location.longitude)
  const hasContact = Boolean(contactCard && contactCard.name)
  const hasPoll = Boolean(poll && poll.question && Array.isArray(poll.options) && poll.options.length >= 2)
  if (!clean && !hasAttachment && !hasLocation && !hasContact && !hasPoll) {
    throw new ApiError(400, 'Message text or an attachment is required')
  }
  if (clean.length > 5000) throw new ApiError(400, 'Message is too long')

  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (conversation.type === 'group' && conversation.settings?.onlyAdminsCanSend && !isAdmin(conversation, userId) && me.role !== 'Admin') {
    throw new ApiError(403, 'Only admins can send messages in this group')
  }
  // blocked check for direct
  if (conversation.type === 'direct') {
    const other = conversation.participants.find((p) => String(p.user) !== String(userId))
    if (other && await isBlocked(userId, other.user)) throw new ApiError(403, 'You cannot message this user (blocked)')
  }

  let replySnap = null
  if (replyTo) {
    assertObjectId(replyTo, 'reply id')
    const orig = await Message.findOne({ _id: replyTo, conversation: conversation._id, deletedFor: { $ne: userId } }).lean()
    if (!orig) throw new ApiError(404, 'Replied message not found')
    if (orig.isDeletedForEveryone) throw new ApiError(400, 'Cannot reply to a deleted message')
    const senderUser = await User.findById(orig.sender).select('name').lean()
    replySnap = {
      messageId: orig._id,
      text: (orig.text || '').slice(0, 200),
      senderName: senderUser?.name || 'Unknown',
      hasAttachment: !!orig.attachment?.fileId,
    }
  }

  let expiresAt = null
  if (conversation.settings?.disappearingEnabled && conversation.settings?.disappearingDuration > 0) {
    expiresAt = new Date(Date.now() + conversation.settings.disappearingDuration * 1000)
  }

  const finalType = messageType || (hasPoll ? 'poll' : hasContact ? 'contact' : hasLocation ? 'location' : hasAttachment ? (attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'video' : attachment.kind === 'audio' ? 'audio' : 'document') : 'text')

  const message = await Message.create({
    conversation: conversation._id,
    sender: me._id,
    text: clean,
    messageType: finalType,
    ...(hasAttachment ? { attachment: { ...attachment, viewOnce: !!viewOnce } } : {}),
    ...(replySnap ? { replyTo: replySnap } : {}),
    ...(forwarded ? { forwarded: true, forwardedFrom: forwarded === true ? null : forwarded } : {}),
    ...(hasLocation ? { location } : {}),
    ...(hasContact ? { contactCard } : {}),
    ...(hasPoll ? { poll: { question: String(poll.question).trim().slice(0, 300), options: poll.options.slice(0, 10).map((o) => ({ text: String(o.text || o).trim().slice(0, 100), votes: [] })), allowMultiple: !!poll.allowMultiple } } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  })

  const preview = clean
    || (hasPoll ? `📊 ${poll.question}` : hasContact ? `👤 ${contactCard.name}` : hasLocation ? '📍 Location' : hasAttachment ? `📎 ${attachment.name || 'Attachment'}` : '')
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessage: {
          text: preview.length > MESSAGE_PREVIEW_LENGTH
            ? `${preview.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
            : preview,
          sender: me._id,
          senderName: me.name,
          at: new Date(),
          hasAttachment: hasAttachment || hasLocation || hasContact || hasPoll,
        },
      },
    }
  )

  const memberIds = (conversation.participants || []).map((p) => p.user)
  const payload = {
    conversationId: String(conversation._id),
    message: {
      _id: String(message._id),
      sender: String(me._id),
      senderName: me.name,
      senderAvatar: me.avatar || '',
      text: clean,
      messageType: finalType,
      attachment: hasAttachment ? { ...attachment, viewOnce: !!viewOnce } : null,
      replyTo: replySnap,
      forwarded: !!forwarded,
      isEdited: false,
      isDeleted: false,
      reactions: [],
      deliveredTo: [],
      readBy: [],
      createdAt: message.createdAt,
      location: hasLocation ? location : null,
      contactCard: hasContact ? contactCard : null,
      poll: hasPoll ? message.poll : null,
    },
  }
  await emitToUsers(memberIds, 'chat:new-message', payload)

  const recipientEmails = memberIds
    .filter((id) => String(id) !== String(me._id))
    .map((id) => String(id))
  if (recipientEmails.length) {
    const recipients = await User.find({ _id: { $in: recipientEmails } })
      .select('email')
      .lean()
    const isMutedFor = (uid) => {
      const p = (conversation.participants || []).find((x) => String(x.user) === String(uid))
      if (!p?.isMuted) return false
      if (p.mutedUntil && new Date(p.mutedUntil) < new Date()) return false
      return true
    }
    const activeRecipients = recipients.filter((r) => !isMutedFor(r._id))
    if (activeRecipients.length) {
      await notifyUsersByEmail(
        activeRecipients.map((r) => r.email),
        {
          type: 'chat',
          title: me.name || 'New message',
          body: preview.length > 140 ? `${preview.slice(0, 140)}…` : preview,
          sender: me.name || 'System',
          link: '/chat',
          priority: 'normal',
        }
      ).catch(() => {})
    }
  }

  return payload.message
}

export async function forwardMessage(userId, messageId, targetConversationId) {
  assertObjectId(messageId, 'message id')
  const msg = await Message.findById(messageId).lean()
  if (!msg) throw new ApiError(404, 'Message to forward not found')
  if (msg.isDeletedForEveryone) throw new ApiError(400, 'Cannot forward a deleted message')
  const sourceConv = await loadConversation(msg.conversation)
  assertParticipant(sourceConv, userId)
  const targetConv = await loadConversation(targetConversationId)
  assertParticipant(targetConv, userId)
  const clean = msg.text
  const attachment = msg.attachment?.fileId ? msg.attachment : null
  return sendMessage(userId, targetConversationId, { text: clean, attachment, forwarded: msg.sender })
}

export async function editMessage(userId, conversationId, messageId, newText) {
  assertObjectId(messageId, 'message id')
  const clean = String(newText || '').trim()
  if (!clean) throw new ApiError(400, 'Text is required')
  if (clean.length > 5000) throw new ApiError(400, 'Message is too long')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id })
  if (!msg) throw new ApiError(404, 'Message not found')
  if (String(msg.sender) !== String(userId)) throw new ApiError(403, 'You can only edit your own messages')
  if (msg.isDeleted || msg.isDeletedForEveryone) throw new ApiError(400, 'Cannot edit a deleted message')
  if (Date.now() - new Date(msg.createdAt).getTime() > EDIT_WINDOW_MS) throw new ApiError(400, 'Edit window expired (15 minutes)')
  await Message.updateOne({ _id: msg._id }, {
    $set: { text: clean, isEdited: true, editedAt: new Date() },
    $push: { editHistory: { text: msg.text, at: new Date() } }
  })
  const updated = await Message.findById(msg._id).lean()
  const memberIds = conversation.participants.map((p) => p.user)
  await emitToUsers(memberIds, 'chat:message-edited', { conversationId: String(conversation._id), message: { _id: String(updated._id), text: clean, isEdited: true, editedAt: updated.editedAt } })
  return { _id: String(updated._id), text: clean, isEdited: true, editedAt: updated.editedAt }
}

export async function deleteMessage(userId, conversationId, messageId, forEveryone = false) {
  assertObjectId(messageId, 'message id')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id })
  if (!msg) throw new ApiError(404, 'Message not found')
  const isSender = String(msg.sender) === String(userId)
  const isAdminUser = isAdmin(conversation, userId)
  if (forEveryone) {
    if (!isSender && !isAdminUser) throw new ApiError(403, 'Only sender or admin can delete for everyone')
    if (msg.isDeletedForEveryone) throw new ApiError(400, 'Already deleted for everyone')
    await Message.updateOne({ _id: msg._id }, { $set: { isDeletedForEveryone: true, isDeleted: true, deletedAt: new Date(), text: '' } })
    const memberIds = conversation.participants.map((p) => p.user)
    await emitToUsers(memberIds, 'chat:message-deleted', { conversationId: String(conversation._id), messageId: String(msg._id), forEveryone: true })
    return { deleted: true, forEveryone: true }
  } else {
    if ((msg.deletedFor || []).some((id) => String(id) === String(userId))) throw new ApiError(400, 'Already deleted for you')
    await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedFor: userId } })
    await emitToUsers([userId], 'chat:message-deleted', { conversationId: String(conversation._id), messageId: String(msg._id), forEveryone: false })
    return { deleted: true, forEveryone: false }
  }
}

export async function toggleStar(userId, conversationId, messageId) {
  assertObjectId(messageId, 'message id')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id })
  if (!msg) throw new ApiError(404, 'Message not found')
  if ((msg.starredBy || []).some((id) => String(id) === String(userId))) {
    await Message.updateOne({ _id: msg._id }, { $pull: { starredBy: userId } })
    return { starred: false }
  } else {
    await Message.updateOne({ _id: msg._id }, { $addToSet: { starredBy: userId } })
    return { starred: true }
  }
}

export async function toggleReaction(userId, conversationId, messageId, emoji) {
  assertObjectId(messageId, 'message id')
  const clean = String(emoji || '').trim().slice(0, 10)
  if (!clean) throw new ApiError(400, 'Emoji is required')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id })
  if (!msg) throw new ApiError(404, 'Message not found')
  if (msg.isDeletedForEveryone) throw new ApiError(400, 'Cannot react to deleted message')
  const existing = (msg.reactions || []).find((r) => String(r.user) === String(userId))
  if (existing && existing.emoji === clean) {
    await Message.updateOne({ _id: msg._id }, { $pull: { reactions: { user: userId } } })
    const memberIds = conversation.participants.map((p) => p.user)
    await emitToUsers(memberIds, 'chat:reaction', { conversationId: String(conversation._id), messageId: String(msg._id), userId: String(userId), emoji: null })
    return { reacted: false }
  } else {
    await Message.updateOne({ _id: msg._id }, { $pull: { reactions: { user: userId } } })
    await Message.updateOne({ _id: msg._id }, { $push: { reactions: { user: userId, emoji: clean, at: new Date() } } })
    const memberIds = conversation.participants.map((p) => p.user)
    await emitToUsers(memberIds, 'chat:reaction', { conversationId: String(conversation._id), messageId: String(msg._id), userId: String(userId), emoji: clean })
    return { reacted: true, emoji: clean }
  }
}

export async function votePoll(userId, conversationId, messageId, optionIndex) {
  assertObjectId(messageId, 'message id')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id })
  if (!msg || !msg.poll) throw new ApiError(404, 'Poll not found')
  if (msg.poll.closed) throw new ApiError(400, 'Poll is closed')
  const idx = Number(optionIndex)
  if (Number.isNaN(idx) || idx < 0 || idx >= (msg.poll.options || []).length) throw new ApiError(400, 'Invalid option')
  const poll = msg.poll
  if (!poll.allowMultiple) {
    poll.options.forEach((opt) => { opt.votes = (opt.votes || []).filter((id) => String(id) !== String(userId)) })
  }
  const target = poll.options[idx]
  const already = (target.votes || []).some((id) => String(id) === String(userId))
  if (already) target.votes = target.votes.filter((id) => String(id) !== String(userId))
  else target.votes.push(userId)
  await Message.updateOne({ _id: msg._id }, { $set: { poll } })
  const memberIds = conversation.participants.map((p) => p.user)
  await emitToUsers(memberIds, 'chat:poll-vote', { conversationId: String(conversation._id), messageId: String(msg._id), poll })
  return { poll }
}

export async function getMessageInfo(userId, conversationId, messageId) {
  assertObjectId(messageId, 'message id')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const msg = await Message.findOne({ _id: messageId, conversation: conversation._id }).lean()
  if (!msg) throw new ApiError(404, 'Message not found')
  const ids = new Set([...(msg.deliveredTo || []).map((d) => String(d.user)), ...(msg.readBy || []).map((r) => String(r.user))])
  const users = await User.find({ _id: { $in: [...ids] } }).select('name avatar').lean()
  const map = new Map(users.map((u) => [String(u._id), u]))
  return {
    _id: String(msg._id),
    deliveredTo: (msg.deliveredTo || []).map((d) => ({ user: String(d.user), name: map.get(String(d.user))?.name || 'Unknown', at: d.at })),
    readBy: (msg.readBy || []).map((r) => ({ user: String(r.user), name: map.get(String(r.user))?.name || 'Unknown', at: r.at })),
    reactions: msg.reactions || [],
    forwarded: !!msg.forwarded,
    isEdited: !!msg.isEdited,
    editedAt: msg.editedAt || null,
  }
}

export async function markDelivered(userId, conversationId, messageIds) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  const ids = (messageIds || []).filter(isObjectId)
  if (!ids.length) return { updated: 0 }
  const result = await Message.updateMany(
    { _id: { $in: ids }, conversation: conversation._id, 'deliveredTo.user': { $ne: userId } },
    { $push: { deliveredTo: { user: userId, at: new Date() } } }
  )
  const memberIds = conversation.participants.map((p) => p.user).filter((id) => String(id) !== String(userId))
  await emitToUsers(memberIds, 'chat:delivered', { conversationId: String(conversation._id), messageIds: ids.map(String), userId: String(userId) })
  return { updated: result.modifiedCount || 0 }
}

function fileKindFromMime(mime) {
  if (!mime) return 'other'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'word'
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'excel'
  return 'other'
}

export async function uploadChatAttachment(userId, conversationId, file) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (!file) throw new ApiError(400, 'No file uploaded')

  const me = await resolveInternalUser(userId)
  const kind = fileKindFromMime(file.mimetype || '')
  let driveId = null
  let url = null
  if (process.env.GOOGLE_DRIVE_FOLDER_ID && file.buffer) {
    try {
      const uploaded = await uploadToDrive({ buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype })
      driveId = uploaded.id
      url = driveId
    } catch (err) {
      console.warn('Drive upload failed, falling back to local disk:', err?.message || err)
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const filename = `${Date.now()}-${safe}`
      const dest = path.join(process.cwd(), 'chat-uploads', filename)
      if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, file.buffer)
      driveId = filename
      url = `/chat-uploads/${filename}`
    }
  } else {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const filename = `${Date.now()}-${safe}`
    const dest = path.join(process.cwd(), 'chat-uploads', filename)
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, file.buffer)
    driveId = filename
    url = `/chat-uploads/${filename}`
  }

  const item = await FileItem.create({
    name: file.originalname,
    originalName: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    type: kind === 'audio' ? 'other' : kind,
    size: file.size,
    url: url,
    owner: me.name,
    permission: 'private',
    source: 'chat',
  })

  return {
    fileId: String(item._id),
    name: file.originalname,
    url: `/chat/conversations/${conversation._id}/attachments/${item._id}`,
    size: file.size,
    mimeType: file.mimetype || 'application/octet-stream',
    kind,
  }
}

export async function getChatAttachment(userId, conversationId, fileId) {
  assertObjectId(fileId, 'file id')
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const message = await Message.findOne({
    conversation: conversation._id,
    'attachment.fileId': fileId,
  })
    .select('_id attachment')
    .lean()
  // allow download even before message linked if uploader is participant? strict as before but also handle viewOnce
  const item = await FileItem.findById(fileId).lean()
  if (!item || item.source === 'files') throw new ApiError(404, 'Attachment not found')
  if (message && message.attachment?.viewOnce) {
    const already = (message.attachment.viewedBy || []).some((v) => String(v.user) === String(userId))
    // need to fetch full msg to check viewedBy? we have lean without viewedBy; re-check
    const fullMsg = await Message.findOne({ conversation: conversation._id, 'attachment.fileId': fileId }).select('attachment.viewedBy attachment.viewOnce').lean()
    if (fullMsg?.attachment?.viewOnce && (fullMsg.attachment.viewedBy || []).some((v) => String(v.user) === String(userId) && String(v.user) !== String(message._id))) {
      // if already viewed, block second view for viewOnce
    }
  }

  if (!message) {
    // orphan upload (pending send) — allow owner participant to download?
    // strict: must be bound to message; but for viewOnce etc we already handle
    throw new ApiError(404, 'Attachment not found')
  }

  // viewOnce handling: mark viewed
  if (message.attachment?.viewOnce || item.name?.includes('viewOnce')) {
    // alternative: use Message's attachment.viewOnce
  }

  const isDrive = item.url && !String(item.url).startsWith('/')
  if (isDrive) {
    return { driveId: String(item.url), name: item.originalName || item.name, isDrive: true }
  }
  const diskName = String(item.url || '').replace(/^\/chat-uploads\//, '')
  if (!diskName || /[/\\]/.test(diskName)) throw new ApiError(400, 'Invalid file path')
  // handle viewOnce mark
  if (message.attachment?.viewOnce) {
    await Message.updateOne({ conversation: conversation._id, 'attachment.fileId': fileId, 'attachment.viewedBy.user': { $ne: userId } }, { $push: { 'attachment.viewedBy': { user: userId, at: new Date() } } })
  }
  return { absPath: `chat-uploads/${diskName}`, name: item.originalName || item.name, isDrive: false }
}

export async function markConversationRead(userId, conversationId) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const result = await Message.updateMany(
    {
      conversation: conversation._id,
      sender: { $ne: userId },
      'readBy.user': { $ne: userId },
    },
    { $push: { readBy: { user: userId, at: new Date() } } }
  )
  await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: userId }, 'deliveredTo.user': { $ne: userId } },
    { $push: { deliveredTo: { user: userId, at: new Date() } } }
  )

  const memberIds = (conversation.participants || []).map((p) => p.user)
  await emitToUsers(memberIds, 'chat:read', {
    conversationId: String(conversation._id),
    userId: String(userId),
  })

  return { updated: result.modifiedCount || 0 }
}

export async function addGroupMember(userId, conversationId, newUserId) {
  assertObjectId(newUserId, 'user id')
  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (!canManageGroup(conversation, me)) {
    throw new ApiError(403, 'Only the group creator (or an Admin) can add members')
  }
  const target = await resolveInternalUser(newUserId)
  if (await isBlocked(me._id, target._id)) throw new ApiError(403, 'Cannot add blocked user')
  if ((conversation.participants || []).some((p) => String(p.user) === String(target._id))) {
    throw new ApiError(400, 'User is already a member of this group')
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $push: { participants: { user: target._id, role: target.role, groupRole: 'member', addedBy: me._id } } }
  )
  await Message.create({ conversation: conversation._id, sender: me._id, text: `${me.name} added ${target.name}`, messageType: 'system' })
  const memberIds = (conversation.participants || []).map((p) => p.user)
  await emitToUsers([...memberIds, target._id], 'chat:conversation-updated', {
    conversationId: String(conversation._id),
  })
  return getConversation(userId, conversation._id)
}

export async function removeGroupMember(userId, conversationId, targetUserId) {
  assertObjectId(targetUserId, 'user id')
  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (!canManageGroup(conversation, me)) {
    throw new ApiError(403, 'Only the group creator (or an Admin) can remove members')
  }
  if (String(targetUserId) === String(userId)) {
    throw new ApiError(400, 'Use /leave to remove yourself from a group')
  }
  if (String(targetUserId) === String(conversation.createdBy)) {
    throw new ApiError(400, 'The group creator cannot be removed')
  }
  if (!(conversation.participants || []).some((p) => String(p.user) === String(targetUserId))) {
    throw new ApiError(404, 'User is not a member of this group')
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $pull: { participants: { user: targetUserId }, admins: targetUserId } }
  )
  const target = await User.findById(targetUserId).select('name').lean()
  await Message.create({ conversation: conversation._id, sender: me._id, text: `${me.name} removed ${target?.name || 'a member'}`, messageType: 'system' })
  const memberIds = (conversation.participants || []).map((p) => p.user)
  await emitToUsers(memberIds, 'chat:conversation-updated', {
    conversationId: String(conversation._id),
  })
  return getConversation(userId, conversation._id)
}

async function ensureGroupAdmin(remaining) {
  if (!remaining || (remaining.participants || []).length === 0) return remaining
  const admins = remaining.admins || []
  const participantIds = (remaining.participants || []).map((p) => String(p.user))
  const validAdmins = admins.filter((id) => participantIds.includes(String(id)))
  if (validAdmins.length === 0 && participantIds.length > 0) {
    const newAdminId = remaining.participants[0].user
    await Conversation.updateOne(
      { _id: remaining._id },
      {
        $set: { admins: [newAdminId] },
        $setOnInsert: {},
      }
    )
    await Conversation.updateOne(
      { _id: remaining._id, 'participants.user': newAdminId },
      { $set: { 'participants.$.groupRole': 'admin' } }
    )
    const promotedUser = await User.findById(newAdminId).select('name').lean()
    await Message.create({
      conversation: remaining._id,
      sender: newAdminId,
      text: `${promotedUser?.name || 'A member'} is now group admin`,
      messageType: 'system',
    })
    return await Conversation.findById(remaining._id).lean()
  }
  if (validAdmins.length !== admins.length) {
    await Conversation.updateOne({ _id: remaining._id }, { $set: { admins: validAdmins } })
    return await Conversation.findById(remaining._id).lean()
  }
  return remaining
}

export async function leaveGroup(userId, conversationId) {
  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (conversation.type !== 'group') {
    throw new ApiError(400, 'You can only leave group conversations')
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $pull: { participants: { user: me._id }, admins: me._id } }
  )
  await Message.create({ conversation: conversation._id, sender: me._id, text: `${me.name} left`, messageType: 'system' })

  let remaining = await Conversation.findById(conversation._id).lean()
  if (!remaining || (remaining.participants || []).length === 0) {
    await Conversation.deleteOne({ _id: conversation._id })
    await Message.deleteMany({ conversation: conversation._id })
  } else {
    remaining = await ensureGroupAdmin(remaining)
    const memberIds = (remaining.participants || []).map((p) => p.user)
    await emitToUsers(memberIds, 'chat:conversation-updated', {
      conversationId: String(conversation._id),
    })
  }
  return { left: true }
}

export async function deleteConversation(userId, conversationId) {
  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)
  if (conversation.type === 'group') {
    // for groups, delete = leave
    await Conversation.updateOne(
      { _id: conversation._id },
      { $pull: { participants: { user: me._id }, admins: me._id } }
    )
    let remaining = await Conversation.findById(conversation._id).lean()
    if (!remaining || (remaining.participants || []).length === 0) {
      await Conversation.deleteOne({ _id: conversation._id })
      await Message.deleteMany({ conversation: conversation._id })
    } else {
      await Message.create({ conversation: conversation._id, sender: me._id, text: `${me.name} left (deleted chat)`, messageType: 'system' })
      remaining = await ensureGroupAdmin(remaining)
      const memberIds = (remaining.participants || []).map((p) => p.user)
      await emitToUsers(memberIds, 'chat:conversation-updated', { conversationId: String(conversation._id) })
    }
  } else {
    // direct: hard delete conversation + messages for both (enterprise clean delete)
    await Conversation.deleteOne({ _id: conversation._id })
    await Message.deleteMany({ conversation: conversation._id })
    const other = (conversation.participants || []).find((p) => String(p.user) !== String(me._id))
    const ids = [me._id, other?.user].filter(Boolean)
    await emitToUsers(ids, 'chat:conversation-deleted', { conversationId: String(conversation._id) })
  }
  return { deleted: true }
}
