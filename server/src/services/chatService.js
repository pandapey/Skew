import { ApiError } from '../utils/asyncHandler.js'
import { User } from '../models/User.js'
import { Conversation, Message } from '../models/chatModels.js'
import { FileItem } from '../models/fileModels.js'
import { notifyUsersByEmail } from './notificationService.js'
import { emitToUsers } from '../realtime/index.js'
import { uploadToDrive } from '../utils/driveUpload.js'
import fs from 'fs'
import path from 'path'

const CHAT_ROLES = ['Admin', 'Manager', 'Employee']
const MESSAGE_PREVIEW_LENGTH = 80
const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 200

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
  if (user.role === 'Admin') return true
  return false
}

async function unreadCount(conversationId, userId) {
  return Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId },
    'readBy.user': { $ne: userId },
  })
}

function otherParticipant(conversation, userId, participantsById) {
  const target = (conversation.participants || []).find((p) => String(p.user) !== String(userId))
  return target ? (participantsById.get(String(target.user)) || null) : null
}

function buildConversationView(conversation, me, participantsById, unread) {
  const isGroup = conversation.type === 'group'
  const members = (conversation.participants || [])
    .map((p) => participantsById.get(String(p.user)))
    .filter(Boolean)
  const other = otherParticipant(conversation, me, participantsById)
  return {
    _id: String(conversation._id),
    type: conversation.type,
    name: isGroup ? conversation.name : (other?.name || 'Unknown user'),
    other,
    isGroup,
    memberCount: members.length,
    participants: members,
    createdBy: conversation.createdBy ? String(conversation.createdBy) : null,
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
  const conversations = await Conversation.find({ 'participants.user': userId })
    .sort({ updatedAt: -1 })
    .lean()

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
  })
  return { count }
}

export async function getOrCreateDirectConversation(userId, otherUserId) {
  assertObjectId(otherUserId, 'user id')
  const me = await resolveInternalUser(userId)
  const other = await resolveInternalUser(otherUserId)
  if (String(me._id) === String(other._id)) {
    throw new ApiError(400, 'You cannot start a conversation with yourself')
  }

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
      { user: me._id, role: me.role },
      { user: other._id, role: other.role },
    ],
  })
  await emitToUsers([me._id, other._id], 'chat:conversation', { conversationId: String(conversation._id) })
  return getConversation(userId, conversation._id)
}

export async function createGroup(userId, { name, memberIds = [] }) {
  const me = await resolveInternalUser(userId)
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new ApiError(400, 'Group name is required')
  if (cleanName.length > 60) throw new ApiError(400, 'Group name is too long')

  const requested = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(String))]
  const members = []
  for (const id of requested) {
    if (String(id) === String(me._id)) continue
    members.push(await resolveInternalUser(id))
  }

  const conversation = await Conversation.create({
    type: 'group',
    name: cleanName,
    createdBy: me._id,
    participants: [
      { user: me._id, role: me.role, addedBy: me._id },
      ...members.map((m) => ({ user: m._id, role: m.role, addedBy: me._id })),
    ],
  })
  const ids = [me._id, ...members.map((m) => m._id)]
  await emitToUsers(ids, 'chat:conversation', { conversationId: String(conversation._id) })
  return getConversation(userId, conversation._id)
}

export async function listMessages(userId, conversationId, { before, limit } = {}) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const query = { conversation: conversation._id }
  if (before) {
    assertObjectId(before, 'before id')
    query._id = { $lt: before }
  }
  const size = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT)
  const messages = await Message.find(query)
    .sort({ _id: -1 })
    .limit(size)
    .lean()

  const senderIds = new Set(messages.map((m) => String(m.sender)))
  const senders = await User.find({ _id: { $in: [...senderIds] } })
    .select('name email role avatar')
    .lean()
  const senderById = new Map(senders.map((u) => [String(u._id), u]))

  return messages.reverse().map((m) => ({
    _id: String(m._id),
    conversationId: String(m.conversation),
    sender: String(m.sender),
    senderName: senderById.get(String(m.sender))?.name || 'Unknown',
    senderAvatar: senderById.get(String(m.sender))?.avatar || '',
    text: m.text,
    attachment: m.attachment || null,
    readBy: (m.readBy || []).map((r) => String(r.user)),
    createdAt: m.createdAt,
  }))
}

export async function sendMessage(userId, conversationId, { text, attachment } = {}) {
  const clean = String(text || '').trim()
  const hasAttachment = Boolean(attachment && attachment.fileId)
  if (!clean && !hasAttachment) {
    throw new ApiError(400, 'Message text or an attachment is required')
  }
  if (clean.length > 5000) throw new ApiError(400, 'Message is too long')

  const me = await resolveInternalUser(userId)
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const message = await Message.create({
    conversation: conversation._id,
    sender: me._id,
    text: clean,
    ...(hasAttachment ? { attachment } : {}),
  })

  const preview = clean
    || (hasAttachment ? `📎 ${attachment.name || 'Attachment'}` : '')
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
          hasAttachment: hasAttachment,
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
      attachment: hasAttachment ? attachment : null,
      readBy: [],
      createdAt: message.createdAt,
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
    await notifyUsersByEmail(
      recipients.map((r) => r.email),
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

  return payload.message
}

function fileKindFromMime(mime) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
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
    const uploaded = await uploadToDrive({ buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype })
    driveId = uploaded.id
    url = driveId
  } else {
    // fallback local disk (when Drive not configured)
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
    type: kind,
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
    .select('_id')
    .lean()
  if (!message) throw new ApiError(404, 'Attachment not found')

  const item = await FileItem.findById(fileId).lean()
  if (!item || item.source === 'files') throw new ApiError(404, 'Attachment not found')

  const isDrive = item.url && !String(item.url).startsWith('/')
  if (isDrive) {
    return { driveId: String(item.url), name: item.originalName || item.name, isDrive: true }
  }
  const diskName = String(item.url || '').replace(/^\/chat-uploads\//, '')
  if (!diskName || /[/\\]/.test(diskName)) throw new ApiError(400, 'Invalid file path')
  return { absPath: `chat-uploads/${diskName}`, name: item.originalName || item.name, isDrive: false }
}

export async function markConversationRead(userId, conversationId) {
  const conversation = await loadConversation(conversationId)
  assertParticipant(conversation, userId)

  const result = await Message.updateMany(
    {
      conversation: conversation._id,
      sender: { $ne: userId },
      readBy: { $ne: userId },
    },
    { $push: { readBy: { user: userId, at: new Date() } } }
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
  if ((conversation.participants || []).some((p) => String(p.user) === String(target._id))) {
    throw new ApiError(400, 'User is already a member of this group')
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    { $push: { participants: { user: target._id, role: target.role, addedBy: me._id } } }
  )
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
    { $pull: { participants: { user: targetUserId } } }
  )
  const memberIds = (conversation.participants || []).map((p) => p.user)
  await emitToUsers(memberIds, 'chat:conversation-updated', {
    conversationId: String(conversation._id),
  })
  return getConversation(userId, conversation._id)
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
    { $pull: { participants: { user: me._id } } }
  )

  const remaining = await Conversation.findById(conversation._id).lean()
  if (!remaining || (remaining.participants || []).length === 0) {
    await Conversation.deleteOne({ _id: conversation._id })
  } else {
    const memberIds = (remaining.participants || []).map((p) => p.user)
    await emitToUsers(memberIds, 'chat:conversation-updated', {
      conversationId: String(conversation._id),
    })
  }
  return { left: true }
}
