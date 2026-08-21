import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

import { connectDB, gracefulShutdown } from './config/db.js'
import { corsOptions } from './config/cors.js'
import { notFound, errorHandler } from './middleware/error.js'

// PHASE ADMIN ATTENDANCE (TASK 4): process lifecycle events for Admin -> System Log.
import { systemLog, SYSTEM_LOG_SOURCES } from './utils/systemLog.js'

import { initRealtime } from './realtime/index.js'
import { withEmit } from './realtime/emitMiddleware.js'

import authRoutes from './routes/authRoutes.js'
import employeeRoutes from './routes/employeeRoutes.js'
import hrRoutes from './routes/hrRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import leaveRoutes from './routes/leaveRoutes.js'
import projectRoutes from './routes/projectRoutes.js'
import financeRoutes from './routes/financeRoutes.js'
import fileRoutes from './routes/fileRoutes.js'
import reportRoutes from './routes/reportRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import calendarRoutes from './routes/calendarRoutes.js'
import announcementRoutes from './routes/announcementRoutes.js'
import adminRoutes, { adminClientRouter } from './routes/adminRoutes.js'
import clientRoutes from './routes/clientRoutes.js'
import userRoutes from './routes/userRoutes.js'
import chatRoutes from './routes/chatRoutes.js'

// Phase 5: background leave maintenance (expiry sweep + HR reminders).
import {
  startLeaveScheduler,
  stopLeaveScheduler,
} from './services/leaveScheduler.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// --- Global middleware ---
app.use(cors(corsOptions))

// Raise the JSON body limit — user/employee profiles embed base64 avatar
// data URLs that easily exceed Express's 100kb default and 413 otherwise.
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use(morgan('dev'))

app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'))
)

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Skew Enterprise Hub API',
  })
})

// --- Routes ---
app.use('/api/auth', authRoutes)

// Broadcast a `resource:changed` event to internal users on every write.
app.use(
  '/api/employees',
  withEmit(employeeRoutes, 'employees')
)

app.use(
  '/api/hr',
  withEmit(hrRoutes, 'hr')
)

app.use(
  '/api/attendance',
  withEmit(attendanceRoutes, 'attendance')
)

app.use(
  '/api/leave',
  withEmit(leaveRoutes, 'leave')
)

app.use(
  '/api/project',
  withEmit(projectRoutes, 'projects')
)

app.use(
  '/api/finance',
  withEmit(financeRoutes, 'finance')
)

app.use(
  '/api/files',
  withEmit(fileRoutes, 'files')
)

app.use('/api/reports', reportRoutes)
app.use('/api/dashboard', reportRoutes)

app.use(
  '/api/notifications',
  withEmit(notificationRoutes, 'notifications')
)

app.use(
  '/api/calendar',
  withEmit(calendarRoutes, 'calendar')
)

app.use(
  '/api/announcements',
  withEmit(announcementRoutes, 'announcements')
)

// Client portal: scoped by JWT; admin sub-router manages clients + their data.
app.use('/api/client', clientRoutes)

app.use('/api/admin', adminRoutes)
app.use('/api/admin', adminClientRouter)

// Dedicated user-management surface (create with hashed password, reset, RBAC).
app.use(
  '/api/users',
  withEmit(userRoutes, 'admin-users')
)

// Internal staff chat. NOT wrapped in withEmit: chat events are targeted per
// user (user:<id>) rooms via the realtime helpers, not broadcast to 'global'.
app.use('/api/chat', chatRoutes)

// NOTE: Additional module routes (attendance, leaves, leads, projects, products,
// transactions…) follow the same pattern as employeeRoutes.js using crudController.

// --- Error handling ---
app.use(notFound)
app.use(errorHandler)

const PORT = process.env.PORT || 5000

// --- Database connection and server startup ---
connectDB(process.env.MONGO_URI).then(async () => {
  const server = app.listen(PORT, () => {
    console.log(
      `Server Status: running on http://localhost:${PORT}`
    )
  })

  // Report collection count + connection status immediately after listen.
  const cols = await mongoose.connection.db.listCollections().toArray()

  console.log('Collections Found:', cols.length)
  console.log('Seed Status: run `npm run seed` to populate data')
  console.log('Real-time (Socket.IO) enabled')

  systemLog(
    'INFO',
    `API server started on port ${PORT} (${cols.length} collections available)`,
    SYSTEM_LOG_SOURCES.API
  )

  initRealtime(server)

  // Phase 5 (Tasks 6 & 7): expire stale pending leave requests and send the
  // 24h/12h/2h approval reminders. Started only after a successful DB
  // connection, since every cycle reads and writes MongoDB.
  startLeaveScheduler()

  systemLog(
    'INFO',
    'Leave scheduler started (expiry sweep + approval reminders)',
    SYSTEM_LOG_SOURCES.CRON
  )

  // Graceful shutdown on termination signals.
  const shutdown = () => {
    stopLeaveScheduler()
    gracefulShutdown(server)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})