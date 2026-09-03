import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, default: 'Employee' },
    groupRole: { type: String, enum: ['member', 'admin'], default: 'member' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: Date.now },
    isMuted: { type: Boolean, default: false },
    mutedUntil: { type: Date, default: null },
    isPinned: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    lastClearedAt: { type: Date, default: null },
  },
  { _id: false }
)

const lastMessageSchema = new Schema(
  {
    text: { type: String, default: '' },
    sender: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    senderName: { type: String, default: '' },
    at: { type: Date, default: null },
    hasAttachment: { type: Boolean, default: false },
  },
  { _id: false }
)

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true, index: true },
    name: { type: String, default: null, trim: true },
    description: { type: String, default: null, trim: true },
    icon: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    participants: { type: [participantSchema], default: [] },
    admins: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    lastMessage: { type: lastMessageSchema, default: () => ({}) },
    inviteCode: { type: String, default: null, index: true },
    inviteEnabled: { type: Boolean, default: true },
    settings: {
      onlyAdminsCanSend: { type: Boolean, default: false },
      disappearingEnabled: { type: Boolean, default: false },
      disappearingDuration: { type: Number, default: 0 },
    },
  },
  opts
)
conversationSchema.index({ 'participants.user': 1, updatedAt: -1 })
conversationSchema.index({ inviteCode: 1 }, { sparse: true })

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, default: '', trim: true },
    messageType: { type: String, enum: ['text','image','video','audio','document','location','contact','poll','system','audio_note'], default: 'text' },
    attachment: {
      fileId: { type: Schema.Types.ObjectId, ref: 'FileItem', default: null },
      name: { type: String, default: null },
      url: { type: String, default: null },
      size: { type: Number, default: 0 },
      mimeType: { type: String, default: null },
      kind: { type: String, default: 'file' },
      viewOnce: { type: Boolean, default: false },
      viewedBy: { type: [{ user: Schema.Types.ObjectId, at: Date }], default: [] },
    },
    replyTo: {
      messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
      text: { type: String, default: null },
      senderName: { type: String, default: null },
      hasAttachment: { type: Boolean, default: false },
    },
    forwarded: { type: Boolean, default: false },
    forwardedFrom: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    editHistory: { type: [{ text: String, at: Date }], default: [] },
    isDeleted: { type: Boolean, default: false },
    isDeletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedFor: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    starredBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    reactions: { type: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, emoji: String, at: { type: Date, default: Date.now } }], default: [] },
    deliveredTo: { type: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date }], default: [] },
    readBy: { type: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date }], default: [] },
    expiresAt: { type: Date, default: null, index: true },
    location: {
      latitude: Number,
      longitude: Number,
      address: String,
    },
    contactCard: {
      name: String,
      phone: String,
      email: String,
    },
    poll: {
      question: String,
      options: [{ text: String, votes: [{ type: Schema.Types.ObjectId, ref: 'User' }] }],
      allowMultiple: { type: Boolean, default: false },
      closed: { type: Boolean, default: false },
    },
  },
  opts
)
messageSchema.index({ conversation: 1, createdAt: -1 })
messageSchema.index({ text: 'text' })
messageSchema.index({ conversation: 1, 'starredBy': 1 })
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Conversation = model('Conversation', conversationSchema)
export const Message = model('Message', messageSchema)

const chatBlockSchema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    blocked: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
)
chatBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true })
export const ChatBlock = model('ChatBlock', chatBlockSchema)

const userPresenceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    socketCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)
export const UserPresence = model('UserPresence', userPresenceSchema)
