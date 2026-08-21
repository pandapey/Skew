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
// Phase 5: the Inventory role was retired and merged into HR. Phase 7.2: HR
// itself was retired and merged into Manager. Profiles are matched by
// email/userId, not by role, so no migration of the directory is needed.
export const STAFF_ROLES = ['Employee', 'Manager']

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
  // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): the User -> Employee
  // `workLocation` mirror is removed with the column itself.
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
  // Carry the User's existing empCode onto the Employee record.
  //
  // PHASE ADMIN ATTENDANCE (TASK 2): this used to carry an ADMIN-TYPED code
  // through from the create form. That input is gone — a new staff User is now
  // created with `empCode: ''`, so on first link this is empty, the Employee
  // pre-save hook allocates the next sequential code (EMP001, EMP002, …) and
  // the write-back at the bottom of this function mirrors it onto the User.
  // The value therefore only ever flows Employee -> User now.
  //
  // It is still read here because RE-linking an existing account must not lose
  // the code it already owns (e.g. an Employee row deleted and re-provisioned).
  // A code the Employee already holds is never overwritten — see below.
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
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): the Employee -> User
    // `workLocation` mirror is removed with the column itself.
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

// ---------------------------------------------------------------------------
// PHASE DELETION (TASK 2C) — ONE centralized User deletion routine.
//
// ROOT CAUSE: single-user deletion (removeUser) and bulk-user deletion
// (bulkRemoveUsers) each had their OWN copy of the "find + delete the
// dependent Employee" logic — and neither handled the Client direction at all.
// Deleting a Client-role User left its Client organisation record orphaned in
// the Client collection.
//
// deleteUserWithDependencies(user) is the single entry point for both paths. It
// inspects the user's role and deletes exactly the dependent record that role
// owns:
//   * Employee / HR / Manager / Admin -> the linked Employee HR profile
//     (matched by employeeId ObjectId, then email) via the existing
//     deleteLinkedEmployee() helper.
//   * Client -> the linked Client document (matched by clientId).
//
// The User itself is NOT deleted here — the caller always owns the final
// User.deleteOne() so audit + response shape stay consistent.
// ---------------------------------------------------------------------------
export async function deleteUserWithDependencies(user) {
  if (!user) return
  const role = user.role

  // LOGIN HISTORY (real sessions): every role can own Activity session rows
  // (opened at login, closed at logout). They are joined by userId, so they
  // are cleaned up here exactly like every other user-owned side record.
  const { Activity } = await import('../models/adminModels.js')
  await Activity.deleteMany({ userId: user._id })

  if (role === 'Client') {
    // Client portal accounts link to a Client organisation via User.clientId.
    // Remove the Client document so no orphan is left behind. Client-scoped data
    // (ClientProjects, notifications, messages, meetings) is cleaned by the
    // Client controller's removeClient — but when the User is deleted directly
    // (not via removeClient), those side-tables are handled here as well.
    if (user.clientId) {
      // Reuse the same models already imported above. `Client` is destructured
      // here with the rest — it was previously omitted, so every deletion of a
      // Client-role User threw `ReferenceError: Client is not defined` at the
      // `Client.deleteOne()` call below, the cascade aborted, and the Client
      // organisation row was left orphaned (with the ClientProjects already
      // wiped by the lines above).
      const { Client, ClientProject, ClientNotification, ClientMessage, ClientAnnouncement } = await import('../models/clientModels.js')
      await ClientProject.deleteMany({ clientId: user.clientId })
      await ClientNotification.deleteMany({ clientId: user.clientId })
      await ClientMessage.deleteMany({ clientId: user.clientId })
      await ClientAnnouncement.deleteMany({ clientId: user.clientId })
      const { CalendarEvent } = await import('../models/calendarModels.js')
      await CalendarEvent.deleteMany({ clientId: user.clientId })
      await Client.deleteOne({ clientId: user.clientId })
    }
    return
  }

  // Staff roles (Employee / HR / Manager) link to an Employee HR profile.
  if (STAFF_ROLES.includes(role)) {
    await deleteLinkedEmployee(user)
  }
}
