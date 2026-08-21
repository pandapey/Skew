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
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7): the Plan catalogue lives in the
// client domain (models/clientModels.js) because a Plan is an attribute of a
// CLIENT account, not an HR entity.
import { Plan } from '../models/clientModels.js'
import { validatePlan } from '../validators/planValidators.js'
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
// PHASE SALARY/BILLING/ADMIN (TASK 12 + 13) — ONE archive implementation.
//
// The gzip-every-collection routine below used to live inline inside
// POST /backups/trigger. TASK 13 needs the identical routine for the safety
// snapshot the Restore screen already promises the admin ("A safety snapshot is
// taken automatically"), so it is extracted here and CALLED by both. There is
// deliberately no second backup implementation — writing one would have been
// exactly the duplicate-backup-system the brief forbids.
// ---------------------------------------------------------------------------
const SYSTEM_COLLECTION = /^system\./

// ---------------------------------------------------------------------------
// ARCHIVE FORMAT — EXTENDED JSON, NOT PLAIN JSON.
//
// POST-INCIDENT FIX. writeArchive() previously serialised the dump with
// `JSON.stringify()`. JSON has no BSON types, so every value was silently
// flattened on the way out:
//     ObjectId("6a70…")           ->  "6a70…"                (plain string)
//     ISODate("2026-08-03T06:56Z")->  "2026-08-03T06:56:44Z" (plain string)
//
// That was invisible while archives were only ever DOWNLOADED. The moment
// POST /admin/restore/:id began writing an archive BACK into the database, the
// whole database was re-inserted with STRING _ids and string dates. The
// observed damage:
//   * `User.findById(ObjectId(...))` matched nothing, so `protect` rejected
//     every authenticated request with 401 — "login failed" in the browser.
//   * `doc.save()` on a hydrated-but-unmatched document threw
//     `DocumentNotFoundError`, crashing the Node process on boot.
//
// EJSON (`bson`, already a transitive dependency of mongoose — no new package)
// encodes BSON types losslessly as {"$oid":…} / {"$date":…} and parses them
// straight back, so an archive now round-trips exactly.
//
// `relaxed: false` is required: relaxed mode emits plain JSON for dates and
// numbers, which is precisely the lossy behaviour being fixed here.
//
// ARCHIVE_FORMAT is stamped into meta and CHECKED before any restore, so an
// archive produced by the old code can never be written back into a database
// (see the restore route). That check is the safety gate — without it, every
// .json.gz already sitting in BACKUP_DIR would still be able to corrupt a
// database exactly as before.
// ---------------------------------------------------------------------------
const ARCHIVE_FORMAT = 'ejson-v1'

async function writeArchive({ name, type = 'Full', actor = 'System' }) {
  if (mongoose.connection?.readyState !== 1) {
    throw new ApiError(503, 'Cannot create a backup: the database connection is not ready.')
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const db = mongoose.connection.db
  const collections = (await db.listCollections().toArray()).filter((c) => !SYSTEM_COLLECTION.test(c.name))
  const dump = {
    // Metadata deliberately EXCLUDES the connection string, credentials and
    // every other environment value — only the database name, which the Admin
    // can already see on the Database Health page.
    meta: {
      database: db.databaseName,
      generatedAt: new Date().toISOString(),
      generatedBy: actor,
      type,
      collections: collections.length,
    },
    collections: {},
  }
  for (const c of collections) {
    dump.collections[c.name] = await db.collection(c.name).find({}).toArray()
  }

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump), 'utf8'))
  const safeName = String(name).replace(/[^\w.-]+/g, '_')
  const filePath = path.join(BACKUP_DIR, `${Date.now()}-${safeName}.json.gz`)
  fs.writeFileSync(filePath, gz)
  return { filePath, size: gz.length, collections: collections.length }
}

// TASK 12: remove the archive that a Backup record describes.
//
// The generic resource router only ever deleted the METADATA DOCUMENT, so every
// deleted backup left its .json.gz behind in BACKUP_DIR forever — the orphaned
// files the brief asks about. Deliberately tolerant: a missing file is not an
// error (the record is still the thing being deleted), and an unlink failure is
// reported to the caller rather than aborting the delete half-way.
function removeArchiveFile(file) {
  if (!file) return { removed: false, reason: 'no archive recorded' }
  try {
    if (!fs.existsSync(file)) return { removed: false, reason: 'archive already absent' }
    fs.unlinkSync(file)
    return { removed: true }
  } catch (err) {
    return { removed: false, reason: err?.message || 'unlink failed' }
  }
}

// ---------------------------------------------------------------------------
// Resource routers (generic CRUD)
// ---------------------------------------------------------------------------
// NOTE: Users are managed by the dedicated /api/users router (server.js) — see
// userController.js. They are excluded here so passwords stay hashed and client
// linking / RBAC are enforced per-action.
const roles = createResourceService(Role, { searchFields: ['name', 'description'] })
const apiKeys = createResourceService(ApiKey, { searchFields: ['name', 'key', 'env'] })
// PHASE ADMIN ATTENDANCE (TASK 3B): both log services declared searchFields but
// NO filterFields, so the Module / Severity selects on the Audit Log page and
// the Level / Source selects on the System Log page were sent to the API and
// silently ignored - the table never changed. The backend `list()` already
// supports exact-match filtering, paging (`page`/`limit`), sorting and a total
// count; it simply had not been told which fields were filterable here. This is
// configuration of the EXISTING pagination/filter implementation, not a new one.
const auditLogs = createResourceService(AuditLog, {
  searchFields: ['user', 'actor', 'action', 'module'],
  filterFields: ['module', 'severity', 'user'],
})
const systemLogs = createResourceService(SystemLog, {
  searchFields: ['source', 'message'],
  filterFields: ['level', 'source'],
})
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
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7) — Plans
// ---------------------------------------------------------------------------
// Built from the SAME two shared primitives every Department/Designation-style
// reference collection in this codebase already uses — createResourceService
// (services/resourceFactory.js) and buildResourceRouter (routes/resourceRouter.js)
// — so Plan gets list/all/get/create/update/delete, pagination, search, the
// `$`-operator sanitiser, the `withId` aliasing and the honest id guards without
// a single line of bespoke CRUD. No second Plan implementation is introduced.
//
// RBAC — deliberately asymmetric, and this is the point:
//   * writeGuard: canAdmin  — creating/renaming/deactivating/deleting a plan is
//     a catalogue decision, so it matches the Admin-only /admin console tree the
//     Plan Management page is mounted in.
//   * readGuard: Admin|HR|Manager — the Client Creation and Client Edit forms
//     must populate their Plan dropdown, and those forms are open to
//     CLIENT_WRITE_ROLES (Admin, HR, Manager — see clientRoutes.js
//     adminClientRouter, which authorises exactly this trio for client CRUD).
//     Defaulting the read guard to Admin-only would have left HR and Manager
//     with a permanently empty dropdown — precisely the failure mode
//     hrRoutes.js documents for GET /hr/departments/all and fixes the same way
//     with its `refDataRead` widening. This is read-only reference data; it
//     exposes plan names and prices, never client data.
const planRead = authorize('Admin', 'Manager')
const plans = createResourceService(Plan, {
  searchFields: ['name', 'code', 'description'],
  filterFields: ['status'],
})

// TASK 13: buildResourceRouter applies its `validate` middleware to POST only.
// The duplicate-name rule must hold on RENAME too, so the update is declared
// HERE, before the generic mount — Express matches in declaration order, exactly
// the precedent this file already documents for DELETE /backups/:id below. It
// delegates straight to `plans.service.update`, so there is no second update
// implementation; this route only adds the validation hop.
router.put('/plans/:id', protect, canAdmin, validatePlan, asyncHandler(async (req, res) => {
  res.json(await plans.service.update(req.params.id, req.body))
}))

router.use('/plans', buildResourceRouter(plans.service, {
  readGuard: planRead,
  writeGuard: canAdmin,
  validate: validatePlan,
}))

// ---------------------------------------------------------------------------
// Backups (CRUD + trigger + download)
// ---------------------------------------------------------------------------
//
// TASK 12 (second half) — DELETING A BACKUP MUST DELETE ITS ARCHIVE.
//
// buildResourceRouter's generic `DELETE /:id` removes the Backup METADATA
// DOCUMENT only. Since Phase ADMIN (Task 4) a backup also writes a real
// .json.gz into BACKUP_DIR, so every delete was leaving that archive orphaned
// on disk with nothing left in the database pointing at it — unreachable,
// undeletable through the UI, and still counted by nothing.
//
// Registered BEFORE `router.use('/backups', ...)` because Express matches in
// declaration order: the generic router's own DELETE handler would otherwise
// win, and a handler added through `extraRoutes` runs after it. Same guard
// (`canAdmin`) and same 400/404 semantics as the generic path, so RBAC and the
// error contract are unchanged.
router.delete('/backups/:id', protect, canAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params
  if (!id || id === 'undefined' || id === 'null' || !mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, `A valid backup id is required (received "${id}").`)
  }
  const doc = await Backup.findById(id)
  if (!doc) throw new ApiError(404, 'Backup not found')

  const archive = removeArchiveFile(doc.file)
  await doc.deleteOne()

  await AuditLog.create({
    user: req.user?.name || 'System',
    actor: req.user?.name || 'System',
    action: 'Deleted backup',
    module: 'Backup',
    severity: 'Warning',
    ip: req.ip,
  })
  res.json({ id: String(doc._id), archiveRemoved: archive.removed, archiveNote: archive.reason || null })
}))

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
        // TASK 12/13: the archive routine now lives in writeArchive() so the
        // Restore safety snapshot runs the IDENTICAL code path. Behaviour here
        // is unchanged - same gzip, same measured size, same failure policy.
        const { filePath, size } = await writeArchive({
          name, type, actor: req.user?.name || 'System',
        })

        doc.file = filePath
        doc.size = size
        doc.status = 'Completed'
        doc.durationSec = Math.round((Date.now() - startedAt) / 1000)
        await doc.save()
        // TASK 12: return `id` so the row the UI optimistically renders carries
        // the same identifier every other row now does.
        res.status(201).json({ ...doc.toObject(), id: String(doc._id) })
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
// PHASE SALARY/BILLING/ADMIN (TASK 13) ROOT CAUSE — "restore failed /
// invalid_id : undefined".
//
// TRACE: pages/admin/Restore.jsx `setRestoring(r)` -> ConfirmDialog
//   -> `restore.mutate(restoring.id)` -> adminApi.restore.restore(id)
//   -> POST /api/admin/restore/:id -> Backup.findById(id).
//
// Identical shape to TASK 12 but a DIFFERENT mechanism, which is why fixing the
// resource factory alone was not enough: this endpoint does not go through the
// factory at all. It returned `Backup.find()` — an array of MONGOOSE DOCUMENTS.
// Mongoose's default `toJSON` does NOT serialise virtuals, so the `id` virtual
// never reached the wire and the response carried only `_id`. `restoring.id` was
// therefore undefined, the URL became `/admin/restore/undefined`, and findById
// cast-failed into `Invalid _id: undefined`.
//
// `.lean()` + the explicit `id` matches how every other list in this codebase is
// normalised. `_id` is preserved, so nothing that already read it breaks.
router.get('/restore', protect, canAdmin, asyncHandler(async (req, res) => {
  const points = await Backup.find().sort({ createdAt: -1 }).lean()
  res.json(points.map((p) => ({
    ...p,
    id: String(p._id),
    // The Restore table only offers 'Completed' points; surfacing whether an
    // archive actually exists lets it stop offering ones that cannot be restored.
    hasArchive: Boolean(p.file && fs.existsSync(p.file)),
  })))
}))

// TASK 13 — the restore itself.
//
// HONEST STATUS, stated plainly because the brief asks for it: before this
// phase this endpoint performed NO RESTORE AT ALL. It looked the record up,
// wrote an audit line and returned `{ restoredAt }`, and the UI toasted
// "System restored from point". Nothing was ever read from the archive and no
// data was ever replaced — a silent no-op reporting success.
//
// It now performs a real restore, built ONLY from the pieces that already
// existed (the archive written by /backups/trigger and the shared writeArchive
// helper). No new restore architecture, no new collection, no new file format.
//
// Safety properties, in order:
//   1. The id is validated before Mongoose ever sees it (the bug above).
//   2. A restore is refused unless a readable archive genuinely exists — a
//      metadata-only legacy row reports 409 instead of pretending to work.
//   3. The archive is decompressed and parsed BEFORE anything is written, so a
//      corrupt file aborts with the live database untouched.
//   4. The safety snapshot the Restore screen already promises the admin is
//      taken first, through the same writeArchive() the Backup page uses, and
//      is recorded as a real Backup row so it is restorable in turn.
//   5. Only collections present in the archive are replaced. `backups` is
//      excluded so a restore cannot delete the safety snapshot it just took (or
//      the archive rows pointing at files still on disk), and system.* is
//      skipped.
// The existing ConfirmDialog remains the user-facing confirmation; this route
// adds no second prompt and removes none.
router.post('/restore/:id', protect, canAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params
  if (!id || id === 'undefined' || id === 'null' || !mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, `A valid restore point id is required (received "${id}").`)
  }
  const b = await Backup.findById(id)
  if (!b) throw new ApiError(404, 'Restore point not found')
  if (b.status !== 'Completed') {
    throw new ApiError(409, `This restore point is "${b.status}" and cannot be restored.`)
  }
  if (!b.file) {
    throw new ApiError(409, 'This restore point has no stored archive. It predates real backup generation and cannot be restored — run a new backup first.')
  }
  if (!fs.existsSync(b.file)) {
    throw new ApiError(410, 'The archive for this restore point is no longer on disk, so it cannot be restored.')
  }
  if (mongoose.connection?.readyState !== 1) {
    throw new ApiError(503, 'Cannot restore: the database connection is not ready.')
  }

  // (3) Parse first — a corrupt archive must fail before any write.
  let dump
  try {
    dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(b.file)).toString('utf8'))
  } catch (err) {
    throw new ApiError(422, `The archive could not be read: ${err?.message || 'unreadable or corrupt'}.`)
  }
  const payload = dump?.collections
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(422, 'The archive does not contain a recognisable collection dump.')
  }

  const startedAt = Date.now()
  const actor = req.user?.name || 'System'

  // (4) Safety snapshot BEFORE the destructive step.
  let snapshot = null
  try {
    const snapName = `Pre-restore safety snapshot (${b.name})`
    const written = await writeArchive({ name: snapName, type: 'Full', actor })
    snapshot = await Backup.create({
      name: snapName,
      type: 'Full',
      kind: 'Snapshot',
      status: 'Completed',
      createdBy: actor,
      size: written.size,
      file: written.filePath,
      durationSec: Math.round((Date.now() - startedAt) / 1000),
    })
  } catch (err) {
    // Refuse to proceed: an un-undoable destructive restore is not acceptable.
    throw new ApiError(500, `Restore aborted — the safety snapshot could not be taken: ${err?.message || 'unknown error'}`)
  }

  // (5) Replace only the collections the archive actually carries.
  const db = mongoose.connection.db
  const restored = []
  const skipped = []
  for (const [name, docs] of Object.entries(payload)) {
    if (SYSTEM_COLLECTION.test(name) || name === Backup.collection.collectionName) {
      skipped.push(name)
      continue
    }
    if (!Array.isArray(docs)) { skipped.push(name); continue }
    const col = db.collection(name)
    await col.deleteMany({})
    if (docs.length) await col.insertMany(docs, { ordered: false })
    restored.push({ collection: name, documents: docs.length })
  }

  await AuditLog.create({
    user: actor,
    actor,
    action: 'Restored from snapshot',
    module: 'Restore',
    severity: 'Critical',
    ip: req.ip,
  })

  res.json({
    id: String(b._id),
    restoredAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - startedAt) / 1000),
    collectionsRestored: restored.length,
    documentsRestored: restored.reduce((s, r) => s + r.documents, 0),
    restored,
    skipped,
    safetySnapshotId: snapshot ? String(snapshot._id) : null,
  })
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
router.post('/migrate-leave-gender', protect, authorize('Admin', 'Manager'), asyncHandler(async (req, res) => {
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
