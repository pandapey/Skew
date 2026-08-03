import mongoose from 'mongoose'

// Client organisations. A `Client`-role User is linked to one of these via
// User.clientId === Client.clientId. Every client-portal record is scoped by
// `clientId`, so clients only ever see their own data.
const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true }, // e.g. "cl-1"
    company: { type: String, required: true },
    contactPerson: { type: String, default: '' },
    designation: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    gst: { type: String, default: '' },
    industry: { type: String, default: '' },
    plan: { type: String, default: 'Business' },
    status: { type: String, default: 'Active' },
    // Phase 6.9 (TASK 10): `accountManager` REMOVED from the Client schema.
    // It was a free-text name captured on the creation form that duplicated
    // information already carried by the real relationships (the project's
    // `projectManager` / lead and the assigned team), and it was never used to
    // drive any behaviour - only to render a label. Removing the schema path
    // stops it being written or returned. Backward compatible: Mongoose simply
    // ignores the stray key on documents created before this phase, so no
    // migration is required and no existing document fails to load.
    joinedDate: { type: String, default: '' },
    address: { type: String, default: '' },
    website: { type: String, default: '' },
    notes: { type: String, default: '' },
    // Phase 5.9 (Task 1): optional project type captured on the unified
    // Admin → Create User form when Role = Client. Additive with a safe default,
    // so every pre-existing Client document keeps validating unchanged.
    projectType: { type: String, default: '' },
    // Phase 6.3 (Task 2): Employees assigned to this client at creation time,
    // stored as names to match how `Project.members[].name`,
    // `ClientProject.team[].name` and `User.reportingTeam` already reference
    // people across this codebase (there is no ObjectId-based membership
    // anywhere to be consistent with). Additive with a safe default, so every
    // pre-existing Client document keeps validating unchanged.
    projectMembers: { type: [String], default: [] },
    // Phase 6.4 (TASK 2): project-level fields captured at client creation.
    projectName: { type: String, default: '' },
    projectCode: { type: String, default: '' },
    projectDescription: { type: String, default: '' },
    // --- Phase 5.7 (Task 3): commercial terms captured at client creation and
    // consumed by the Finance module. All optional with safe defaults, so every
    // pre-existing Client document keeps validating unchanged.
    advancePayment: { type: Number, default: 0 },
    monthlyDue: { type: Number, default: 0 },
    // Phase 6.9 (TASK 11): `paymentTerms` REMOVED from the Client schema.
    // `billingCycle` and `paymentMode` remain - those two still drive Finance.
    billingCycle: { type: String, default: 'Monthly' },
    paymentMode: { type: String, default: 'Bank Transfer' },
  },
  { timestamps: true }
)

// Index on email for client lookups.
clientSchema.index({ email: 1 })

// --- Embedded sub-documents for a client project ---
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    assignee: { type: String, default: '' },
    priority: { type: String, default: 'Medium' },
    status: { type: String, default: 'Todo' },
    completion: { type: Number, default: 0 },
    due: { type: String, default: '' },
    comments: { type: [String], default: [] },
  },
  { _id: true }
)

const timelineStageSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    status: { type: String, default: 'Pending' }, // Pending | In Progress | Completed
    date: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: true }
)

const teamMemberSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    roleInProject: { type: String, default: 'Member' },
    position: { type: String, default: '' },
    department: { type: String, default: '' },
    availability: { type: String, default: 'Available' },
    avatar: { type: String, default: '' },
  },
  { _id: false }
)

const activitySchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    at: { type: String, default: '' },
    by: { type: String, default: '' },
  },
  { _id: true }
)

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    type: { type: String, default: '' }, // Proposal | Quotation | Requirement | Design | Manual | ...
    size: { type: String, default: '' },
    uploadedBy: { type: String, default: '' },
    uploadedAt: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: true }
)

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    status: { type: String, default: 'Pending' }, // Paid | Partial Payment | Pending | Overdue
    date: { type: String, default: '' },
    method: { type: String, default: 'Bank Transfer' },
  },
  { _id: true }
)

const clientProjectSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, unique: true }, // e.g. "cp-1"
    // Phase 5.4 (Task 4): explicit back-reference to the real internal Project
    // this row mirrors. Needed because `projectId` only encodes the LAST 6
    // characters of the Mongo _id (`cp-<last6>`) and is therefore not safely
    // reversible - so client-portal features that must read/write the shared
    // internal collections (ProjectComment) had no reliable way back to the
    // real Project. Optional (not required/unique) so rows created before this
    // field remain valid; syncClientProject backfills it on every sync.
    sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    clientId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, default: '' },
    status: { type: String, default: 'Planning' },
    progress: { type: Number, default: 0 },
    priority: { type: String, default: 'Medium' },
    startDate: { type: String, default: '' },
    deliveryDate: { type: String, default: '' },
    // Phase 6.9 (TASK 10): removed from the client-facing project mirror too;
    // `projectManager` below is the real, derived owner.
    projectManager: { type: String, default: '' },
    budget: { type: Number, default: 0 },
    timeline: { type: [timelineStageSchema], default: [] },
    team: { type: [teamMemberSchema], default: [] },
    tasks: { type: [taskSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
    documents: { type: [documentSchema], default: [] },
    payments: { type: [paymentSchema], default: [] },
  },
  { timestamps: true }
)

// Phase 6.9 (Task 17) ROOT CAUSE FIX: ClientMeeting used to be a THIRD,
// disconnected meetings table (separate from CalendarEvent, and the
// now-removed ProjectCalendar) with its own time-based status vocabulary
// ('upcoming'/'past'/'cancelled'), invisible to the real Calendar and to
// Admin/HR/Manager/Project-Lead RBAC. Meetings now live directly on the real
// CalendarEvent model (clientId/projectId/meetingStatus fields in
// calendarModels.js) - one shared source of truth for every meeting.

const clientAnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    date: { type: String, default: '' },
    tag: { type: String, default: 'Update' },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
)

const clientMessageSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    subject: { type: String, default: '' },
    participants: { type: [String], default: [] },
    messages: [
      {
        from: { type: String, default: '' },
        at: { type: String, default: '' },
        text: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
)

const clientNotificationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    at: { type: String, default: '' },
    read: { type: Boolean, default: false },
    icon: { type: String, default: 'update' },
  },
  { timestamps: true }
)

export const Client = mongoose.model('Client', clientSchema)
export const ClientProject = mongoose.model('ClientProject', clientProjectSchema)
export const ClientAnnouncement = mongoose.model('ClientAnnouncement', clientAnnouncementSchema)
export const ClientMessage = mongoose.model('ClientMessage', clientMessageSchema)
export const ClientNotification = mongoose.model('ClientNotification', clientNotificationSchema)
