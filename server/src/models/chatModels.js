// Chat models — internal staff messaging (Admin / HR / Manager / Employee).
//
// DESIGN (no passwords, no sensitive auth data — only conversation metadata):
//   Conversation  -> one document per direct or group conversation.
//   Message       -> one document per message, with per-user read receipts.
//
// PRIVACY-BY-CONSTRUCTION:
//   * participants[] is the ONLY access key — every service read first verifies
//     the caller's ObjectId is a participant, so a user can never reach another
//     user's private conversation by guessing an id.
//   * Clients are structurally excluded: chatService only ever creates
//     conversations for users whose role is in the internal staff set.
//   * No password / token / auth fields are stored here (or anywhere in chat).
import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// One member entry per participant. `role` is a snapshot at join time so the
// UI can show context even if the user is later re-rolled; authorization never
// relies on it (it always re-reads the live User document via the service).
const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, default: 'Employee' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const lastMessageSchema = new Schema(
  {
    text: { type: String, default: '' },
    sender: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    senderName: { type: String, default: '' },
    at: { type: Date, default: null },
    // True when the last message carries an attachment (so the conversation
    // list can render a paperclip/badge without reading the message itself).
    hasAttachment: { type: Boolean, default: false },
  },
  { _id: false }
)

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true, index: true },
    // Group display name; for direct conversations this stays null (the client
    // derives the display name from the other participant).
    name: { type: String, default: null, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    participants: { type: [participantSchema], default: [] },
    lastMessage: { type: lastMessageSchema, default: () => ({}) },
  },
  opts
)
conversationSchema.index({ 'participants.user': 1, updatedAt: -1 })

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // `text` is optional only when an attachment is present; the service
    // enforces "text OR attachment".
    text: { type: String, default: '', trim: true },
    // Attachment metadata — the bytes live on disk under /chat-uploads (never
    // the public /uploads dir) and are served only through the authenticated
    // GET /conversations/:id/attachments/:fileId route.
    attachment: {
      fileId: { type: Schema.Types.ObjectId, ref: 'FileItem', default: null },
      name: { type: String, default: null },
      url: { type: String, default: null },
      size: { type: Number, default: 0 },
      mimeType: { type: String, default: null },
      kind: { type: String, default: 'file' }, // image | video | audio | pdf | excel | word | other
    },
    // Read receipts — one entry per reader, so unread = "sender is someone else
    // and my id is not in readBy".
    readBy: { type: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date }], default: [] },
  },
  opts
)
messageSchema.index({ conversation: 1, createdAt: -1 })

export const Conversation = model('Conversation', conversationSchema)
export const Message = model('Message', messageSchema)
