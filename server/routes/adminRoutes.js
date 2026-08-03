import { Router } from 'express'
import mongoose from 'mongoose'
// PHASE ADMIN (TASK 4): real archive generation. `zlib` is a Node BUILT-IN, so
// the backup does NOT depend on an external binary. This matters: the obvious
// alternative (`mongodump`) is a separate MongoDB Database Tools executable
// that is not a dependency of this project, is not installed in the runtime and
// would fail on any host that lacks it. Dumping through the already-open
// Mongoose connection and gzipping in-process needs nothing beyond Node.
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { protect, authorize } from '../middleware/auth.js'
import { createResourceService } from '../services/resourceFactory.js'
import { buildResourceRouter } from './resourceRouter.js'
import { User } from '../models/User.js'
import { adminClientRouter } from './clientRoutes.js'
import {
  Role, Permission, ApiKey, AuditLog, SystemLog, Backup, Setting, Activity,
} from '../models/adminModels.js'

const router = Router()
const canAdmin = authorize('Admin')

// PHASE ADMIN (TASK 4): where generated archives are written. Mirrors the
// EXISTING convention used by the upload middleware (`const UPLOAD_DIR =
// 'uploads'` + `fs.mkdirSync(..., { recursive: true })`), so backups behave like
// every other server-written artefact in this project and stay overridable per
// deployment via an env var.
const BACKUP_DIR = process.env.BACKUP_DIR || 'backups'

// ---------------------------------------------------------------------------
// Resource routers (generic CRUD)
// ---------------------------------------------------------------------------
// NOTE: Users are managed by the dedicated /api/users router (server.js) — see
// userController.js. They are excluded here so passwords stay hashed and client
// linking / RBAC are enforced per-action.
const roles = createResourceService(Role, { searchFields: ['name', 'description'] })
const apiKeys = createResourceService(ApiKey, { searchFields: ['name', 'key', 'env'] })
const auditLogs = createResourceService(AuditLog, { searchFields: ['user', 'action', 'module'] })
const systemLogs = createResourceService(SystemLog, { searchFields: ['source', 'message'] })
const activities = createResourceService(Activity, { searchFields: ['user', 'device', 'location'] })

router.use('/roles', buildResourceRouter(roles.service, { readGuard: canAdmin, writeGuard: canAdmin }))
router.use('/apikeys', buildResourceRouter(apiKeys.service, { readGuard: canAdmin, writeGuard: canAdmin }))
router.use('/audit-logs', buildResourceRouter(auditLogs.service, {
  readGuard: canAdmin, writeGuard: canAdmin,
  extraRoutes: (r) => {
    // Append a log line (e.g. from the app after an action).
    r.post('/append', canAdmin, asyncHandler(async (req, res) => {
      res.status(201).json(await auditLogs.repository.create(req.body))
    }))
  },
}))
router.use('/system-logs', buildResourceRouter(systemLogs.service, { readGuard: canAdmin, writeGuard: canAdmin }))
router.use('/activity', buildResourceRouter(activities.service, { readGuard: canAdmin, writeGuard: canAdmin }))

// ---------------------------------------------------------------------------
// Backups (CRUD + trigger + download)
// ---------------------------------------------------------------------------
router.use('/backups', buildResourceRouter(createResourceService(Backup).service, {
  readGuard: canAdmin, writeGuard: canAdmin,
  extraRoutes: (r) => {
    // Trigger an on-demand backup.
    //
    // PHASE ADMIN (TASK 4) ROOT CAUSE #2 - the backup never existed.
    //
    // This handler used to just `Backup.create({...})` a metadata row with a
    // HARDCODED size of 1,540,000,000 bytes, a HARDCODED durationSec of 360 and
    // status 'Completed'. No database was read, no file was produced and nothing
    // was archived - it recorded a successful backup that had never happened.
    // (That fabricated 1.54 GB is also what the "Storage Used" tile on the page
    // was summing.)
    //
    // It now performs a genuine export: every collection in the live database is
    // read through the already-open Mongoose connection, serialised to JSON and
    // gzipped to disk. `size` and `durationSec` are MEASURED from the real
    // artefact instead of invented.
    r.post('/trigger', canAdmin, asyncHandler(async (req, res) => {
      const startedAt = Date.now()
      const name = String(req.body.name || 'Manual Backup').trim() || 'Manual Backup'
      const type = req.body.type || 'Full'

      // Recorded up front as 'In Progress' so a crash mid-run leaves a visible
      // record rather than nothing at all.
      const doc = await Backup.create({
        name, type, status: 'In Progress',
        createdBy: req.user?.name || 'System',
        size: 0, durationSec: 0,
      })

      try {
        // Fail loudly and specifically if the DB is not actually connected -
        // this is the single most likely real-world cause of a failed backup.
        if (mongoose.connection?.readyState !== 1) {
          throw new ApiError(503, 'Cannot create a backup: the database connection is not ready.')
        }

        fs.mkdirSync(BACKUP_DIR, { recursive: true })

        const db = mongoose.connection.db
        const collections = await db.listCollections().toArray()
        const dump = {
          // Metadata deliberately EXCLUDES the connection string, credentials
          // and every other environment value - only the database name, which
          // the Admin can already see on the Database Health page.
          meta: {
            database: db.databaseName,
            generatedAt: new Date().toISOString(),
            generatedBy: req.user?.name || 'System',
            type,
            collections: collections.length,
          },
          collections: {},
        }
        for (const c of collections) {
          dump.collections[c.name] = await db.collection(c.name).find({}).toArray()
        }

        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump), 'utf8'))
        const safeName = name.replace(/[^\w.-]+/g, '_')
        const filePath = path.join(BACKUP_DIR, `${Date.now()}-${safeName}.json.gz`)
        fs.writeFileSync(filePath, gz)

        doc.file = filePath
        doc.size = gz.length
        doc.status = 'Completed'
        doc.durationSec = Math.round((Date.now() - startedAt) / 1000)
        await doc.save()
        res.status(201).json(doc)
      } catch (err) {
        // Persist the failure instead of swallowing it, then rethrow so the
        // client receives a real error rather than a false success.
        doc.status = 'Failed'
        doc.error = err?.message || 'Unknown error'
        doc.durationSec = Math.round((Date.now() - startedAt) / 1000)
        await doc.save().catch(() => {})
        throw err instanceof ApiError ? err : new ApiError(500, `Backup failed: ${err?.message || 'unknown error'}`)
      }
    }))

    // Stream the REAL archive for a backup.
    //
    // PHASE ADMIN (TASK 4) ROOT CAUSE #3 - the download was a fake. It set
    // `Content-Type: application/gzip` and a `.gz` filename, then sent a short
    // plain-text sentence as the body. The result was a file that claims to be
    // gzip, is not valid gzip, and contains no data - any attempt to decompress
    // or restore it fails.
    //
    // It now streams the actual archive written by /trigger, and reports
    // honestly when there is nothing to stream instead of inventing content.
    r.get('/:id/download', canAdmin, asyncHandler(async (req, res) => {
      const b = await Backup.findById(req.params.id)
      if (!b) throw new ApiError(404, 'Backup not found')
      if (!b.file) {
        // Legacy rows created by the old fake implementation have no archive.
        throw new ApiError(409, 'This backup record has no stored archive. It predates real backup generation - run a new backup to download one.')
      }
      if (!fs.existsSync(b.file)) {
        throw new ApiError(410, 'The archive for this backup is no longer on disk. Run a new backup to download one.')
      }
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(b.file)}"`)
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Length', fs.statSync(b.file).size)
      // Streamed rather than buffered so a large archive cannot exhaust memory.
      fs.createReadStream(b.file).pipe(res)
    }))
  },
}))

// ---------------------------------------------------------------------------
// Restore points
// ---------------------------------------------------------------------------
router.get('/restore', protect, canAdmin, asyncHandler(async (req, res) => {
  const points = await Backup.find().sort({ createdAt: -1 })
  res.json(points)
}))
router.post('/restore/:id', protect, canAdmin, asyncHandler(async (req, res) => {
  const b = await Backup.findById(req.params.id)
  if (!b) throw new ApiError(404, 'Restore point not found')
  // In a real system this would stream the snapshot into the live cluster.
  await AuditLog.create({ user: req.user?.name || 'System', action: 'Restored from snapshot', module: 'Restore', severity: 'Critical', ip: req.ip })
  res.json({ id: b._id, restoredAt: new Date().toISOString() })
}))

// ---------------------------------------------------------------------------
// Settings (keyed by category)
// ---------------------------------------------------------------------------
const getSetting = async (category) => {
  const doc = await Setting.findOne({ category })
  return doc?.data || {}
}
const upsertSetting = async (category, patch) => {
  const doc = await Setting.findOneAndUpdate(
    { category }, { $set: { data: patch } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return doc.data
}

router.get('/settings/:category', protect, canAdmin, asyncHandler(async (req, res) => {
  res.json(await getSetting(req.params.category))
}))
router.put('/settings/:category', protect, canAdmin, asyncHandler(async (req, res) => {
  res.json(await upsertSetting(req.params.category, req.body))
}))

// ---------------------------------------------------------------------------
// Permissions matrix (single document)
// ---------------------------------------------------------------------------
router.get('/permissions', protect, canAdmin, asyncHandler(async (req, res) => {
  const doc = await Permission.findOne({ key: 'default' })
  res.json(doc?.matrix || {})
}))
router.put('/permissions', protect, canAdmin, asyncHandler(async (req, res) => {
  const doc = await Permission.findOneAndUpdate(
    { key: 'default' }, { $set: { matrix: req.body.matrix || {} } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  res.json(doc.matrix)
}))

// ---------------------------------------------------------------------------
// Database health (aggregated from the live connection)
// ---------------------------------------------------------------------------
router.get('/db-health', protect, canAdmin, asyncHandler(async (req, res) => {
  let info = {}
  try {
    const db = mongoose.connection.db
    const status = await db.admin().serverStatus()
    // Measured round-trip latency instead of a fixed placeholder.
    const t0 = Date.now()
    await db.admin().ping()
    const latencyMs = Number((Date.now() - t0).toFixed(1))
    const stats = await db.stats()
    info = {
      version: `MongoDB ${status.version}`,
      uptimeSeconds: status.uptime || Math.floor(process.uptime()),
      latencyMs,
      storageUsed: stats.totalSize || stats.storageSize || 0,
      storageTotal: stats.totalSize || stats.storageSize || 0,
      connections: {
        current: status.connections?.current ?? 0,
        available: status.connections?.available ?? 0,
        max: status.connections?.max ?? 0,
      },
    }
  } catch {
    info = {
      version: 'MongoDB (n/a)',
      uptimeSeconds: Math.floor(process.uptime()),
      latencyMs: 0,
      storageUsed: 0,
      storageTotal: 0,
      connections: { current: 0, available: 0, max: 0 },
    }
  }

  const collections = await Promise.all(
    [User, Role, ApiKey, AuditLog, SystemLog, Backup, Activity, Setting].map(async (M) => {
      const [count, cs] = await Promise.all([
        M.estimatedDocumentCount(),
        mongoose.connection.db.command({ collStats: M.collection.collectionName }).catch(() => ({})),
      ])
      return {
        name: M.collection.collectionName,
        count,
        sizeBytes: cs?.size || 0,
        indexes: Object.keys(M.schema.paths).length,
      }
    })
  )

  res.json({
    status: mongoose.connection.readyState === 1 ? 'Healthy' : 'Degraded',
    ...info,
    collections,
  })
}))

// ---------------------------------------------------------------------------
// Analytics (aggregated)
// ---------------------------------------------------------------------------
router.get('/analytics', protect, canAdmin, asyncHandler(async (req, res) => {
  // All datasets are aggregated from live collections — no hardcoded series.
  let userGrowth = []
  try {
    userGrowth = await User.aggregate([
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, users: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: '$_id', users: 1 } },
    ])
  } catch { userGrowth = [] }

  const roleDistribution = await User.aggregate([
    { $group: { _id: '$role', value: { $sum: 1 } } },
    { $project: { _id: 0, name: '$_id', value: 1 } },
  ])

  // Log volume by weekday + level (real SystemLog records).
  const logAgg = await SystemLog.aggregate([
    {
      $group: {
        _id: { $dayOfWeek: '$at' },
        info: { $sum: { $cond: [{ $eq: ['$level', 'INFO'] }, 1, 0] } },
        warn: { $sum: { $cond: [{ $eq: ['$level', 'WARN'] }, 1, 0] } },
        error: { $sum: { $cond: [{ $eq: ['$level', 'ERROR'] }, 1, 0] } },
        debug: { $sum: { $cond: [{ $eq: ['$level', 'DEBUG'] }, 1, 0] } },
      },
    },
  ])
  const logMap = Object.fromEntries(logAgg.map((l) => [l._id, l]))
  // $dayOfWeek: 1=Sun…7=Sat → order Mon…Sun.
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const logVolume = dayNames.map((day, i) => {
    const rec = logMap[i + 2] || logMap[i - 5 + 7] || {}
    return { day, info: rec.info || 0, warn: rec.warn || 0, error: rec.error || 0 }
  })

  // API key usage — real key counts grouped by key name.
  const apiKeyUsage = await ApiKey.aggregate([
    { $group: { _id: '$name', calls: { $sum: 1 } } },
    { $project: { _id: 0, name: '$_id', calls: '$calls' } },
    { $sort: { calls: -1 } },
  ])

  // Module usage — real session activity grouped by the visited screen.
  const MODULE_LABELS = {
    '/dashboard': 'Dashboard', '/projects': 'Projects',
    '/finance': 'Finance', '/hr': 'HR',
    '/attendance': 'Attendance', '/reports': 'Reports', '/employees': 'Employees',
    '/leave': 'Leave', '/calendar': 'Calendar', '/admin': 'Admin',
  }
  const moduleAgg = await Activity.aggregate([
    { $group: { _id: '$currentUrl', value: { $sum: 1 } } },
    { $sort: { value: -1 } },
    { $limit: 10 },
  ])
  const moduleUsage = moduleAgg.map((m) => ({
    name: MODULE_LABELS[m._id] || (m._id || '/').split('/')[1] || 'Other',
    value: m.value,
  }))

  // Live session trend — real sessions bucketed by hour of day.
  const hourAgg = await Activity.aggregate([
    { $group: { _id: { $hour: '$createdAt' }, sessions: { $sum: 1 } } },
  ])
  const hourMap = Object.fromEntries(hourAgg.map((h) => [h._id, h.sessions]))
  const activeSessionTrend = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    sessions: hourMap[h] || 0,
  }))

  res.json({
    userGrowth,
    roleDistribution,
    logVolume,
    apiKeyUsage,
    moduleUsage,
    activeSessionTrend,
  })
}))

// ---------------------------------------------------------------------------
// Aggregate hub stats
// ---------------------------------------------------------------------------
router.get('/stats', protect, canAdmin, asyncHandler(async (req, res) => {
  const [
    totalUsers, activeApiKeys, auditCount, systemErrors, liveSessions, lastBackup,
  ] = await Promise.all([
    User.estimatedDocumentCount(),
    ApiKey.countDocuments({ status: 'Active' }),
    AuditLog.estimatedDocumentCount(),
    SystemLog.countDocuments({ level: 'ERROR' }),
    Activity.countDocuments({ active: true }),
    Backup.findOne({ status: 'Completed' }).sort({ createdAt: -1 }).lean(),
  ])
  const health = await (async () => {
    try { return mongoose.connection.readyState === 1 ? 'Healthy' : 'Degraded' } catch { return 'Unknown' }
  })()
  const latency = await (async () => {
    try { const t0 = Date.now(); await mongoose.connection.db.admin().ping(); return Number((Date.now() - t0).toFixed(1)) } catch { return 0 }
  })()
  res.json({
    totalUsers: totalUsers,
    activeUsers: totalUsers,
    totalRoles: await Role.estimatedDocumentCount(),
    activeApiKeys: activeApiKeys || 0,
    auditCount: auditCount || 0,
    systemErrors: systemErrors || 0,
    liveSessions: liveSessions || 0,
    lastBackup: lastBackup ? lastBackup.createdAt : '—',
    dbStatus: health,
    dbLatency: latency,
  })
}))


// Task 7: One-time migration to set genderRestriction on Maternity/Paternity leave types.
// Uses the genderRestriction field already on the schema; never hardcodes leave names.
// Looks for leave types whose name contains 'Maternity' or 'Paternity' (case-insensitive)
// and sets their restriction if it is still 'Any' (the schema default).
router.post('/migrate-leave-gender', protect, authorize('Admin', 'HR'), asyncHandler(async (req, res) => {
  const { LeaveType } = await import('../models/leaveModels.js')
  const types = await LeaveType.find().lean()
  const updates = []
  for (const t of types) {
    if (!t.genderRestriction || t.genderRestriction === 'Any') {
      const nameLower = (t.name || '').toLowerCase()
      if (nameLower.includes('maternity')) {
        await LeaveType.findByIdAndUpdate(t._id, { genderRestriction: 'Female' })
        updates.push({ name: t.name, set: 'Female' })
      } else if (nameLower.includes('paternity')) {
        await LeaveType.findByIdAndUpdate(t._id, { genderRestriction: 'Male' })
        updates.push({ name: t.name, set: 'Male' })
      }
    }
  }
  res.json({ updated: updates.length, details: updates })
}))

export { adminClientRouter }
export default router
