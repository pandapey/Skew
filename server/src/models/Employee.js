import mongoose from 'mongoose'

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
  uploadedBy: { type: String, default: null },
  // MongoDB Atlas (GridFS) — `diskName`/`fileId` hold the GridFS file _id for new docs.
  // Legacy local-disk filenames may still exist on old docs (read-only fallback).
  diskName: { type: String, default: null },
  fileId: { type: String, default: null },
  mimeType: { type: String, default: null },
  contentType: { type: String, default: null },
  storage: { type: String, enum: ['gridfs', 'legacy'], default: 'gridfs' },
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
    monthly: Number,
    basic: Number, pf: Number, esi: Number, tax: Number, net: Number,
  },
  { _id: false }
)

const bankSchema = new mongoose.Schema(
  { name: String, account: String, ifsc: String },
  { _id: false }
)

const employeeSchema = new mongoose.Schema(
  {
    empCode: { type: String, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: [true, 'Name is required'], trim: true, index: true },
    email: { type: String, required: [true, 'Email is required'], lowercase: true, trim: true },
    phone: { type: String, required: true },
    avatar: { type: String, default: '' },

    department: { type: String, required: true, index: true },
    designation: { type: String, required: true },
    employmentType: { type: String, enum: ['Full-time', 'Contract', 'Intern', 'Consultant'], default: 'Full-time' },
    reportingTo: String,
    shift: { type: String, default: '' },

    dob: Date,
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    bloodGroup: String,
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Other'], default: 'Single' },
    address: String,

    joiningDate: Date,
    experienceYears: String,
    emergencyContact: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'On Leave', 'Inactive'], default: 'Active', index: true },
    performance: { type: Number, min: 0, max: 100, default: 70 },

    salary: { type: salarySchema, default: () => ({}) },
    bank: bankSchema,

    skills: [skillSchema],
    certificates: [certificateSchema],
    experience: [experienceSchema],
    education: [educationSchema],
    documents: [documentSchema],
    reviews: [reviewSchema],
    emergencyContacts: [emergencyContactSchema],
  },
  { timestamps: true }
)

employeeSchema.index({ name: 'text', email: 'text', empCode: 'text', designation: 'text' })

employeeSchema.index({ email: 1 }, { unique: true })

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

    if (!(await Model.exists({ empCode: candidate }))) return candidate
  }
  throw new Error('Unable to allocate a unique employee code')
}

employeeSchema.pre('save', async function (next) {
  if (!this.empCode) this.empCode = await nextEmpCode(this.constructor)
  if (this.salary?.ctc && !this.salary.basic) {
    const monthly = Math.round(this.salary.ctc / 12)
    this.salary.monthly = monthly
    this.salary.basic = Math.round(monthly * 0.5)
    this.salary.pf = Math.round(this.salary.basic * 0.12)
    this.salary.esi = Math.round(monthly * 0.0075)
    this.salary.tax = 0
    this.salary.net = monthly - this.salary.pf - this.salary.esi
  }
  next()
})

export const Employee = mongoose.model('Employee', employeeSchema)
