import mongoose from 'mongoose'

// Attachment sub-document (images / videos / files).
const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    type: { type: String, enum: ['image', 'video', 'file'], default: 'file' },
    url: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: true }
)

// Nested comment.
const commentSchema = new mongoose.Schema(
  {
    author: { type: String, default: 'Anonymous' },
    body: { type: String, required: true },
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
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
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    pinned: { type: Boolean, default: false, index: true },
    likes: { type: Number, default: 0 },
    // PHASE ADMIN (TASK 2) ROOT CAUSE #2 - per-user likes.
    //
    // This field used to be `liked: { type: Boolean, default: false }`: ONE
    // GLOBAL boolean stored on the post itself. That is not a per-user like at
    // all - whoever clicked Like flipped the flag for EVERY user in the
    // workspace, and the heart rendered as "liked" for people who had never
    // touched the post. Toggling was therefore also unstable: two users each
    // clicking Like once would add one like and then immediately remove it.
    //
    // Replaced with the set of user ids that liked the post, which is the only
    // way a like can be both persistent and per-user. `liked` is no longer
    // stored - it is DERIVED per request from this array for the calling user
    // (see announcementController.withViewerState), so a page refresh returns
    // the correct state for whoever is logged in.
    //
    // Stored as String ids (not ObjectId refs) to match how the rest of this
    // schema stores identity (`author`, `createdBy`) and so an orphaned id can
    // never break a populate.
    likedBy: { type: [String], default: [], index: true },
    tags: { type: [String], default: [] },
    location: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
)

postSchema.index({ type: 1, date: -1 })

// PHASE ADMIN (TASK 2) ROOT CAUSE #1 - the missing `id` field.
//
// The entire announcements UI keys off `post.id` (`key={p.id}`,
// `onLike(post.id)`, `onComment(post.id, ...)`, `announcementApi.update(id)`,
// `uploadMedia(saved.id)`) and the nested renderers use `c.id` / `a.id` for
// comments and attachments. But Mongoose only exposes `id` as a VIRTUAL, and
// `res.json(doc)` serialises through toJSON, which by default EXCLUDES virtuals
// - so every announcement was reaching the browser with `_id` and no `id`.
// (userController.js and clientController.js both carry comments documenting
// this same trap for lean() queries.)
//
// Net effect: `post.id` was `undefined`, so Like fired
// `PATCH /announcements/undefined/like` and Comment fired
// `POST /announcements/undefined/comments`, which Mongo rejects with a CastError
// - the buttons could never work. THIS is why the controls were "not actually
// useful", and no amount of frontend work would have fixed it.
//
// Enabling virtuals on toJSON adds `id` to the post AND to the comment /
// attachment subdocuments (both are declared `{ _id: true }`), fixing all three
// in one place. `_id` is still emitted as well, so any existing consumer that
// reads `_id` keeps working - this is additive, not a rename.
postSchema.set('toJSON', { virtuals: true })

export const Post = mongoose.model('Post', postSchema)
