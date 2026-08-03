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
}, opts)
projectSchema.index({ name: 'text', code: 'text', client: 'text' })

// Index on the client link for filtered project listings.
projectSchema.index({ client: 1 })

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

// --- Phase 4: task submission (subdocument) ---
// Written when an assignee presses "Submit Task". Stores the comment plus the
// exact submitted date & time. `at` is a real Date; the UI derives the separate
// "Submitted Date" / "Submitted Time" columns from it so there is a single
// authoritative timestamp rather than two drifting string fields.
const taskSubmissionSchema = new Schema({
  by: { type: String, required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
  // Optional attachment metadata, mirroring the existing ProjectFile shape.
  // Task-level attachments are NOT natively supported by the current schema
  // (files are project-scoped), so a submission links to the ProjectFile it
  // created instead of inventing a parallel storage mechanism.
  attachment: {
    fileId: { type: Schema.Types.ObjectId, ref: 'ProjectFile', default: null },
    name: { type: String, default: null },
    url: { type: String, default: null },
  },
}, { _id: false })

// --- Phase 4: project-lead review of a submission (subdocument) ---
const taskReviewSchema = new Schema({
  reviewer: { type: String, required: true },
  // Phase 5.5 (Task 5): 'Returned' added. 'Rejected' means the submission was
  // refused outright; 'Returned' means it was reviewed and sent back for
  // rework. Appending an enum value is backward compatible -- existing
  // documents keep validating.
  status: { type: String, enum: ['Approved', 'Rejected', 'Returned'], required: true },
  comment: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
}, { _id: false })

// --- Phase 5.5 (Task 5): unified task history (subdocument) ---
// The chronological SPINE of a task's life. `submissionHistory` and
// `reviewHistory` already record their own event types in detail, but neither
// can answer "what happened to this task, in order?" -- assignment,
// acceptance, decline and reassignment were never recorded anywhere at all.
// This schema stitches every event type into ONE ordered timeline.
//
// Deliberately EMBEDDED on the task rather than a new collection: the brief
// forbids duplicate task collections, and history is only ever read in the
// context of its parent task. It does NOT replace submissionHistory /
// reviewHistory -- those keep their richer, type-specific payloads (attachment
// refs, reviewer identity) and remain the source of truth for the review
// queue. This is the index over them, plus the events they cannot express.
const taskHistorySchema = new Schema({
  event: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned', 'Submitted', 'Approved', 'Returned', 'Completed'],
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

  // --- Phase 4: submission & review workflow ---
  // `submissionStatus` is deliberately SEPARATE from the kanban `status` so the
  // existing board logic (Todo/In Progress/Review/Done) keeps working untouched.
  //   Not Submitted -> Submitted -> Approved | Rejected
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

  // --- Phase 5.5 (Task 5): assignment acceptance workflow ---
  // A THIRD, independent axis, separate from both the kanban `status` and
  // `submissionStatus`. "Has the assignee agreed to do this work?" is not the
  // same question as "how far along is it?" or "did it pass review?", and
  // collapsing them would break the existing board and review-queue logic.
  // Defaulting to 'Assigned' means every existing row is already valid and
  // behaves exactly as it does today -- zero migration required.
  assignmentStatus: {
    type: String,
    enum: ['Assigned', 'Accepted', 'Rejected', 'Reassigned'],
    default: 'Assigned',
    index: true,
  },
  // Append-only unified timeline. See taskHistorySchema above.
  history: { type: [taskHistorySchema], default: [] },
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
  // Phase 5.4 (Task 4): marks a comment posted from the Client Portal, so the
  // ONE shared thread (same collection for both audiences - no duplicate
  // store, no drift) can badge client messages distinctly in the internal UI.
  // Defaults to false, so every pre-existing comment stays correctly internal.
  viaClientPortal: { type: Boolean, default: false },
  // Phase 5.8 (Task 2): Project Communication Center extensions to the SAME
  // collection (no duplicate comment/chat system). All optional with safe
  // defaults so every pre-existing ProjectComment document keeps validating.
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
