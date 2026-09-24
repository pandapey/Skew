import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { User, GENDERS, ROLES } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { Client, ClientProject } from '../models/clientModels.js'
import { Activity, AuditLog } from '../models/adminModels.js'
import { Notification, NotificationSettings } from '../models/notificationModels.js'
import { Project, ProjectActivity } from '../models/projectModels.js'
import { recordAdvancePayment } from '../services/clientAdvanceService.js'
import {
  validatePassword, generateTempPassword, audit,
} from '../utils/password.js'
import { STAFF_ROLES, linkUserToEmployee, deleteLinkedEmployee, deleteUserWithDependencies } from '../services/identityLink.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

const withId = (doc) => (doc && doc._id ? { ...doc, id: String(doc._id) } : doc)
const CREATE_ROLE_MATRIX = {
  Admin: ROLES,
  Manager: ['Employee'],
}

const assertGender = (gender, role) => {
  if (role === 'Client') return undefined
  if (!gender) throw new ApiError(400, 'Gender is required')
  if (!GENDERS.includes(gender)) {
    throw new ApiError(400, `Gender must be one of: ${GENDERS.join(', ')}`)
  }
  return gender
}

const canTarget = (actorRole, targetRole) =>
  (CREATE_ROLE_MATRIX[actorRole] || []).includes(targetRole)

const sanitizePatch = (body) => {
  const patch = { ...body }
  delete patch.password
  delete patch._id
  delete patch.id
  delete patch.createdAt
  delete patch.updatedAt
  delete patch.empCode
  delete patch.employeeId
  delete patch.workLocation
  if (patch.joiningDate === '') delete patch.joiningDate
  return patch
}

const USER_PROJECTION = '-password -workLocation'
export const listUsers = asyncHandler(async (req, res) => {
  const { search = '', role, status, page = 1, limit = 8 } = req.query
  const sortBy = (typeof req.query.sortBy === 'string' && req.query.sortBy.trim()) ? req.query.sortBy.trim() : 'createdAt'
  const order = req.query.order === 'asc' ? 'asc' : 'desc'
  const filter = {}
  if (search) filter.$or = [
    { name: { $regex: escapeRegex(search), $options: 'i' } },
    { email: { $regex: escapeRegex(search), $options: 'i' } },
  ]
  const roleV = scalarOrNull(role)
  const statusV = scalarOrNull(status)
  if (roleV != null) filter.role = roleV
  if (statusV != null) filter.status = statusV

  const pageNum = clampPage(page)
  const limitNum = clampLimit(limit, 100)
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 }

  const [data, total] = await Promise.all([
    User.find(filter).select(USER_PROJECTION).sort(sort).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    User.countDocuments(filter),
  ])
  res.json({ data: data.map(withId), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) })
})

export const getUser = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).select(USER_PROJECTION).lean()
  if (!u) throw new ApiError(404, 'User not found')
  res.json(withId(u))
})

export const createUser = asyncHandler(async (req, res) => {
  const actor = req.user
  const {
    name, email, password, role = 'Employee', gender,
    department = '', designation = '', phone = '', status = 'Active',
    avatar = '', employeeId = '', notes = '', clientCode = '',
    employmentType = 'Full-time', joiningDate,
    experienceYears = '', emergencyContact = '', salaryCtc = 0,
    reportingManager = '', shift = '',
    clientId, clientCompany,
    address, gst, projectType, advancePayment, monthlyDue, budget,
    projectMembers,
    dob, bloodGroup = '', maritalStatus,
    education, bank, emergencyContacts,
  } = req.body

  if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required')
  if (!canTarget(actor.role, role)) {
    throw new ApiError(403, `You are not allowed to create a ${role} account`)
  }
  const resolvedGender = assertGender(gender, role)

  if (await User.findOne({ email })) {
    throw new ApiError(409, 'This email address is already registered.')
  }

  const { valid } = validatePassword(password)
  if (!valid) {
    throw new ApiError(400, 'Password does not meet the required policy (8–64 chars, upper, lower, number, special).')
  }

  const typedEmpCode = String(employeeId || '').trim()
  if (typedEmpCode && STAFF_ROLES.includes(role)) {
    if (!/^EMP\d{3,}$/.test(typedEmpCode)) {
      throw new ApiError(400, 'Employee ID must follow the EMP001 format (e.g. EMP001, EMP010).')
    }
    const [empTaken, userTaken] = await Promise.all([
      Employee.exists({ empCode: typedEmpCode }),
      User.exists({ empCode: typedEmpCode }),
    ])
    if (empTaken || userTaken) {
      throw new ApiError(409, `Employee ID "${typedEmpCode}" is already in use.`)
    }
  }
  const memberNames = Array.isArray(projectMembers)
    ? [...new Set(projectMembers.map((n) => String(n).trim()).filter(Boolean))]
    : []

  let resolvedClientId = ''
  if (role === 'Client') {
    if (clientId) {
      const existing = await Client.findOne({ clientId })
      if (!existing) throw new ApiError(400, 'Selected client profile does not exist')
      resolvedClientId = clientId
      if (memberNames.length) {
        await Client.updateOne(
          { clientId },
          { $addToSet: { projectMembers: { $each: memberNames } } },
        )
      }
    } else if (clientCompany) {
      const typedClientCode = String(clientCode || '').trim()
      if (typedClientCode && await Client.findOne({ clientId: typedClientCode })) {
        throw new ApiError(409, `Client code "${typedClientCode}" is already in use.`)
      }
      const newClientId = typedClientCode || `cl-${Date.now()}`
      const client = await Client.create({
        clientId: newClientId,
        company: clientCompany,
        contactPerson: name,
        email: email || '',
        status: 'Active',
        joinedDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        phone: phone || '',
        address: address || '',
        gst: gst || '',
        projectType: projectType || '',
        advancePayment: Number(advancePayment) >= 0 ? Number(advancePayment) : 0,
        monthlyDue: Number(monthlyDue) >= 0 ? Number(monthlyDue) : 0,
        budget: Number(budget) >= 0 ? Number(budget) : 0,
        projectMembers: memberNames,
      })
      resolvedClientId = client.clientId
      await recordAdvancePayment(client, advancePayment, actor.name)
    } else {
      throw new ApiError(400, 'A Client must be linked to a client profile (choose an existing client or provide a company).')
    }

    if (resolvedClientId && memberNames.length) {
      const cps = await ClientProject.find({ clientId: resolvedClientId })
      for (const cp of cps) {
        const already = new Set((cp.team || []).map((t) => t.name))
        const additions = memberNames.filter((n) => !already.has(n))
        if (additions.length) {
          cp.team.push(...additions.map((n) => ({ name: n, roleInProject: 'Member' })))
          await cp.save()
        }
      }
    }
  }

  const user = await User.create({
    name, email, password, role,
    gender: resolvedGender ?? null,
    department, designation, phone, status,
    avatar, notes, clientCode,
    empCode: typedEmpCode && STAFF_ROLES.includes(role) ? typedEmpCode : '',
    clientId: resolvedClientId,
    employmentType, joiningDate,
    experienceYears, emergencyContact, salaryCtc,
    reportingManager, shift,
  })

  if (STAFF_ROLES.includes(role)) {
    await linkUserToEmployee(user)
    await audit(actor.name, 'Employee Profile Created', {
      user: name, module: 'Users', severity: 'Info', ip: req.ip,
    })

    const empPatch = {}
    if (dob) empPatch.dob = dob
    if (address) empPatch.address = address
    if (bloodGroup) empPatch.bloodGroup = bloodGroup
    if (maritalStatus) empPatch.maritalStatus = maritalStatus
    if (Array.isArray(education) && education.length) empPatch.education = education
    if (bank && (bank.name || bank.account || bank.ifsc)) empPatch.bank = bank
    if (Array.isArray(emergencyContacts) && emergencyContacts.length) empPatch.emergencyContacts = emergencyContacts
    if (Object.keys(empPatch).length) {
      await Employee.updateOne({ userId: user._id }, { $set: empPatch })
    }
  }

  await audit(actor.name, 'User Created', {
    user: `${name} (${role})`, module: 'Users', severity: 'Info', ip: req.ip,
  })

  try {
    await NotificationSettings.updateOne(
      { user: user.email },
      { $setOnInsert: { user: user.email } },
      { upsert: true },
    )
    await Notification.create({
      recipient: user.email,
      type: 'announcement',
      title: `Welcome to Skew Infotech Pvt. Ltd., ${String(name).split(' ')[0]}!`,
      body: `Your ${role} account has been created. Sign in with your email to get started.`,
      sender: actor.name,
      priority: 'normal',
    })
  } catch (err) {
    console.error('Welcome provisioning failed:', err?.message)
  }

  const safe = (await User.findById(user._id).select(USER_PROJECTION)).toObject()
  res.status(201).json(safe)
})

export const updateUser = asyncHandler(async (req, res) => {
  const actor = req.user
  const existing = await User.findById(req.params.id)
  if (!existing) throw new ApiError(404, 'User not found')

  const patch = sanitizePatch(req.body)

  if (patch.role && patch.role !== existing.role && !canTarget(actor.role, patch.role)) {
    throw new ApiError(403, `You are not allowed to assign the ${patch.role} role`)
  }

  if ('gender' in patch) {
    if (patch.gender === '' || patch.gender === null) {
      patch.gender = null
    } else if (!GENDERS.includes(patch.gender)) {
      throw new ApiError(400, `Gender must be one of: ${GENDERS.join(', ')}`)
    }
  }

  const oldStatus = existing.status
  const oldRole = existing.role

  if (patch.role === 'Client' || existing.role === 'Client') {
    if (patch.clientId) {
      const c = await Client.findOne({ clientId: patch.clientId })
      if (!c) throw new ApiError(400, 'Selected client profile does not exist')
    } else if (patch.clientCompany) {
      const newClientId = `cl-${Date.now()}`
      const client = await Client.create({
        clientId: newClientId,
        company: patch.clientCompany,
        contactPerson: existing.name,
        email: existing.email || '',
        status: 'Active',
        joinedDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        phone: patch.phone || existing.phone || '',
        address: patch.address || '',
        gst: patch.gst || '',
        projectType: patch.projectType || '',
        advancePayment: Number(patch.advancePayment) >= 0 ? Number(patch.advancePayment) : 0,
        monthlyDue: Number(patch.monthlyDue) >= 0 ? Number(patch.monthlyDue) : 0,
        budget: Number(patch.budget) >= 0 ? Number(patch.budget) : 0,
      })
      patch.clientId = client.clientId
      await recordAdvancePayment(client, patch.advancePayment, actor.name)
    }
    delete patch.clientCompany
    delete patch.accountManager
    delete patch.clientStatus
    delete patch.address
    delete patch.gst
    delete patch.projectType
    delete patch.advancePayment
    delete patch.monthlyDue
    delete patch.budget
  }

  const updated = await User.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true }).select(USER_PROJECTION).lean()

  if (STAFF_ROLES.includes(updated.role)) {
    await linkUserToEmployee(updated)
  }

  if (patch.role && patch.role !== oldRole) {
    await audit(actor.name, 'Role Changed', {
      user: `${existing.name}: ${oldRole} → ${patch.role}`, module: 'Users', severity: 'Critical', ip: req.ip,
    })
  }
  if (patch.status && patch.status !== oldStatus) {
    const action =
      patch.status === 'Active' ? 'User Activated'
        : patch.status === 'Suspended' ? 'User Suspended'
          : 'User Disabled'
    await audit(actor.name, action, {
      user: `${existing.name} → ${patch.status}`, module: 'Users', severity: 'Warning', ip: req.ip,
    })
  } else if (Object.keys(patch).length) {
    await audit(actor.name, 'User Updated', { user: existing.name, module: 'Users', severity: 'Info', ip: req.ip })
  }

  res.json(withId(updated))
})

export const resetPassword = asyncHandler(async (req, res) => {
  const actor = req.user
  const { newPassword, generateTemp } = req.body

  if (!generateTemp && !newPassword) {
    throw new ApiError(400, 'Provide a new password or request a generated one')
  }

  let plain
  if (generateTemp) {
    plain = generateTempPassword()
  } else {
    const { valid } = validatePassword(newPassword)
    if (!valid) throw new ApiError(400, 'Password does not meet the required policy (8–64 chars, upper, lower, number, special).')
    plain = newPassword
  }

  const user = await User.findById(req.params.id)
  if (!user) throw new ApiError(404, 'User not found')
  user.password = plain
  await user.save()

  await audit(actor.name, 'Password Reset', {
    user: user.name, module: 'Users', severity: 'Warning', ip: req.ip,
  })

  res.json({ ok: true, temporaryPassword: generateTemp ? plain : undefined })
})

export const removeUser = asyncHandler(async (req, res) => {
  const actor = req.user
  const user = await User.findById(req.params.id)
  if (!user) throw new ApiError(404, 'User not found')
  await deleteUserWithDependencies(user)
  await user.deleteOne()
  await audit(actor.name, 'User Deleted', { user: user.name, module: 'Users', severity: 'Critical', ip: req.ip })
  res.json({ ok: true })
})

export const bulkUpdateUsers = asyncHandler(async (req, res) => {
  const { ids = [], patch = {} } = req.body
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No ids provided')
  const clean = sanitizePatch(patch)
  const result = await User.updateMany({ _id: { $in: ids } }, clean, { runValidators: true })
  await audit(req.user.name, 'Users Bulk Updated', { user: `${ids.length} users`, module: 'Users', severity: 'Info', ip: req.ip })
  res.json({ updated: result.modifiedCount })
})

export const bulkRemoveUsers = asyncHandler(async (req, res) => {
  const { ids = [] } = req.body
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No ids provided')
  const users = await User.find({ _id: { $in: ids } })
  for (const user of users) {
    try {
      await deleteUserWithDependencies(user)
    } catch (e) {
      systemLog('WARN', `Cascade delete failed for user ${user.email} (${user._id}): ${e?.message || e}`, SYSTEM_LOG_SOURCES.API)
    }
  }
  const result = await User.deleteMany({ _id: { $in: ids } })
  await audit(req.user.name, 'Users Bulk Deleted', { user: `${ids.length} users`, module: 'Users', severity: 'Critical', ip: req.ip })
  res.json({ deleted: result.deletedCount })
})

const toIso = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

export const loginHistory = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).lean()
  if (!u) throw new ApiError(404, 'User not found')
  const rows = await Activity.find({ userId: u._id }).sort({ startedAt: -1 }).limit(100).lean()
  res.json(rows.map((r) => ({
    id: String(r._id),
    userId: r.userId ? String(r.userId) : '',
    role: r.role || '',
    device: r.device || '—',
    browser: r.browser || '—',
    os: r.os || '—',
    ip: r.ip || '—',
    location: r.location || '—',
    loginAt: toIso(r.startedAt),
    logoutAt: toIso(r.logoutAt),
    active: Boolean(r.active && !r.logoutAt),
  })))
})

export const auditHistory = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).lean()
  if (!u) throw new ApiError(404, 'User not found')
  const rows = await AuditLog.find({ user: u.name }).sort({ at: -1 }).limit(50).lean()
  res.json(rows.map((r) => ({
    id: String(r._id),
    user: r.user,
    action: r.action,
    module: r.module,
    severity: r.severity,
    ip: r.ip || '—',
    at: r.at || '',
  })))
})

export const assignedProjects = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).lean()
  if (!u) throw new ApiError(404, 'User not found')
  const name = u.name
  const projects = await Project.find({
    $or: [{ lead: name }, { 'members.name': name }],
  }).sort({ createdAt: -1 }).lean()
  res.json(projects.map((p) => ({
    id: String(p._id),
    name: p.name,
    code: p.code,
    client: p.client,
    status: p.status,
    progress: p.progress,
    priority: p.priority,
    role: p.lead === name ? 'Lead' : 'Member',
  })))
})

export const userActivity = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).lean()
  if (!u) throw new ApiError(404, 'User not found')
  const rows = await ProjectActivity.find({ actor: u.name }).sort({ createdAt: -1 }).limit(50).lean()
  res.json(rows.map((r) => ({
    id: String(r._id),
    actor: r.actor,
    action: r.action,
    target: r.target,
    project: r.project ? String(r.project) : null,
    createdAt: r.createdAt || '',
  })))
})
