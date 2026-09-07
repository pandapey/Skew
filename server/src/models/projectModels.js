import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

const memberSchema = new Schema({
  name: { type: String, required: true },
  role: { type: String, default: 'Member' },
  avatar: String,
}, { _id: false })

const projectSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  code: { type: String, uppercase: true, trim: true },
  client: String,
  clientId: { type: String, index: true, sparse: true, default: '' },
  description: String,
  lead: { type: String, index: true },
  members: [memberSchema],
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  status: { type: String, enum: ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'], default: 'Planning', index: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  budget: { type: Number, default: 0 },
  startDate: String,
  deadline: String,
  color: { type: String, default: '#2563EB' },
  advancePayment: { type: Number, default: 0, min: 0 },
  monthlyDue: { type: Number, default: 0, min: 0 },
  billingCycle: { type: String, default: 'Monthly' },
  paymentMode: { type: String, default: 'Bank Transfer' },
  website: { type: String, default: '' },
  plan: { type: String, default: '' },
}, opts)
projectSchema.index({ name: 'text', code: 'text', client: 'text' })

projectSchema.index({ client: 1 })

projectSchema.index({ code: 1 }, { unique: true, sparse: true })

const PROJECT_CODE_PREFIX = 'PRJ'
async function nextProjectCode(Model) {
  const last = await Model
    .findOne({ code: new RegExp(`^${PROJECT_CODE_PREFIX}\\d+$`) })
    .sort({ code: -1 })
    .select('code')
    .lean()
  let n = last ? parseInt(String(last.code).slice(PROJECT_CODE_PREFIX.length), 10) : 0
  if (!Number.isFinite(n)) n = 0
  for (let i = 0; i < 100; i += 1) {
    n += 1
    const candidate = `${PROJECT_CODE_PREFIX}${String(n).padStart(3, '0')}`
    if (!(await Model.exists({ code: candidate }))) return candidate
  }
  throw new Error('Unable to allocate a unique project code')
}

projectSchema.pre('save', async function (next) {
  if (!this.code) this.code = await nextProjectCode(this.constructor)
  // Auto-resolve clientId from company name if not set (Opt2 merge)
  if (!this.clientId && this.client) {
    try {
      const { Client } = await import('./clientModels.js')
      const c = await Client.findOne({ company: { $regex: new RegExp(`^${this.client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }).select('clientId').lean()
      if (c?.clientId) this.clientId = c.clientId
    } catch {}
  }
  next()
})

const sprintSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true },
  goal: String,
  startDate: String,
  endDate: String,
  status: { type: String, enum: ['Planned', 'Active', 'Completed'], default: 'Planned', index: true },
}, opts)
sprintSchema.index({ name: 'text', goal: 'text' })

const taskSubmissionSchema = new Schema({
  by: { type: String, required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
  attachment: {
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
  },
}, { _id: false })

const taskReviewSchema = new Schema({
  reviewer: { type: String, required: true },
  status: { type: String, enum: ['Approved', 'Rejected', 'Returned'], required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
}, { _id: false })

const taskHistorySchema = new Schema({
  event: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned', 'Started', 'Paused', 'Resumed', 'Submitted', 'Approved', 'Returned', 'Completed'],
    required: true,
  },
  by: { type: String, required: true },
  at: { type: Date, default: Date.now },
  from: { type: String, default: null },
  to: { type: String, default: null },
  comment: { type: String, default: null, trim: true },
}, { _id: true })

const taskSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  sprint: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null, index: true },
  title: { type: String, required: true, index: true },
  description: String,
  type: { type: String, enum: ['Task', 'Bug', 'Story', 'Improvement'], default: 'Task', index: true },
  status: { type: String, enum: ['Todo', 'In Progress', 'Review', 'Done'], default: 'Todo', index: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  severity: { type: String, enum: ['Minor', 'Major', 'Critical', 'Blocker'], default: 'Major' },
  assignee: String,
  reporter: String,
  storyPoints: { type: Number, default: 0 },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  dueDate: String,
  order: { type: Number, default: 0 },
  labels: [String],

  submissionStatus: {
    type: String,
    enum: ['Not Submitted', 'Submitted', 'Approved', 'Rejected', 'Returned'],
    default: 'Not Submitted',
    index: true,
  },
  submission: { type: taskSubmissionSchema, default: null },
  review: { type: taskReviewSchema, default: null },
  submissionHistory: { type: [taskSubmissionSchema], default: [] },
  reviewHistory: { type: [taskReviewSchema], default: [] },
  assignedBy: { type: String, default: null },

  assignmentStatus: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned'],
    default: 'Assigned',
    index: true,
  },
  history: { type: [taskHistorySchema], default: [] },
  viewedBy: { type: [String], default: [], index: true },

  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  durationSec: { type: Number, default: 0, min: 0 },
  pausedAt: { type: Date, default: null },
  pauseIntervals: [{
    from: { type: Date, required: true },
    to: { type: Date, default: null },
    reason: { type: String, default: '' },
  }],
  attachments: [{
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
    size: { type: Number, default: 0 },
    type: { type: String, default: 'file' },
  }],
}, opts)
taskSchema.index({ title: 'text', description: 'text' })

const milestoneSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  title: { type: String, required: true },
  description: String,
  dueDate: String,
  status: { type: String, enum: ['Upcoming', 'In Progress', 'Reached', 'Missed'], default: 'Upcoming', index: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
}, opts)
milestoneSchema.index({ title: 'text' })

const commentSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  task: { type: Schema.Types.ObjectId, ref: 'ProjectTask', default: null, index: true },
  author: { type: String, required: true },
  body: { type: String, required: true },
  viaClientPortal: { type: Boolean, default: false },
  edited: { type: Boolean, default: false },
  editedAt: { type: Date, default: null },
  parentComment: { type: Schema.Types.ObjectId, ref: 'ProjectComment', default: null, index: true },
  attachments: [{
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
    size: { type: Number, default: 0 },
  }],
}, opts)

const fileSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, default: 'file' },
  size: { type: Number, default: 0 },
  url: String,
  uploadedBy: String,
}, opts)
fileSchema.index({ name: 'text' })

const activitySchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  actor: { type: String, required: true },
  action: { type: String, required: true },
  target: String,
  meta: Schema.Types.Mixed,
}, opts)

export const Project = model('Project', projectSchema)
export const Sprint = model('Sprint', sprintSchema)
export const ProjectTask = model('ProjectTask', taskSchema)
export const Milestone = model('Milestone', milestoneSchema)
export const ProjectComment = model('ProjectComment', commentSchema)
export const ProjectFile = model('ProjectFile', fileSchema)
export const ProjectActivity = model('ProjectActivity', activitySchema)
