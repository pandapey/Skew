import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// --- Leave Type (policy) ---
const leaveTypeSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, uppercase: true },
  allocated: { type: Number, default: 0 },
  color: { type: String, default: '#2563EB' },
  paid: { type: Boolean, default: true },
  carryForward: { type: Boolean, default: false },
  // Only active types appear in the Apply-Leave dropdown & balance cards.
  // Existing docs without this field are treated as active (see { $ne: false }).
  active: { type: Boolean, default: true },

  // --- Phase 5: gender-based visibility ---
  // Which gender a leave type applies to. 'Any' (the default) means everyone
  // sees it, so every EXISTING leave type keeps its current behaviour with no
  // backfill required.
  //
  // This is stored as DATA rather than inferred from the type's name. Matching
  // on the string "Maternity"/"Paternity" would be a hardcoded rule that breaks
  // the moment a company renames a type, translates it, or adds another
  // gender-specific policy. Making it a field means HR configures it from the
  // Leave Types screen and the rule lives in MongoDB, not in the source.
  genderRestriction: { type: String, enum: ['Any', 'Male', 'Female'], default: 'Any' },
}, opts)
leaveTypeSchema.index({ name: 'text', code: 'text' })

// --- Leave Balance (per employee per type) ---
const leaveBalanceSchema = new Schema({
  employee: { type: String, required: true, index: true },
  type: { type: String, required: true },
  code: String,
  color: String,
  allocated: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
}, opts)
leaveBalanceSchema.index({ employee: 1, type: 1 }, { unique: true })

// --- Approval workflow step (subdocument) ---
// `note` carries the actor's comment. Phase 4 makes this MANDATORY for the
// Approved / Rejected stages (enforced in leaveService.decide).
const workflowStepSchema = new Schema({
  stage: String,
  by: String,
  at: { type: Date, default: Date.now },
  note: String,
  done: { type: Boolean, default: true },
}, { _id: false })

// --- Phase 4: denormalised decision record (subdocument) ---
// The workflow array is the full audit trail; this is the flat, indexed
// projection of the FINAL decision so leave history tables, leave details and
// leave reports can render "who decided, what they said, and when" without
// scanning the workflow array on every row.
const leaveDecisionSchema = new Schema({
  action: { type: String, enum: ['Approved', 'Rejected'] },
  comment: { type: String, trim: true },
  by: String,
  at: { type: Date },
}, { _id: false })

// --- Leave Request ---
const leaveRequestSchema = new Schema({
  employee: { type: String, required: true, index: true },
  empCode: String,
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  department: { type: String, index: true },
  type: { type: String, required: true },
  typeCode: String,
  from: { type: String, required: true },
  to: { type: String, required: true },
  // Phase 4: minimum lowered from 1 to 0.5 so a half-day request is storable.
  // Sundays are already excluded from this figure by resolveLeaveDuration().
  // Phase 5.5 (Task 4): floor lowered again from 0.5 to 0, because an Hourly
  // Permission consumes HOURS rather than days and is stored here with
  // days: 0. Relaxing a minimum is backward compatible — every existing
  // document (>= 0.5) remains valid under the wider rule.
  days: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true },

  // --- Phase 4: half-day leave ---
  // A half-day is a DURATION MODIFIER on a paid leave type, not a separate
  // balance bucket, so it deducts 0.5 from that type's existing allocation.
  halfDay: { type: Boolean, default: false },
  halfDaySession: { type: String, enum: ['First Half', 'Second Half', null], default: null },

  // --- Phase 4: Sunday exclusion audit ---
  // How many Sundays the requested range spanned that were NOT charged.
  // Persisted so reports/payroll can explain the difference between the
  // calendar span and the chargeable days without recomputing.
  sundaysExcluded: { type: Number, default: 0 },

  // --- Phase 5.5 (Task 4): hourly permission -------------------------------
  // Hourly permissions live in THIS collection rather than a new one, so they
  // inherit the entire existing approval pipeline for free: the same Pending/
  // Approved/Rejected/Cancelled/Expired states, the same approve/reject
  // endpoints and mandatory approver comment, the same workflow audit trail,
  // the same notifications, and the same reporting queries. A separate
  // collection would have meant duplicating all of that.
  //
  // `requestKind` defaults to 'Leave', so every pre-existing document is
  // automatically and correctly classified without a migration.
  requestKind: {
    type: String,
    enum: ['Leave', 'Hourly Permission'],
    default: 'Leave',
    index: true,
  },
  // Hours requested. Null for ordinary leave; > 0 for an hourly permission.
  hours: { type: Number, default: null, min: 0 },

  // Phase 5: 'Expired' is terminal. A Pending request that was never actioned
  // before its shift start time is swept into this state. It stays fully
  // visible in history and reports but can no longer be approved, rejected,
  // edited or cancelled.
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired'], default: 'Pending', index: true },
  appliedAt: { type: Date, default: Date.now },
  approver: String,

  // --- Phase 5: expiry + HR reminder bookkeeping ---
  // The exact instant this request stops being actionable (leave start date at
  // the employee's shift start time). Computed and stored on apply so the
  // sweeper is a cheap indexed query instead of a full recompute per document.
  expiresAt: { type: Date, default: null, index: true },
  expiredAt: { type: Date, default: null },
  // Which reminder milestones have already been emitted for this request
  // (values: '24h' | '12h' | '2h'). This is the idempotency key that makes
  // "each user receives only one notification" true even if the scheduler
  // runs repeatedly, overlaps, or the process restarts mid-cycle.
  remindersSent: { type: [String], default: [] },
  // Flat projection of the final Approve/Reject decision (see schema above).
  decision: { type: leaveDecisionSchema, default: null },
  workflow: [workflowStepSchema],
}, opts)
leaveRequestSchema.index({ employee: 'text', empCode: 'text', reason: 'text' })

export const LeaveType = model('LeaveType', leaveTypeSchema)
export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema)
export const LeaveRequest = model('LeaveRequest', leaveRequestSchema)
