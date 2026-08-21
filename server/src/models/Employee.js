import mongoose from 'mongoose'

// --- Sub-schemas ---
const skillSchema = new mongoose.Schema(
  { name: { type: String, required: true }, level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced', 'Expert'], default: 'Intermediate' } },
  { _id: false }
)

const certificateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  issuer: String,
  year: Number,
})

const experienceSchema = new mongoose.Schema({
  company: { type: String, required: true },
  role: String,
  from: String,
  to: String,
})

// PHASE ADMIN USER WIZARD (TASK 6): education entries captured by the Admin
// user-creation wizard (step 3) and displayed on the employee's own My Profile.
// The model previously had NO education sub-schema at all - the wizard is the
// first surface that collects it. `qualification` + `institution` are required
// per row (the wizard's validation rules mirror this); the rest are optional
// and free-form, matching the loose style of experienceSchema above.
const educationSchema = new mongoose.Schema({
  qualification: { type: String, required: true },
  institution: { type: String, required: true },
  fieldOfStudy: String,
  startYear: String,
  endYear: String,
  grade: String,
})

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['pdf', 'word', 'excel', 'image'], default: 'pdf' },
  category: { type: String, default: 'General' },
  size: Number,
  url: String,
  // PHASE: EMPLOYEE PROFILE SELF-SERVICE — additive metadata for PRIVATE
  // self-uploaded profile documents. `uploadedBy` is the User _id of the
  // employee who uploaded the file (documents are always tied to their owner's
  // Employee record, so no cross-user id is ever accepted from the client).
  // `diskName` is the filename on disk under the private profile-uploads/ dir;
  // `mimeType` preserves the real MIME type for preview/download headers.
  // Legacy docs (managed by Admin/Manager through /uploads) simply have none.
  uploadedBy: { type: String, default: null },
  diskName: { type: String, default: null },
  mimeType: { type: String, default: null },
  uploadedAt: { type: Date, default: Date.now },
})

const reviewSchema = new mongoose.Schema({
  period: String,
  reviewer: String,
  rating: { type: Number, min: 0, max: 5 },
  comment: String,
})

const emergencyContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  relation: String,
  phone: String,
})

const salarySchema = new mongoose.Schema(
  {
    ctc: { type: Number, default: 0 },
    // PHASE SALARY/PROJECT AUDIT (SALARY BUG 1) — `monthly` was MISSING from
    // this sub-schema even though the pre('save') hook below assigns it and
    // employeeService.update()'s own comment documents it as part of the stored
    // shape. Mongoose sub-schemas are strict by default, so `this.salary.monthly
    // = monthly` was silently discarded on every save and the field never
    // reached MongoDB. The Employee Detail -> Salary tab
    // (features/employees/detailTabs.jsx renders `formatCurrency(s.monthly)`)
    // therefore showed "₹0 / month" for every employee, for Admin/HR/Manager.
    // Declaring the path is the whole fix: the derivation already exists and is
    // not duplicated here.
    monthly: Number,
    // PHASE SALARY STRUCTURE REWORK: `hra` and `allowances` are REMOVED from
    // this sub-schema. The salary structure no longer splits monthly pay into
    // Basic + HRA + Allowances -- Gross Monthly Salary IS the Basic component
    // (Basic = 50% of gross, and there is nothing else added on top of it).
    // Mongoose sub-schemas are strict by default (see SALARY BUG 1 note above),
    // so simply no longer assigning `this.salary.hra` in the pre-save hook
    // below is enough to stop the fields being written going forward; the
    // paths are dropped here too so old stray values on existing documents
    // are not read back by anything (nothing in the app references
    // `salary.hra` / `salary.allowances` any more after this change).
    // `esi` is added alongside `pf` since the salary structure now has exactly
    // two statutory deductions (PF, ESI) and both belong on the stored salary
    // snapshot the same way `pf` already did.
    basic: Number, pf: Number, esi: Number, tax: Number, net: Number,
  },
  { _id: false }
)

const bankSchema = new mongoose.Schema(
  { name: String, account: String, ifsc: String },
  { _id: false }
)

// --- Main Employee schema ---
const employeeSchema = new mongoose.Schema(
  {
    empCode: { type: String, unique: true, index: true },
    // Linked login account (User._id). Set by identityLink so an Employee maps
    // back to its User; null for HR-only profiles.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: [true, 'Name is required'], trim: true, index: true },
    email: { type: String, required: [true, 'Email is required'], lowercase: true, trim: true },
    phone: { type: String, required: true },
    avatar: { type: String, default: '' },

    department: { type: String, required: true, index: true },
    designation: { type: String, required: true },
    employmentType: { type: String, enum: ['Full-time', 'Contract', 'Intern', 'Consultant'], default: 'Full-time' },
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` is REMOVED
    // (it defaulted to the hard-coded 'Bengaluru HQ'). Same non-destructive
    // rule as User.js: dropping the path leaves existing documents intact and
    // simply stops the application reading, writing or displaying the value.
    reportingTo: String,
    shift: { type: String, default: '' },

    dob: Date,
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    bloodGroup: String,
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Other'], default: 'Single' },
    address: String,

    joiningDate: Date,
    experienceYears: String,
    // Flat single emergency contact captured by the create form (the
    // `emergencyContacts` array below holds richer records added later).
    emergencyContact: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'On Leave', 'Inactive'], default: 'Active', index: true },
    performance: { type: Number, min: 0, max: 100, default: 70 },

    salary: { type: salarySchema, default: () => ({}) },
    bank: bankSchema,

    skills: [skillSchema],
    certificates: [certificateSchema],
    experience: [experienceSchema],
    // PHASE ADMIN USER WIZARD (TASK 6): academic history collected by the
    // wizard's Education step and shown on My Profile. Optional array - older
    // documents simply have none.
    education: [educationSchema],
    documents: [documentSchema],
    reviews: [reviewSchema],
    emergencyContacts: [emergencyContactSchema],
  },
  { timestamps: true }
)

// Text index powers search across key fields.
employeeSchema.index({ name: 'text', email: 'text', empCode: 'text', designation: 'text' })

// Indexes for filters used by list/detail endpoints (email is unique).
employeeSchema.index({ email: 1 }, { unique: true })

// Phase 5.7 (Task 4): allocate the next sequential employee code.
// The previous implementation used `SKW-${Math.floor(1000 + Math.random() *
// 9000)}`, which is only 9000 possible values against a `unique` index -- by
// the birthday bound a duplicate becomes likely after a few dozen employees,
// and the save then throws E11000. This walks forward from the highest
// existing sequential code and verifies the candidate is actually free.
const EMP_CODE_PREFIX = 'EMP'
async function nextEmpCode(Model) {
  const last = await Model
    .findOne({ empCode: new RegExp(`^${EMP_CODE_PREFIX}\\d+$`) })
    .sort({ empCode: -1 })
    .select('empCode')
    .lean()
  let n = last ? parseInt(String(last.empCode).slice(EMP_CODE_PREFIX.length), 10) : 0
  if (!Number.isFinite(n)) n = 0
  for (let i = 0; i < 100; i += 1) {
    n += 1
    const candidate = `${EMP_CODE_PREFIX}${String(n).padStart(3, '0')}`
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists({ empCode: candidate }))) return candidate
  }
  throw new Error('Unable to allocate a unique employee code')
}

// Auto-generate empCode + derive salary breakdown before insert.
// Phase 5.7 (Task 4): a MANUALLY ENTERED code is never touched -- the
// generator only runs when the field is genuinely empty.
employeeSchema.pre('save', async function (next) {
  if (!this.empCode) this.empCode = await nextEmpCode(this.constructor)
  if (this.salary?.ctc && !this.salary.basic) {
    const monthly = Math.round(this.salary.ctc / 12)
    this.salary.monthly = monthly
    // PHASE SALARY STRUCTURE REWORK: Basic is 50% of Gross Monthly Salary —
    // this ratio is unchanged from before. What is REMOVED is HRA and
    // Allowances as separate paid components that used to make up the other
    // 50% of gross; nothing fills that remainder any more, and gross itself
    // is NOT reduced to equal basic. Gross Monthly Salary (`monthly`) and
    // Basic Salary remain two distinct, both-real figures — exactly as the
    // brief's own worked example lists them (Gross ₹10,000, Basic ₹5,000 for
    // CTC ₹1,20,000) — this matches the payroll engine's own `computePayroll`
    // (payrollEngine.js), which is the other place this exact structure is
    // derived; keeping both sides of the split in agreement is the point of
    // this comment.
    this.salary.basic = Math.round(monthly * 0.5)
    this.salary.pf = Math.round(this.salary.basic * 0.12)
    // ESI is 0.75% of GROSS monthly pay (`monthly`, NOT `this.salary.basic`)
    // -- see payrollEngine.js for the authoritative formula and the
    // ESI_GROSS_CEILING it applies. Mirrored here, rounded the same way,
    // purely so the Employee Detail -> Salary tab (read from this stored
    // snapshot, not from the payroll engine) shows a number that agrees with
    // the engine's own computation for the same employee.
    this.salary.esi = Math.round(monthly * 0.0075)
    // PHASE SALARY/BILLING (TASK 5): TDS is no longer applied anywhere in the
    // salary flow, and this pre-save hook is part of that flow — it is where the
    // stored structure's own `net` is derived. It previously did
    //     tax = monthly × 0.08 ; net = basic + hra + allowances − pf − tax
    // so leaving it alone would have kept an 8 % income-tax deduction reducing
    // the Net Salary shown on the Employee Detail -> Salary tab, i.e. exactly
    // the "hidden deduction still reducing Net" the brief forbids, even after
    // the payroll engine stopped applying it.
    //
    // The `tax` PATH stays on salarySchema and is written as 0 rather than being
    // deleted: existing Employee documents already store a value, and dropping
    // the path would make Mongoose ignore it rather than correct it. Setting it
    // to 0 on derivation is what makes the removal take effect.
    this.salary.tax = 0
    // PHASE SALARY STRUCTURE REWORK: Net is Gross (`monthly`) minus the valid
    // deductions -- NOT Basic minus deductions. The brief's own worked
    // example computes Net as "₹10,000 − ₹675", i.e. against the ₹10,000
    // GROSS figure, not the ₹5,000 Basic figure. Net is therefore larger than
    // Basic by construction (the un-itemised remainder of gross that used to
    // be HRA/Allowances flows straight through to Net now, rather than being
    // paid out as a named component).
    this.salary.net = monthly - this.salary.pf - this.salary.esi
  }
  next()
})

export const Employee = mongoose.model('Employee', employeeSchema)
