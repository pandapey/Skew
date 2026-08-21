import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// --- Project member (subdocument) ---
const memberSchema = new Schema({
  name: { type: String, required: true },
  role: { type: String, default: 'Member' }, // Lead, Member, QA, Designer…
  avatar: String,
}, { _id: false })

// --- Project ---
const projectSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  code: { type: String, uppercase: true, trim: true },
  client: String,
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
  // --- Commercial terms (per engagement, not per account) ---
  // These six were CLIENT-only columns, so a client with several projects could
  // only ever record ONE advance/monthly-due/billing-cycle. They are declared
  // HERE with the same names and defaults the Client columns already use:
  // additive (the Client columns stay for existing readers), and before this
  // declaration Mongoose's strict mode silently discarded them from POST /project.
  advancePayment: { type: Number, default: 0, min: 0 },
  monthlyDue: { type: Number, default: 0, min: 0 },
  billingCycle: { type: String, default: 'Monthly' },
  // Named `paymentMode` (not `paymentMethod`) deliberately: that is the column
  // Client already uses and the key clientAdvanceService reads — ONE name for
  // the concept across the codebase, UI-labelled "Payment Method".
  paymentMode: { type: String, default: 'Bank Transfer' },
  website: { type: String, default: '' },
  // Free-form String, exactly like `Client.plan`: the Plan collection is a
  // CATALOGUE, not a foreign key, so a project keeps reading back the plan name
  // it was saved with even after that plan is renamed or deleted.
  plan: { type: String, default: '' },
}, opts)
projectSchema.index({ name: 'text', code: 'text', client: 'text' })

// Index on the client link for filtered project listings.
projectSchema.index({ client: 1 })

// Project codes are the business-facing Project ID (PRJ001…). The generator
// below keeps them unique, and the sparse unique index enforces it at the DB
// level. Sparse so documents without a code (pre-migration rows) coexist; the
// migrate-project-codes migration backfills every project with a sequential
// code before this takes effect on existing data.
projectSchema.index({ code: 1 }, { unique: true, sparse: true })

// Project ID standardisation: allocate the next sequential project code.
// Mirrors the Employee nextEmpCode() generator — walks forward from the highest
// existing sequential code and verifies the candidate is free, so concurrent
// creates cannot collide. Runs only when `code` is empty; a manually assigned
// code is never touched.
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
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists({ code: candidate }))) return candidate
  }
  throw new Error('Unable to allocate a unique project code')
}

projectSchema.pre('save', async function (next) {
  if (!this.code) this.code = await nextProjectCode(this.constructor)
  next()
})

// --- Sprint ---
const sprintSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true },
  goal: String,
  startDate: String,
  endDate: String,
  status: { type: String, enum: ['Planned', 'Active', 'Completed'], default: 'Planned', index: true },
}, opts)
sprintSchema.index({ name: 'text', goal: 'text' })

// --- Task submission (subdocument) ---
// Written when an assignee presses "Submit Task". `at` is a real Date; the UI
// derives "Submitted Date" / "Submitted Time" from it so there is a single
// authoritative timestamp rather than two drifting strings.
const taskSubmissionSchema = new Schema({
  by: { type: String, required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
  // Optional attachment metadata (files are project-scoped, so a submission
  // links to the ProjectFile it created — no parallel storage mechanism).
  attachment: {
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
  },
}, { _id: false })

// --- Project-lead review of a submission (subdocument) ---
const taskReviewSchema = new Schema({
  reviewer: { type: String, required: true },
  // 'Rejected' = refused outright; 'Returned' = reviewed and sent back for
  // rework. Appending the enum value is backward compatible.
  status: { type: String, enum: ['Approved', 'Rejected', 'Returned'], required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
}, { _id: false })

// --- Unified task history (subdocument) ---
// The chronological SPINE of a task's life: submissionHistory/reviewHistory
// record their own types in detail but neither can answer "what happened to
// this task, in order?". Embedded on the task (no duplicate collection), and
// does NOT replace those richer, type-specific histories — it indexes them
// plus the events they cannot express (assignment, reassignment, pause).
const taskHistorySchema = new Schema({
  event: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned', 'Started', 'Paused', 'Resumed', 'Submitted', 'Approved', 'Returned', 'Completed'],
    required: true,
  },
  by: { type: String, required: true },
  at: { type: Date, default: Date.now },
  // Populated only for transitions that move the task between people or
  // states, e.g. Reassigned { from: 'Asha', to: 'Ravi' }.
  from: { type: String, default: null },
  to: { type: String, default: null },
  comment: { type: String, default: null, trim: true },
}, { _id: true })

// --- Task / Bug ---
const taskSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  sprint: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null, index: true },
  title: { type: String, required: true, index: true },
  description: String,
  type: { type: String, enum: ['Task', 'Bug', 'Story', 'Improvement'], default: 'Task', index: true },
  status: { type: String, enum: ['Todo', 'In Progress', 'Review', 'Done'], default: 'Todo', index: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  severity: { type: String, enum: ['Minor', 'Major', 'Critical', 'Blocker'], default: 'Major' }, // for bugs
  assignee: String,
  reporter: String,
  storyPoints: { type: Number, default: 0 },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  dueDate: String,
  order: { type: Number, default: 0 }, // position within a kanban column
  labels: [String],

  // --- Submission & review workflow ---
  // `submissionStatus` is deliberately SEPARATE from the kanban `status` so the
  // board logic (Todo/In Progress/Review/Done) keeps working untouched:
  //   Not Submitted -> Submitted -> Approved | Rejected | Returned
  // A rejected task returns to "Not Submitted" only when the employee resubmits,
  // which appends a new entry to the history below.
  submissionStatus: {
    type: String,
    enum: ['Not Submitted', 'Submitted', 'Approved', 'Rejected', 'Returned'],
    default: 'Not Submitted',
    index: true,
  },
  // Latest submission / review, for cheap list rendering and review queues.
  submission: { type: taskSubmissionSchema, default: null },
  review: { type: taskReviewSchema, default: null },
  // Append-only audit trail powering the employee-facing "Task History".
  // Resubmissions after a rejection are preserved rather than overwritten.
  submissionHistory: { type: [taskSubmissionSchema], default: [] },
  reviewHistory: { type: [taskReviewSchema], default: [] },
  // Who created/assigned the task — used to route the review request back to
  // the project lead who assigned it (Part 8).
  assignedBy: { type: String, default: null },

  // --- Assignment acceptance workflow ---
  // A THIRD, independent axis, separate from kanban `status` and
  // `submissionStatus`: "has the assignee agreed to do this work?" Defaults to
  // 'Assigned', so every existing row is valid with zero migration.
  assignmentStatus: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned'],
    default: 'Assigned',
    index: true,
  },
  // Append-only unified timeline. See taskHistorySchema above.
  history: { type: [taskHistorySchema], default: [] },
  // PHASE: EMPLOYEE TASK READ STATE — user _ids (as strings) who have viewed
  // this task. Powers the "unread" badge on My Tasks; `viewedBy` is appended
  // only by the task's own assignee, never by a third party.
  viewedBy: { type: [String], default: [], index: true },

  // --- Server-side task timer ---
  // Persisted on the task (not a client-side stopwatch): `startedAt` is set once
  // on Start and stays put across re-starts after a Returned/Rejected
  // resubmission; `completedAt` + `durationSec` are written by the SUBMIT
  // endpoint, so the recorded duration is authoritative even across reloads.
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  durationSec: { type: Number, default: 0, min: 0 },
  // Pause/resume: `pausedAt` is non-null ONLY while paused. `pauseIntervals`
  // is append-only; each entry is closed (gets a `to`) on resume or submit, so
  // durationSec is derivable as start minus the sum of paused spans.
  pausedAt: { type: Date, default: null },
  pauseIntervals: [{
    from: { type: Date, required: true },
    to: { type: Date, default: null },
    reason: { type: String, default: '' },
  }],
  // Task-level attachments (file metadata; actual bytes live in /uploads via
  // ProjectFile). Mirrors the ProjectFile shape used by comments/documents so
  // there is exactly one storage mechanism.
  attachments: [{
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
    size: { type: Number, default: 0 },
    type: { type: String, default: 'file' },
  }],
}, opts)
taskSchema.index({ title: 'text', description: 'text' })

// --- Milestone ---
const milestoneSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  title: { type: String, required: true },
  description: String,
  dueDate: String,
  status: { type: String, enum: ['Upcoming', 'In Progress', 'Reached', 'Missed'], default: 'Upcoming', index: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
}, opts)
milestoneSchema.index({ title: 'text' })

// --- Comment (on a project or task) ---
const commentSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  task: { type: Schema.Types.ObjectId, ref: 'ProjectTask', default: null, index: true },
  author: { type: String, required: true },
  body: { type: String, required: true },
  // Marks a comment posted from the Client Portal, so the ONE shared thread
  // (same collection for both audiences) can badge client messages distinctly
  // in the internal UI. Defaults to false for pre-existing comments.
  viaClientPortal: { type: Boolean, default: false },
  // Project Communication Center extensions to the SAME collection (no
  // duplicate comment system) — all optional with safe defaults.
  edited: { type: Boolean, default: false },
  editedAt: { type: Date, default: null },
  // A reply to another comment in the same thread (project or task scoped).
  parentComment: { type: Schema.Types.ObjectId, ref: 'ProjectComment', default: null, index: true },
  // Attachments reuse the existing ProjectFile store — this only references
  // files already uploaded there, it does not invent parallel storage.
  attachments: [{
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
    size: { type: Number, default: 0 },
  }],
}, opts)

// --- File (attachment metadata) ---
const fileSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, default: 'file' }, // pdf, image, doc, zip…
  size: { type: Number, default: 0 },
  url: String,
  uploadedBy: String,
}, opts)
fileSchema.index({ name: 'text' })

// --- Activity feed entry ---
const activitySchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  actor: { type: String, required: true },
  action: { type: String, required: true }, // "created task", "moved to Done", "commented"…
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
