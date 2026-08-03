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

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['pdf', 'word', 'excel', 'image'], default: 'pdf' },
  category: { type: String, default: 'General' },
  size: Number,
  url: String,
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
    basic: Number, hra: Number, allowances: Number, pf: Number, tax: Number, net: Number,
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
    workLocation: { type: String, default: 'Bengaluru HQ' },
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
    this.salary.basic = Math.round(monthly * 0.5)
    this.salary.hra = Math.round(monthly * 0.2)
    this.salary.allowances = Math.round(monthly * 0.2)
    this.salary.pf = Math.round(this.salary.basic * 0.12)
    this.salary.tax = Math.round(monthly * 0.08)
    this.salary.net = this.salary.basic + this.salary.hra + this.salary.allowances - this.salary.pf - this.salary.tax
  }
  next()
})

export const Employee = mongoose.model('Employee', employeeSchema)
