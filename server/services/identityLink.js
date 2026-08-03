import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { generateTempPassword, validatePassword } from '../utils/password.js'
import { ApiError } from '../utils/asyncHandler.js'

// The User.employeeId field may hold either the linked Employee's Mongo _id
// (set by this service) or an admin-typed business code like "EMP-1012".
// Only look it up by _id when it's actually a valid ObjectId, otherwise a
// CastError surfaces to the client as "Invalid _id".
const empById = (id) =>
  (id && mongoose.isValidObjectId(id)) ? Employee.findById(id) : null

// Roles that should own an Employee HR profile. Clients link to `Client`
// records instead; Admin is excluded from the directory.
// Phase 5: the Inventory role was retired and merged into HR, so it is gone
// from this list. Former Inventory staff are migrated to HR and keep their
// Employee profile — the profile is matched by email/userId, not by role.
export const STAFF_ROLES = ['Employee', 'HR', 'Manager']

export const mapUserStatusToEmployee = (status) => {
  if (status === 'On Leave') return 'On Leave'
  if (status === 'Active') return 'Active'
  return 'Inactive'
}

export const mapEmployeeStatusToUser = (status) => {
  if (status === 'Active' || status === 'On Leave') return 'Active'
  return 'Inactive'
}

const normEmail = (e) => (e ? String(e).toLowerCase().trim() : '')
// Required Employee fields that may be empty on a User; provide sane defaults.
const EMP_DEFAULTS = { phone: '—', department: 'General', designation: 'Staff' }

// Ensure a staff User has a linked Employee record: create it if none exists
// (matched by employeeId, then email), otherwise sync the shared fields.
// Re-fetches by id so it works with lean docs passed in from controllers.
export async function linkUserToEmployee(input) {
  const u = await User.findById(input?._id)
  if (!u || u.role === 'Client' || !STAFF_ROLES.includes(u.role)) return null

  const email = normEmail(u.email)
  let emp = await empById(u.employeeId)
  if (!emp && email) emp = await Employee.findOne({ email })

  const patch = {
    name: u.name,
    email: u.email,
    phone: u.phone || EMP_DEFAULTS.phone,
    department: u.department || EMP_DEFAULTS.department,
    designation: u.designation || EMP_DEFAULTS.designation,
    avatar: u.avatar || '',
    status: mapUserStatusToEmployee(u.status),
  }
  // Extended HR fields — only overwrite when the User actually carries a value
  // so we never wipe richer data already on the Employee record.
  if (u.employmentType) patch.employmentType = u.employmentType
  if (u.workLocation) patch.workLocation = u.workLocation
  if (u.joiningDate) patch.joiningDate = u.joiningDate
  if (u.experienceYears) patch.experienceYears = u.experienceYears
  if (u.emergencyContact) patch.emergencyContact = u.emergencyContact
  if (u.salaryCtc) patch.salary = { ctc: Number(u.salaryCtc) }
  if (u.reportingManager) patch.reportingTo = u.reportingManager
  if (u.shift) patch.shift = u.shift
  // Phase 5: gender is shared by both records. Only copy a real value so a
  // legacy User with `gender: null` never wipes a gender already captured on
  // the richer Employee HR profile.
  if (u.gender) patch.gender = u.gender
  // Phase 5.7 (Task 4) ROOT CAUSE FIX.
  // This patch previously carried NO empCode. So for a brand-new staff user
  // the Employee below was created with an empty empCode, the Employee
  // pre-save hook generated a throwaway one, and the write-back at the bottom
  // of this function then stamped that generated code onto the User --
  // silently replacing the code the admin had typed. Carrying the admin's
  // code through means the hook's `if (!this.empCode)` guard never fires and
  // the typed value survives. We only ever ADD a code, never overwrite a code
  // the Employee already owns (handled in the `if (emp)` branch below).
  const desiredCode = String(u.empCode || '').trim()

  if (emp) {
    Object.assign(emp, patch)
    // Adopt the typed code only when this Employee has none yet, so an
    // existing directory code is never clobbered by a stale User value.
    if (desiredCode && !emp.empCode) emp.empCode = desiredCode
    emp.userId = u._id
    await emp.save()
  } else {
    emp = await Employee.create({
      ...patch,
      ...(desiredCode ? { empCode: desiredCode } : {}),
      userId: u._id,
    })
  }

  // `employeeId` is the LINK to the Employee document; `empCode` is the
  // human-facing business code. Keep them distinct and only write when a
  // value actually changed.
  const nextLink = String(emp._id)
  const nextCode = emp.empCode || ''
  if (String(u.employeeId || '') !== nextLink || String(u.empCode || '') !== nextCode) {
    await User.updateOne(
      { _id: u._id },
      { $set: { employeeId: nextLink, empCode: nextCode } }
    )
  }
  return emp
}

// Ensure an Employee has a linked login User: create one with the provided
// password (or a generated temp password if none is given) when none exists
// (matched by userId, then email), otherwise sync the shared fields. Returns
// { credentials } only when a User was created with a generated temp password.
export async function linkEmployeeToUser(input, { password } = {}) {
  const emp = await Employee.findById(input?._id)
  if (!emp) return { credentials: null }

  const email = normEmail(emp.email)
  let user = emp.userId ? await User.findById(emp.userId) : null
  if (!user && email) user = await User.findOne({ email })

  const base = {
    name: emp.name,
    email: emp.email,
    department: emp.department || '',
    designation: emp.designation || '',
    phone: emp.phone || '',
    avatar: emp.avatar || '',
    status: mapEmployeeStatusToUser(emp.status),
    // empCode is canonical on the Employee — always flow it into the User.
    empCode: emp.empCode || '',
    employeeId: String(emp._id),
    // Extended HR fields mirrored onto the login User so both records agree.
    employmentType: emp.employmentType || 'Full-time',
    workLocation: emp.workLocation || '',
    joiningDate: emp.joiningDate || undefined,
    experienceYears: emp.experienceYears || '',
    emergencyContact: emp.emergencyContact || '',
    salaryCtc: emp.salary?.ctc || 0,
  }
  // Phase 5: mirror gender onto the login User, but only when the Employee
  // actually has one AND it is a value the User enum accepts. The Employee
  // schema still allows the legacy 'Other' option, which the User enum does
  // not — copying it across would throw a ValidationError on save.
  if (emp.gender === 'Male' || emp.gender === 'Female') base.gender = emp.gender

  let credentials = null
  if (user) {
    Object.assign(user, base)
    await user.save()
  } else {
    let plain = password
    if (plain) {
      if (!validatePassword(plain).valid) {
        throw new ApiError(400, 'Password does not meet the required policy (8–64 chars, upper, lower, number, special).')
      }
    } else {
      plain = generateTempPassword()
      credentials = { email: emp.email, temporaryPassword: plain }
    }
    user = await User.create({ ...base, role: 'Employee', password: plain })
  }

  // Only ever set the link on the Employee — never overwrite its empCode.
  if (!emp.userId || String(emp.userId) !== String(user._id)) {
    await Employee.updateOne({ _id: emp._id }, { $set: { userId: user._id } })
  }
  return { credentials }
}

// Delete the Employee linked to a User (by employeeId, falling back to email).
export async function deleteLinkedEmployee(input) {
  const u = await User.findById(input?._id)
  if (!u) return
  const email = normEmail(u.email)
  let emp = await empById(u.employeeId)
  if (!emp && email) emp = await Employee.findOne({ email })
  if (emp) await emp.deleteOne()
}

// Delete the User linked to an Employee (by userId, falling back to email).
export async function deleteLinkedUser(input) {
  const emp = await Employee.findById(input?._id)
  if (!emp) return
  const email = normEmail(emp.email)
  let user = emp.userId ? await User.findById(emp.userId) : null
  if (!user && email) user = await User.findOne({ email })
  if (user) await user.deleteOne()
}
