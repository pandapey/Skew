process.env.TZ = process.env.TZ || 'Asia/Kolkata'
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
import { domainRouter, hostingRouter, registrarRouter } from './routes/infrastructureRoutes.js'

import {
  startLeaveScheduler,
  stopLeaveScheduler,
} from './services/leaveScheduler.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(cors(corsOptions))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use(morgan('dev'))

app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'))
)

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Skew Enterprise Hub API',
  })
})

app.use('/api/auth', authRoutes)

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

app.use('/api/client', clientRoutes)

app.use('/api/admin', adminRoutes)
app.use('/api/admin', adminClientRouter)

app.use('/api/domains', withEmit(domainRouter, 'domains'))
app.use('/api/hosting', withEmit(hostingRouter, 'hosting'))
app.use('/api/registrars', withEmit(registrarRouter, 'registrars'))

app.use(
  '/api/users',
  withEmit(userRoutes, 'admin-users')
)

app.use('/api/chat', chatRoutes)

app.use(notFound)
app.use(errorHandler)

const PORT = process.env.PORT || 5000

connectDB(process.env.MONGO_URI).then(async () => {
  const server = app.listen(PORT, () => {
    console.log(
      `Server Status: running on http://localhost:${PORT}`
    )
  })

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

  startLeaveScheduler()

  systemLog(
    'INFO',
    'Leave scheduler started (expiry sweep + approval reminders)',
    SYSTEM_LOG_SOURCES.CRON
  )

  const shutdown = () => {
    stopLeaveScheduler()
    gracefulShutdown(server)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
