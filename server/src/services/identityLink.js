import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { generateTempPassword, validatePassword } from '../utils/password.js'
import { ApiError } from '../utils/asyncHandler.js'

const empById = (id) =>
  (id && mongoose.isValidObjectId(id)) ? Employee.findById(id) : null

// ---- Stable-identity helpers (name → ID migration) ----------------------
// Display names change (marriage, corrections) and can collide, so live
// ownership/assignment matching must work by ID with name as fallback.

export async function resolveStaffIdentity(name) {
  const key = String(name || '').trim()
  if (!key) return null
  const user = await User.findOne({ name: key }).select('_id name empCode employeeId role status').lean()
  if (!user) return null
  return {
    userId: String(user._id),
    name: user.name,
    empCode: user.empCode || '',
    employeeId: user.employeeId || '',
  }
}

const objectIdOf = (value) => {
  try {
    return value && mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null
  } catch {
    return null
  }
}

// Builds `{ nameField: name }`, `{ idField: id }`, or `{ $or: [...] }`
// depending on which parts of the identity are known. Pure — unit-tested.
export function idOrNameClause(nameField, idField, identity = {}) {
  const ors = []
  const oid = objectIdOf(identity.userId)
  if (oid) ors.push({ [idField]: oid })
  if (identity.name) ors.push({ [nameField]: identity.name })
  if (!ors.length) return {}
  return ors.length === 1 ? ors[0] : { $or: ors }
}

// True when the doc's stored holder (name and/or ID) matches the user.
// Pure — unit-tested.
export function isIdentityHolder(docName, docId, user) {
  if (!user) return false
  if (docName && user.name && docName === user.name) return true
  const uid = user._id ? String(user._id) : null
  if (uid && docId && String(docId) === uid) return true
  return false
}

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
const EMP_DEFAULTS = { phone: '—', department: 'General', designation: 'Staff' }

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
    status: mapUserStatusToEmployee(u.status),
  }
  // Never clobber the linked Employee avatar with '' — an empty User.avatar
  // means "unchanged", not "remove". Wiping here is what made uploaded
  // avatars disappear after the next profile/admin sync.
  if (u.avatar) patch.avatar = u.avatar

  if (u.employmentType) patch.employmentType = u.employmentType
  if (u.joiningDate) patch.joiningDate = u.joiningDate
  if (u.experienceYears) patch.experienceYears = u.experienceYears
  if (u.emergencyContact) patch.emergencyContact = u.emergencyContact
  if (u.salaryCtc) patch.salary = { ctc: Number(u.salaryCtc) }
  if (u.reportingManager) patch.reportingTo = u.reportingManager
  if (u.shift) patch.shift = u.shift
  if (u.gender) patch.gender = u.gender

  const desiredCode = String(u.empCode || '').trim()

  if (emp) {
    Object.assign(emp, patch)
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
    status: mapEmployeeStatusToUser(emp.status),
    empCode: emp.empCode || '',
    employeeId: String(emp._id),
    employmentType: emp.employmentType || 'Full-time',
    joiningDate: emp.joiningDate || undefined,
    experienceYears: emp.experienceYears || '',
    emergencyContact: emp.emergencyContact || '',
    salaryCtc: emp.salary?.ctc || 0,
  }

  if (emp.gender === 'Male' || emp.gender === 'Female') base.gender = emp.gender
  // Same rule as User -> Employee: empty Employee.avatar means "unchanged".
  // Copying '' here wiped freshly uploaded User avatars on the next
  // employee self-edit / admin edit.
  if (emp.avatar) base.avatar = emp.avatar

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

  if (!emp.userId || String(emp.userId) !== String(user._id)) {
    await Employee.updateOne({ _id: emp._id }, { $set: { userId: user._id } })
  }
  return { credentials }
}

export async function deleteLinkedEmployee(input) {
  const u = await User.findById(input?._id)
  if (!u) return
  const email = normEmail(u.email)
  let emp = await empById(u.employeeId)
  if (!emp && email) emp = await Employee.findOne({ email })
  if (emp) await emp.deleteOne()
}

export async function deleteLinkedUser(input) {
  const emp = await Employee.findById(input?._id)
  if (!emp) return
  const email = normEmail(emp.email)
  let user = emp.userId ? await User.findById(emp.userId) : null
  if (!user && email) user = await User.findOne({ email })
  if (user) await user.deleteOne()
}

export async function deleteUserWithDependencies(user) {
  if (!user) return
  const role = user.role

  const { Activity } = await import('../models/adminModels.js')
  await Activity.deleteMany({ userId: user._id })

  if (role === 'Client') {
    if (user.clientId) {
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

  if (STAFF_ROLES.includes(role)) {
    await deleteLinkedEmployee(user)
  }
}
