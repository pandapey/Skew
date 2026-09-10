import mongoose from 'mongoose'

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    type: { type: String, enum: ['image', 'video', 'file'], default: 'file' },
    // MongoDB Atlas (GridFS) — `fileId` holds the GridFS _id, `url` holds the
    // API download path. Legacy `/uploads/...` may exist on old docs.
    url: { type: String, default: '' },
    fileId: { type: String, default: null },
    contentType: { type: String, default: '' },
    storage: { type: String, enum: ['gridfs', 'legacy'], default: 'gridfs' },
    size: { type: Number, default: 0 },
  },
  { _id: true }
)

const commentSchema = new mongoose.Schema(
  {
    author: { type: String, default: 'Anonymous' },
    body: { type: String, required: true },
    date: { type: String, default: () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) },
  },
  { _id: true }
)

const postSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['news', 'announcement', 'event', 'birthday'],
      default: 'announcement',
      index: true,
    },
    title: { type: String, required: [true, 'Title is required'], trim: true },
    body: { type: String, default: '', trim: true },
    excerpt: { type: String, default: '' },
    author: { type: String, default: 'System' },
    authorRole: { type: String, default: '' },
    date: { type: String, default: () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) },
    pinned: { type: Boolean, default: false, index: true },
    likes: { type: Number, default: 0 },
    likedBy: { type: [String], default: [], index: true },
    readBy: { type: [String], default: [], index: true },
    tags: { type: [String], default: [] },
    location: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
)

postSchema.index({ type: 1, date: -1 })

postSchema.set('toJSON', { virtuals: true })

export const Post = mongoose.model('Post', postSchema)
