import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// --- Role ---
const roleSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  protected: { type: Boolean, default: false },
  system: { type: Boolean, default: false },
}, opts)

// --- Permission matrix (single document) ---
const permissionSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  matrix: { type: Object, default: {} },
}, opts)

// --- API Key ---
const apiKeySchema = new Schema({
  name: { type: String, required: true, trim: true },
  key: { type: String, required: true, unique: true },
  scopes: { type: [String], default: ['read'] },
  env: { type: String, enum: ['Production', 'Staging', 'Development'], default: 'Production' },
  status: { type: String, enum: ['Active', 'Revoked'], default: 'Active' },
  lastUsed: { type: String, default: '—' },
  createdAt: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  createdBy: { type: String, default: 'System' },
}, opts)

// --- Audit Log ---
const auditLogSchema = new Schema({
  user: { type: String, default: 'System' },
  // Admin/actor who performed the action (distinct from the subject `user`).
  actor: { type: String, default: 'System' },
  action: { type: String, required: true },
  module: { type: String, default: 'Admin' },
  severity: { type: String, enum: ['Info', 'Warning', 'Critical'], default: 'Info' },
  ip: { type: String, default: 'localhost' },
  at: { type: Date, default: Date.now },
}, opts)

// Indexes for audit log filtering.
auditLogSchema.index({ module: 1, severity: 1 })
auditLogSchema.index({ at: -1 })

// --- System Log ---
const systemLogSchema = new Schema({
  level: { type: String, enum: ['INFO', 'WARN', 'ERROR', 'DEBUG'], default: 'INFO' },
  source: { type: String, default: 'api-gateway' },
  message: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, opts)

// --- Backup record ---
const backupSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['Full', 'Incremental', 'Differential'], default: 'Full' },
  size: { type: Number, default: 0 },
  createdAt: { type: String, default: () => new Date().toISOString().slice(0, 16).replace('T', ' ') },
  status: { type: String, enum: ['Completed', 'In Progress', 'Failed'], default: 'Completed' },
  createdBy: { type: String, default: 'System' },
  durationSec: { type: Number, default: 0 },
  kind: { type: String, enum: ['Backup', 'Snapshot'], default: 'Backup' },
  // PHASE ADMIN (TASK 4): absolute-or-relative path of the archive this record
  // describes. Previously a Backup document was pure metadata - it recorded a
  // name, a fabricated size and a "Completed" status while NO FILE WAS EVER
  // WRITTEN, which is why the download endpoint had to invent its payload.
  // Storing the real path is what lets the download stream the actual archive
  // and lets the API report honestly when an archive is missing.
  file: { type: String, default: '' },
  // PHASE ADMIN (TASK 4): the failure reason for a 'Failed' record, so a failed
  // backup is diagnosable instead of being silently swallowed.
  error: { type: String, default: '' },
}, opts)

// --- Setting (keyed by category) ---
const settingSchema = new Schema({
  category: { type: String, required: true, unique: true },
  data: { type: Object, default: {} },
}, opts)

// --- Activity session ---
const activitySchema = new Schema({
  user: { type: String, required: true },
  role: { type: String, default: 'Employee' },
  device: { type: String, default: 'Unknown' },
  browser: { type: String, default: 'Unknown' },
  ip: { type: String, default: '0.0.0.0' },
  location: { type: String, default: 'Unknown' },
  startedAt: { type: String, default: () => new Date().toISOString().slice(0, 16).replace('T', ' ') },
  currentUrl: { type: String, default: '/' },
  active: { type: Boolean, default: true },
}, opts)

// Index for activity/session lookups by user.
activitySchema.index({ user: 1 })
activitySchema.index({ startedAt: -1 })

export const Role = model('Role', roleSchema)
export const Permission = model('Permission', permissionSchema)
export const ApiKey = model('ApiKey', apiKeySchema)
export const AuditLog = model('AuditLog', auditLogSchema)
export const SystemLog = model('SystemLog', systemLogSchema)
export const Backup = model('Backup', backupSchema)
export const Setting = model('Setting', settingSchema)
export const Activity = model('Activity', activitySchema)
