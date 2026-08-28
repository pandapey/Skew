// Announcements controller — CRUD over Post plus like toggle, comment and
// media upload. List supports search / type / pinned / sort.
import { Post } from '../models/announcementModels.js'
import { crudController } from './crudController.js'
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'

const base = crudController(Post)

// PHASE ADMIN (TASK 2): the caller's id, as a string, for per-user like state.
const viewerId = (req) => String(req.user?._id || req.user?.id || '')

// PHASE ADMIN (TASK 2): project a stored post into the shape the feed expects.
//
// `liked` is NOT a stored column any more (see announcementModels.js) - it is
// derived here, per request, from `likedBy` for the CALLING user. That is what
// makes a like survive a page refresh while still being correct per user: the
// document holds the full set of likers, and each viewer is told only whether
// THEY are in it. `likedBy` itself is stripped from the response so the feed
// never leaks the list of who liked what.
// `read` follows the same pattern from `readBy`: derived per request, stripped
// from the response, so the unread state survives refresh while staying
// private and per-user.
const withViewerState = (doc, req) => {
  const json = typeof doc?.toJSON === 'function' ? doc.toJSON() : { ...doc }
  const uid = viewerId(req)
  const likedBy = Array.isArray(json.likedBy) ? json.likedBy : []
  const readBy = Array.isArray(json.readBy) ? json.readBy : []
  delete json.likedBy
  delete json.readBy
  return { ...json, liked: Boolean(uid) && likedBy.includes(uid), read: Boolean(uid) && readBy.includes(uid) }
}

export const announcementController = {
  ...base,

  // PHASE ADMIN (TASK 2): `get` is overridden so a single post is projected
  // through the same viewer-state mapper as the list. Without this the detail
  // response would carry a raw `likedBy` array and no `liked` flag, i.e. the
  // two endpoints would disagree about the same post.
  get: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    res.json(withViewerState(doc, req))
  },

  list: async (req, res) => {
    const { search, type, pinned, sort = 'recent', page = 1, limit = 100 } = req.query
    const filter = {}
    if (search) filter.title = { $regex: escapeRegex(search), $options: 'i' }
    if (type && type !== 'all') filter.type = type
    if (pinned) filter.pinned = pinned === 'true' || pinned === true
    const sortOpt = sort === 'likes' ? { likes: -1 } : { date: -1 }
    const safeLimit = clampLimit(limit, 100)
    const docs = await Post.find(filter)
      .sort(sortOpt)
      .skip((clampPage(page) - 1) * safeLimit)
      .limit(safeLimit)
    // PHASE ADMIN (TASK 2): every post is projected for the calling user so the
    // heart renders correctly on first paint and after any refresh.
    res.json(docs.map((d) => withViewerState(d, req)))
  },

  // Toggle the requesting user's like.
  //
  // PHASE ADMIN (TASK 2) ROOT CAUSE FIX. This previously did:
  //     doc.liked = !doc.liked
  //     doc.likes = Math.max(0, doc.likes + (doc.liked ? 1 : -1))
  // which flipped ONE GLOBAL boolean shared by every user, so a like by one
  // person showed as liked for everybody and a second person's click silently
  // UNDID the first person's like.
  //
  // Now the caller's id is added to / removed from `likedBy`, which is the
  // actual persistence for the toggle. `likes` is kept as the stored counter
  // and moved in step with the membership change (rather than being reset to
  // `likedBy.length`) so historical seeded counts are preserved instead of
  // being wiped to zero the first time somebody clicks.
  like: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const likedBy = Array.isArray(doc.likedBy) ? doc.likedBy : []
    const already = likedBy.includes(uid)
    doc.likedBy = already ? likedBy.filter((x) => x !== uid) : [...likedBy, uid]
    doc.likes = Math.max(0, (doc.likes || 0) + (already ? -1 : 1))
    await doc.save()
    res.json(withViewerState(doc, req))
  },

  // PHASE: EMPLOYEE ANNOUNCEMENT READ STATE — idempotently mark the post as
  // read FOR THE CALLING USER ONLY (their id is added to `readBy`). A caller
  // can never touch anyone else's read state, and re-reading never changes the
  // stored count.
  markRead: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const readBy = Array.isArray(doc.readBy) ? doc.readBy : []
    if (!readBy.includes(uid)) {
      doc.readBy = [...readBy, uid]
      await doc.save()
    }
    res.json(withViewerState(doc, req))
  },

  // PHASE: EMPLOYEE ANNOUNCEMENT READ STATE — count of posts the CALLING USER
  // has not read yet, computed server-side from `readBy` (never from a client-
  // supplied number). The same `readBy: { $ne: uid }` rule drives the nav badge.
  unreadCount: async (req, res) => {
    const uid = viewerId(req)
    if (!uid) return res.status(401).json({ message: 'Not authorized' })
    const count = await Post.countDocuments({ readBy: { $ne: uid } })
    res.json({ count })
  },

  // Append a comment.
  //
  // PHASE ADMIN (TASK 2): the author is now taken from the AUTHENTICATED
  // SESSION instead of the request body. The client used to send a hardcoded
  // default of 'You' (see announcementApi.comment), so every stored comment was
  // literally attributed to "You" for all users forever. Deriving it server-side
  // also means a caller can no longer post a comment under someone else's name.
  // A client-supplied `author` is deliberately ignored.
  comment: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    const { body } = req.body
    if (!body || !body.trim()) return res.status(400).json({ message: 'Comment body is required' })
    doc.comments.push({
      author: req.user?.name || 'Anonymous',
      body: body.trim(),
      date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),
    })
    await doc.save()
    res.status(201).json(withViewerState(doc, req))
  },

  // Upload a media file (multer) and attach it to the post.
  uploadMedia: async (req, res) => {
    const doc = await Post.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'Post not found' })
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    const type = req.file.mimetype.startsWith('image/')
      ? 'image'
      : req.file.mimetype.startsWith('video/')
        ? 'video'
        : 'file'
    doc.attachments.push({
      name: req.file.originalname,
      type,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
    })
    await doc.save()
    res.status(201).json(withViewerState(doc, req))
  },
}
