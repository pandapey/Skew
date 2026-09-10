import mongoose from 'mongoose'

const { Schema, model, Types } = mongoose
const opts = { timestamps: true }

const versionSchema = new Schema({
  version: { type: Number, default: 1 },
  // GridFS file _id (24-hex string). Legacy: Drive fileId or local disk filename.
  filename: String,
  fileId: { type: String, default: null, index: true },
  contentType: String,
  size: Number,
  by: String,
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true })

const shareSchema = new Schema({
  user: { type: String, required: true },
  permission: { type: String, enum: ['view', 'edit'], default: 'view' },
}, { _id: false })

const folderSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  parent: { type: Types.ObjectId, ref: 'Folder', default: null, index: true },
  owner: { type: String, default: 'System' },
  isTrashed: { type: Boolean, default: false },
  trashedAt: Date,
}, opts)
folderSchema.index({ parent: 1, name: 1 })

const fileSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  originalName: String,
  mimeType: String,
  // MongoDB Atlas (GridFS) storage — bytes only. `url` holds the GridFS file _id
  // for new files. Legacy Drive IDs / `/uploads/...` paths may still exist on old docs.
  url: { type: String, default: '' },
  fileId: { type: String, default: null, index: true },
  contentType: String,
  storage: { type: String, enum: ['gridfs', 'legacy'], default: 'gridfs' },
  type: { type: String, enum: ['image', 'video', 'pdf', 'excel', 'word', 'other'], default: 'other', index: true },
  size: { type: Number, default: 0 },
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
