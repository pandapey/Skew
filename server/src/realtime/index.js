// Real-time layer (Socket.IO). The server initializes a single `io` instance in
// server.js (initRealtime). Controllers and the emit middleware call these
// helpers to push live updates to clients without polling.
//
// Room model:
//   global           — every internal (staff) user
//   user:<userId>     — a single staff user
//   client:<clientId> — a single client's portal
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { corsOptions } from '../config/cors.js'

let io = null

export function initRealtime(server) {
  io = new Server(server, {
    cors: corsOptions,
  })

  // JWT-authed handshake. Socket connects for everyone; join the right rooms.
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

  io.on('connection', (socket) => {
    const { user } = socket.data
    if (!user) return socket.disconnect(true)
    if (user.role === 'Client') {
      socket.join(`client:${user.clientId}`)
    } else {
      socket.join('global')
      socket.join(`user:${user._id}`)
    }
  })

  return io
}

export function getIO() {
  return io
}

// Broadcast a generic resource change to all internal users (live list/CRUD).
export function emitResource(resource, action, doc) {
  if (!io) return
  io.to('global').emit('resource:changed', {
    resource, action, id: doc?._id?.toString?.() || doc?.id || null,
  })
}

// Targeted push to a single client's portal.
export function emitToClient(clientId, event, payload) {
  if (!io || !clientId) return
  io.to(`client:${clientId}`).emit(event, payload)
}

export function emitToUser(userId, event, payload) {
  if (!io || !userId) return
  io.to(`user:${userId}`).emit(event, payload)
}

// Targeted push to several staff users at once — the chat layer's fan-out.
// Reuses the SAME per-user rooms the existing socket auth already joins; no
// second socket system is created.
export function emitToUsers(userIds, event, payload) {
  if (!io) return
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))]
  for (const id of ids) io.to(`user:${id}`).emit(event, payload)
}
