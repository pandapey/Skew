import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const ROLES = ['Admin', 'Manager', 'Employee', 'Client']

// Retired roles are folded into the role that inherited their permissions.
// Phase 4:  Super Admin -> Admin  (Admin is now the highest authority)
//           Sales       -> HR
//           Finance     -> HR
// Phase 5:  Inventory   -> HR      (HR now owns the Inventory module)
// Phase 7.2: HR is retired entirely and merged into Manager. Manager is the
//            ONLY role that owns the former HR surface (people, recruitment,
//            payroll, performance, finance), so every legacy role that used to
//            fold into HR now folds into Manager.
// Kept exported so every layer (auth middleware, migration script, seed) uses
// ONE mapping instead of re-declaring it.
export const LEGACY_ROLE_MAP = Object.freeze({
  'Super Admin': 'Admin',
  HR: 'Manager',
  Sales: 'Manager',
  Finance: 'Manager',
  Inventory: 'Manager',
})

// Phase 5 — gender. Required for NEW accounts (enforced in userController), but
// intentionally NOT `required` at the schema level: thousands of pre-existing
// documents have no gender and must keep loading, saving and authenticating.
// `null` is an explicit enum member so those legacy docs stay schema-valid, and
// it is the safe default until an admin fills it in.
export const GENDERS = ['Male', 'Female']

// Normalize any role string (legacy or current) to a role in the enum above.
export const normalizeRole = (role) => LEGACY_ROLE_MAP[role] || role

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 5, select: false },
    role: { type: String, enum: ROLES, default: 'Employee' },
    // See GENDERS above: `null` is permitted so legacy accounts keep working.
    gender: { type: String, enum: [...GENDERS, null], default: null },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    avatar: { type: String, default: '' },
    // Links a `Client`-role user to their Client record ( drives the isolated
    // Client Portal: every /api/client/* query is scoped by this id ).
    clientId: { type: String, default: '' },
    phone: { type: String, default: '' },
    // Account lifecycle status. Only `Active` users may authenticate.
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended', 'Pending', 'Blocked'],
      default: 'Active',
    },
    lastLogin: { type: Date },
    // Admin-authored private notes about the account (persisted to MongoDB).
    notes: { type: String, default: '' },
    // Optional business identifiers surfaced in the admin UI.
    employeeId: { type: String, default: '' },
    clientCode: { type: String, default: '' },
    // Linked HR profile (Employee.empCode) — kept in sync by identityLink so
    // every staff login maps to an Employee directory entry.
    empCode: { type: String, default: '' },
    // Extended HR fields shared with the linked Employee record. Populated from
    // either create form (Admin → Users or Employees) and synced by identityLink.
    employmentType: { type: String, default: 'Full-time' },
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` is REMOVED.
    // It was used for exactly one thing - the employee/company Work Location
    // shown on the user + employee forms - and that concept is retired.
    //
    // NON-DESTRUCTIVE BY DESIGN: removing the schema PATH does not touch stored
    // documents. Mongoose is strict by default, so an existing User document
    // that still carries `workLocation` simply stops being mapped, stops being
    // written and stops being read. No migration is run and no data is deleted.
    // See the phase report for the optional (and purely cosmetic) $unset.
    joiningDate: { type: Date },
    experienceYears: { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
    salaryCtc: { type: Number, default: 0 },
    // Reporting manager + assigned shift — role-driven fields captured by the
    // unified Admin → Users create form and synced onto the Employee record.
    reportingManager: { type: String, default: '' },
    // Phase 5.9 (Task 1): the downward counterpart of `reportingManager`.
    // An Employee reports UP to one manager; a Manager owns a team DOWNWARD.
    // Additive and optional — every pre-existing User document keeps validating
    // unchanged and simply reads back as an empty array.
    reportingTeam: { type: [String], default: [] },
    shift: { type: String, default: '' },
    resetToken: { type: String, select: false },
    resetTokenExpiry: { type: Date, select: false },
  },
  { timestamps: true }
)

// Hash password before save.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 10)
  next()
})

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password)
}

// Indexes for common query/filter patterns. `email` is already indexed via
// `unique: true` on the path above, so we only declare the role index here.
userSchema.index({ role: 1 })

export const User = mongoose.model('User', userSchema)
