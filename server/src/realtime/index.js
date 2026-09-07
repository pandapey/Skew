import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { corsOptions } from '../config/cors.js'

let io = null
const presenceMap = new Map()
const typingMap = new Map()

async function setUserOnline(userId, isOnline) {
  try {
    const { UserPresence } = await import('../models/chatModels.js')
    if (isOnline) {
      await UserPresence.findOneAndUpdate(
        { user: userId },
        { $inc: { socketCount: 1 }, $set: { isOnline: true, lastSeen: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    } else {
      await UserPresence.findOneAndUpdate(
        { user: userId },
        { $inc: { socketCount: -1 }, $set: { lastSeen: new Date() } },
        { upsert: true, new: true }
      )
      const doc = await (await import('../models/chatModels.js')).UserPresence.findOne({ user: userId }).lean()
      if (doc && doc.socketCount <= 0) {
        await (await import('../models/chatModels.js')).UserPresence.updateOne({ user: userId }, { $set: { isOnline: false, socketCount: 0 } })
      }
      const fresh = await (await import('../models/chatModels.js')).UserPresence.findOne({ user: userId }).lean()
      isOnline = !!fresh?.isOnline && (fresh.socketCount || 0) > 0
      if (!isOnline) {
        // ensure offline
      } else {
        // still online due to other sockets, don't emit offline
        presenceMap.set(String(userId), { isOnline: true, lastSeen: new Date(), count: fresh.socketCount })
        if (io) io.to('global').emit('presence:update', { userId: String(userId), isOnline: true, lastSeen: new Date() })
        return
      }
    }
  } catch {}
  // update in-memory map
  try {
    const { UserPresence } = await import('../models/chatModels.js')
    const fresh = await UserPresence.findOne({ user: userId }).lean()
    const count = fresh?.socketCount || 0
    const online = !!fresh?.isOnline && count > 0
    presenceMap.set(String(userId), { isOnline: online, lastSeen: fresh?.lastSeen || new Date(), count })
    if (io) io.to('global').emit('presence:update', { userId: String(userId), isOnline: online, lastSeen: fresh?.lastSeen || new Date() })
  } catch {
    presenceMap.set(String(userId), { isOnline, lastSeen: new Date(), count: isOnline ? 1 : 0 })
    if (io) io.to('global').emit('presence:update', { userId: String(userId), isOnline, lastSeen: new Date() })
  }
}

async function syncPresenceFromDB(userId) {
  try {
    const { UserPresence } = await import('../models/chatModels.js')
    const doc = await UserPresence.findOne({ user: userId }).lean()
    if (doc) presenceMap.set(String(userId), { isOnline: !!doc.isOnline && (doc.socketCount||0)>0, lastSeen: doc.lastSeen, count: doc.socketCount||0 })
  } catch {}
}

async function handleTyping(socket, data) {
  try {
    const { user } = socket.data || {}
    if (!user) return
    const { conversationId, isTyping } = data || {}
    if (!conversationId) return
    const { Conversation } = await import('../models/chatModels.js')
    const conv = await Conversation.findById(conversationId).select('participants').lean()
    if (!conv) return
    const memberIds = (conv.participants || []).map((p) => String(p.user)).filter((id) => id !== String(user._id))
    for (const id of memberIds) {
      io.to(`user:${id}`).emit(isTyping ? 'chat:typing' : 'chat:stop-typing', {
        conversationId: String(conversationId),
        userId: String(user._id),
        userName: user.name,
      })
    }
    if (isTyping) {
      const key = `${conversationId}:${user._id}`
      if (typingMap.has(key)) clearTimeout(typingMap.get(key))
      const t = setTimeout(() => {
        typingMap.delete(key)
        for (const id of memberIds) {
          io.to(`user:${id}`).emit('chat:stop-typing', {
            conversationId: String(conversationId),
            userId: String(user._id),
            userName: user.name,
          })
        }
      }, 3000)
      typingMap.set(key, t)
    } else {
      const key = `${conversationId}:${user._id}`
      if (typingMap.has(key)) { clearTimeout(typingMap.get(key)); typingMap.delete(key) }
    }
  } catch {}
}

export function initRealtime(server) {
  io = new Server(server, {
    cors: corsOptions,
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error('auth required'))
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id).lean()
      if (!user) return next(new Error('invalid user'))
      socket.data.user = user
      next()
    } catch {
      next(new Error('auth failed'))
    }
  })

  io.on('connection', async (socket) => {
    const { user } = socket.data
    if (!user) return socket.disconnect(true)
    if (user.role === 'Client') {
      socket.join(`client:${user.clientId}`)
    } else {
      socket.join('global')
      socket.join(`user:${user._id}`)
      const uid = String(user._id)
      const before = presenceMap.get(uid)?.count || 0
      await setUserOnline(user._id, true)
      const after = presenceMap.get(uid)
      if (before === 0 && after?.isOnline) {
        socket.broadcast.to('global').emit('user:online', { userId: uid })
      }
      socket.emit('presence:sync', Array.from(presenceMap.entries()).map(([id, v]) => ({ userId: id, isOnline: v.isOnline, lastSeen: v.lastSeen })))
    }

    socket.on('chat:typing', (data) => handleTyping(socket, { ...data, isTyping: true }))
    socket.on('chat:stop-typing', (data) => handleTyping(socket, { ...data, isTyping: false }))

    socket.on('chat:mark-delivered', async (data) => {
      try {
        const { conversationId, messageIds } = data || {}
        if (!conversationId || !Array.isArray(messageIds)) return
        const { Message, Conversation } = await import('../models/chatModels.js')
        const conv = await Conversation.findById(conversationId).select('participants').lean()
        if (!conv) return
        if (!conv.participants.some((p) => String(p.user) === String(user._id))) return
        await Message.updateMany(
          { _id: { $in: messageIds }, conversation: conversationId, 'deliveredTo.user': { $ne: user._id } },
          { $push: { deliveredTo: { user: user._id, at: new Date() } } }
        )
        const memberIds = conv.participants.map((p) => String(p.user)).filter((id) => id !== String(user._id))
        for (const id of memberIds) {
          io.to(`user:${id}`).emit('chat:delivered', { conversationId: String(conversationId), messageIds, userId: String(user._id) })
        }
      } catch {}
    })

    socket.on('disconnect', async () => {
      try {
        if (user.role === 'Client') return
        const uid = String(user._id)
        const before = presenceMap.get(uid)
        if (!before) return
        await setUserOnline(user._id, false)
        const after = presenceMap.get(uid)
        if (before.isOnline && !after?.isOnline) {
          socket.broadcast.to('global').emit('user:offline', { userId: uid, lastSeen: after?.lastSeen || new Date() })
        }
      } catch {}
    })
  })

  return io
}

export function getIO() {
  return io
}

export function emitResource(resource, action, doc) {
  if (!io) return
  io.to('global').emit('resource:changed', {
    resource, action, id: doc?._id?.toString?.() || doc?.id || null,
  })
}

export function emitToClient(clientId, event, payload) {
  if (!io || !clientId) return
  io.to(`client:${clientId}`).emit(event, payload)
}

export function emitToUser(userId, event, payload) {
  if (!io || !userId) return
  io.to(`user:${userId}`).emit(event, payload)
}

export function emitToUsers(userIds, event, payload) {
  if (!io) return
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))]
  for (const id of ids) io.to(`user:${id}`).emit(event, payload)
}

export function getPresenceMap() { return presenceMap }
export function isUserOnline(userId) { return !!presenceMap.get(String(userId))?.isOnline }
export function emitTyping(conversationId, user, isTyping) {
  handleTyping({ data: { user } }, { conversationId, isTyping })
}
