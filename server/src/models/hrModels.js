import mongoose from 'mongoose'

const { Schema, model } = mongoose

// Shared options: timestamps on every HR collection.
const opts = { timestamps: true }

// --- Department ---
const departmentSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  head: String,
  headcount: { type: Number, default: 0 },
  budget: { type: Number, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, opts)
departmentSchema.index({ name: 'text', code: 'text', head: 'text' })

// --- Designation ---
const designationSchema = new Schema({
  title: { type: String, required: true, index: true },
  department: { type: String, required: true, index: true },
  level: { type: String, default: 'L2' },
  grade: { type: String, default: 'G3' },
  count: { type: Number, default: 0 },
}, opts)
designationSchema.index({ title: 'text', department: 'text' })

// --- Job Opening ---
const jobOpeningSchema = new Schema({
  title: { type: String, required: true, index: true },
  department: { type: String, required: true, index: true },
  location: String,
  type: { type: String, enum: ['Full-time', 'Contract', 'Intern', 'Consultant'], default: 'Full-time' },
  openings: { type: Number, default: 1 },
  applicants: { type: Number, default: 0 },
  experience: String,
  status: { type: String, enum: ['Open', 'On Hold', 'Closed'], default: 'Open', index: true },
  postedAt: { type: Date, default: Date.now },
}, opts)
jobOpeningSchema.index({ title: 'text', department: 'text', location: 'text' })

// --- Candidate ---
const candidateSchema = new Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, required: true, lowercase: true },
  phone: String,
  position: { type: String, required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'JobOpening' },
  experience: String,
  source: { type: String, enum: ['LinkedIn', 'Referral', 'Naukri', 'Website', 'Indeed'], default: 'Website' },
  stage: { type: String, enum: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'], default: 'Applied', index: true },
  rating: { type: Number, min: 0, max: 5, default: 3 },
  appliedAt: { type: Date, default: Date.now },
}, opts)
candidateSchema.index({ name: 'text', position: 'text', email: 'text' })

// --- Interview ---
const interviewSchema = new Schema({
  candidate: { type: String, required: true },
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate' },
  position: String,
  round: { type: String, enum: ['Screening', 'Technical', 'Managerial', 'HR Round'], default: 'Technical' },
  interviewer: { type: String, required: true },
  date: Date,
  time: String,
  mode: { type: String, enum: ['Video Call', 'On-site', 'Phone'], default: 'Video Call' },
  status: { type: String, enum: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled', index: true },
  feedback: String,
}, opts)
interviewSchema.index({ candidate: 'text', position: 'text', interviewer: 'text' })

// --- Offer ---
const offerSchema = new Schema({
  candidate: { type: String, required: true },
  position: { type: String, required: true },
  department: String,
  ctc: { type: Number, required: true },
  joiningDate: Date,
  status: { type: String, enum: ['Pending', 'Sent', 'Accepted', 'Declined'], default: 'Pending', index: true },
  sentAt: { type: Date, default: Date.now },
}, opts)
offerSchema.index({ candidate: 'text', position: 'text' })

// --- Onboarding ---
const onboardingTaskSchema = new Schema({ label: String, done: { type: Boolean, default: false } }, { _id: false })
const onboardingSchema = new Schema({
  name: { type: String, required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  position: String,
  department: String,
  joiningDate: Date,
  buddy: String,
  progress: { type: Number, default: 0 },
  tasks: [onboardingTaskSchema],
}, opts)
onboardingSchema.index({ name: 'text', position: 'text' })

// --- Payroll ---
const payrollSchema = new Schema({
  employee: { type: String, required: true, index: true },
  empCode: { type: String, index: true },
  department: String,
  designation: String,
  month: { type: String, required: true, index: true },
  // Base salary components.
  // PHASE SALARY STRUCTURE REWORK: `hra`/`allowances` are REMOVED as
  // separate paid components — Basic Salary remains 50% of Gross Monthly
  // Salary (the ratio is unchanged), but nothing fills the other 50% any
  // more. Gross and Basic remain two distinct figures. `monthly` (the fixed
  // Gross Monthly Salary that PF/ESI/Net are actually derived from — see
  // payrollEngine.js's file header) IS a persisted field here: unlike the
  // live `me/salary` display path (where payrollEngine.fillPayrollGaps
  // always re-derives it fresh from `basic` for a request in flight), a
  // saved Payroll row is a static, already-processed payslip with no
  // recomputation happening when the Payroll admin list (pages/hr/Payroll.jsx)
  // reads it straight from the database — so the figure has to actually be
  // on the document, the same way `basic`/`pf`/`esi`/`gross`/`net` already are.
  monthly: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  // Statutory deductions
  pf: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  esi: { type: Number, default: 0 },
  professional_tax: { type: Number, default: 0 },
  other_deductions: { type: Number, default: 0 },
  // Computed rates (stored on payslip for immutability)
  daily_rate: { type: Number, default: 0 },
  hourly_rate: { type: Number, default: 0 },
  // Overtime
  overtime_hours: { type: Number, default: 0 },
  overtime_pay: { type: Number, default: 0 },
  // Loss of Pay
  lwp_days: { type: Number, default: 0 },
  lwp_deduction: { type: Number, default: 0 },
  // Bonus
  bonus: { type: Number, default: 0 },
  // Totals
  gross: { type: Number, default: 0 },
  total_deductions: { type: Number, default: 0 },
  net: { type: Number, default: 0 },
  // Attendance snapshot at run time
  working_days: { type: Number, default: 0 },
  present_days: { type: Number, default: 0 },
  leave_days: { type: Number, default: 0 },
  // Late Entry Days — payslip-time snapshot of attendanceService.mySummary's
  // `lateDays`, stored the same way present_days/leave_days already are so a
  // paid payslip's figures stay immutable even if attendance is edited later.
  late_days: { type: Number, default: 0 },
  status: { type: String, enum: ['Paid', 'Pending'], default: 'Pending', index: true },
  // Explicit payment date (set when transitioning to Paid)
  payment_date: { type: Date, default: null },
}, opts)
payrollSchema.index({ employee: 'text', empCode: 'text', department: 'text' })
// PHASE ADMIN/HR PAYROLL + HEADCOUNT (TASK 4A) — database-level duplicate
// prevention: one payroll row per employee per month. The controller already
// rejects a duplicate run with a 409; this index makes the SAME invariant
// enforceable by MongoDB itself, so no write path (direct create, bulk import,
// future endpoint) can ever mint a second payslip for the same person+month.
// `employee` stores the employee NAME (emp.name) and `month` stores the label
// ("July 2026") — exactly the two values /hr/payroll/run dedupes on, so the
// index and the controller agree. The collection is empty today, so creating
// the index cannot fail on pre-existing duplicates.
payrollSchema.index({ employee: 1, month: 1 }, { unique: true })

// --- Performance Review ---
const reviewSchema = new Schema({
  employee: { type: String, required: true, index: true },
  // Stable employee identity (additive): employeeId links to the Employee
  // document, employeeCode mirrors emp.employeeId so the employee dropdown's
  // chosen record can be resolved reliably even if a name changes.
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  employeeCode: { type: String, index: true },
  department: String,
  period: { type: String, required: true },
  reviewer: String,
  rating: { type: Number, min: 0, max: 5, default: 3 },
  goalCompletion: { type: Number, min: 0, max: 100, default: 0 },
  status: { type: String, enum: ['Pending', 'In Progress', 'Completed'], default: 'Pending', index: true },
  comments: String,
  strengths: String,
  areasForImprovement: String,
}, opts)
reviewSchema.index({ employee: 'text', department: 'text', employeeCode: 'text' })

// --- Movement (Promotion / Transfer / Resignation / Exit) ---
const movementSchema = new Schema({
  type: { type: String, enum: ['Promotion', 'Transfer', 'Resignation', 'Exit'], required: true, index: true },
  employee: { type: String, required: true },
  department: String,
  from: String,
  to: String,
  effectiveDate: Date,
  reason: String,
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
}, opts)
movementSchema.index({ employee: 'text', type: 'text', department: 'text' })

export const Department = model('Department', departmentSchema)
export const Designation = model('Designation', designationSchema)
export const JobOpening = model('JobOpening', jobOpeningSchema)
export const Candidate = model('Candidate', candidateSchema)
export const Interview = model('Interview', interviewSchema)
export const Offer = model('Offer', offerSchema)
export const Onboarding = model('Onboarding', onboardingSchema)
export const Payroll = model('Payroll', payrollSchema)
export const Review = model('Review', reviewSchema)
export const Movement = model('Movement', movementSchema)
