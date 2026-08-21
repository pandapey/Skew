import mongoose from 'mongoose'

const { Schema, model, Types } = mongoose
const opts = { timestamps: true }

// A single stored version of a file (for version history / restore).
const versionSchema = new Schema({
  version: { type: Number, default: 1 },
  filename: String, // stored filename on disk
  size: Number,
  by: String, // uploader name
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true })

// A user a file is shared with, and what they may do.
const shareSchema = new Schema({
  user: { type: String, required: true },
  permission: { type: String, enum: ['view', 'edit'], default: 'view' },
}, { _id: false })

// Folder tree node. `parent` is null for root-level folders.
const folderSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  parent: { type: Types.ObjectId, ref: 'Folder', default: null, index: true },
  owner: { type: String, default: 'System' },
  isTrashed: { type: Boolean, default: false },
  trashedAt: Date,
}, opts)
folderSchema.index({ parent: 1, name: 1 })

// File metadata (the binary lives on disk under /uploads).
const fileSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  originalName: String,
  mimeType: String,
  type: { type: String, enum: ['image', 'video', 'pdf', 'excel', 'word', 'other'], default: 'other', index: true },
  size: { type: Number, default: 0 },
  url: String, // /uploads/<filename>
  // PHASE: EMPLOYEE CHAT ATTACHMENT PRIVACY — every record belongs to exactly
  // one surface. `files` is a normal company File (shown in the Files module);
  // `chat` is a private chat attachment (bytes in chat-uploads/, served only
  // through the participant-checked chat route and NEVER through the general
  // Files listing). The Files module queries exclude `source: 'chat'`, so a
  // document sent through Chat can never leak into My Files / Company Files /
  // Shared Files / search / storage counts. Legacy documents created before
  // this field existed have no value — the Files queries filter with
  // `source: { $ne: 'chat' }` so they keep appearing exactly as before.
  source: { type: String, enum: ['files', 'chat'], default: 'files', index: true },
  folder: { type: Types.ObjectId, ref: 'Folder', default: null, index: true },
  owner: { type: String, default: 'System' },
  versions: { type: [versionSchema], default: [] },
  sharedWith: { type: [shareSchema], default: [] },
  permission: { type: String, enum: ['private', 'team', 'public'], default: 'private' },
  starred: { type: Boolean, default: false },
  tags: { type: [String], default: [] },
  isTrashed: { type: Boolean, default: false },
  trashedAt: Date,
}, opts)
fileSchema.index({ folder: 1, name: 1 })
fileSchema.index({ name: 'text', tags: 'text' })

export const Folder = model('Folder', folderSchema)
export const FileItem = model('FileItem', fileSchema)
