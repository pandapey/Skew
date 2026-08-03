import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// --- Attendance record (one per employee per day) ---
const attendanceSchema = new Schema({
  employee: { type: String, required: true, index: true },
  empCode: String,
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  department: { type: String, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  shift: { type: String, default: 'General' },
  checkIn: String,   // HH:mm:ss (with seconds)
  checkOut: String,
  checkInAt: { type: Date },   // full timestamp of check-in
  checkOutAt: { type: Date },  // full timestamp of check-out
  checkInSeconds: { type: Number },  // epoch seconds at check-in
  checkOutSeconds: { type: Number }, // epoch seconds at check-out
  durationSecs: { type: Number },    // total worked seconds (excl. breaks)
  timezone: { type: String },        // IANA timezone captured at check-in
  breakMins: { type: Number, default: 0 },
  breakSecs: { type: Number, default: 0 },
  // Individual break sessions (start/end/seconds) for full break tracking.
  // Existing records default to an empty array (safe additive migration).
  breaks: [{ start: Date, end: Date, seconds: { type: Number, default: 0 } }],
  workingHours: { type: Number, default: 0 },
  overtimeHours: { type: Number, default: 0 },
  late: { type: Boolean, default: false },
  earlyExit: { type: Boolean, default: false },
  onBreak: { type: Boolean, default: false },
  status: { type: String, enum: ['Present', 'Late', 'Early Exit', 'Absent', 'On Leave', 'Not Marked'], default: 'Not Marked', index: true },
  geo: { lat: Number, lng: Number },
}, opts)
// One record per employee per day.
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true })
attendanceSchema.index({ employee: 'text', empCode: 'text', department: 'text' })
// Index the ObjectId reference for direct employee lookups.
attendanceSchema.index({ employeeId: 1 })

// --- Shift ---
const shiftSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, uppercase: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  hours: { type: Number, default: 9 },
  graceMins: { type: Number, default: 15 },
  color: { type: String, default: '#2563EB' },
}, opts)
shiftSchema.index({ name: 'text', code: 'text' })

// --- Holiday ---
const holidaySchema = new Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  day: String,
  type: { type: String, enum: ['Public', 'National', 'Festival', 'Optional'], default: 'Public' },
}, opts)
holidaySchema.index({ name: 'text' })

export const Attendance = model('Attendance', attendanceSchema)
export const Shift = model('Shift', shiftSchema)
export const Holiday = model('Holiday', holidaySchema)
