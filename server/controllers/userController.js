import mongoose from 'mongoose'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { User, GENDERS, ROLES } from '../models/User.js'
import { Employee } from '../models/Employee.js'
// Phase 6.3 (Task 2): ClientProject is needed so assigned members are related
// straight onto the client's project team, not just stored on the Client.
import { Client, ClientProject } from '../models/clientModels.js'
import { Activity, AuditLog } from '../models/adminModels.js'
import { Notification, NotificationSettings } from '../models/notificationModels.js'
import { Project, ProjectActivity } from '../models/projectModels.js'
import {
  validatePassword, generateTempPassword, audit,
} from '../utils/password.js'
import { STAFF_ROLES, linkUserToEmployee, deleteLinkedEmployee } from '../services/identityLink.js'

// Phase 6.9 (TASK 13) ROOT CAUSE of "Admin Panel -> Users: View and Edit not
// working".
//
// listUsers() and getUser() both read with `.lean()`. A lean() result is a
// plain object straight out of the driver: it carries `_id` and, because lean
// deliberately skips virtuals, it NEVER carries `id`. (clientController.js:51
// documents this same trap.) There is no toJSON transform or `id` virtual
// configured anywhere in this codebase.
//
// The Users table, however, is built entirely around `r.id`:
//   * onView  -> navigate(`/admin/users/${r.id}`)  => "/admin/users/undefined"
//   * getRowId / row selection -> undefined keys
//   * saving an edit -> PUT /users/undefined
// So View navigated to a route that could never resolve a user, and Edit sent
// its update to an id-less URL. Both silently did nothing - exactly the
// reported symptom.
//
// The rest of THIS controller already returns `id: String(r._id)` (login
// history, audit history, assigned projects, activity). The main list/get/update
// responses were simply missed. `withId` applies that same existing convention
// in one place rather than re-deriving it at each call site.
//
// Backward compatible: `_id` is preserved untouched, so any caller already
// reading `_id` keeps working. This only ADDS the `id` the client expects.
const withId = (doc) => (doc && doc._id ? { ...doc, id: String(doc._id) } : doc)

// Phase 6.2 (Task 5) ROOT CAUSE 3 of the "HR/Manager cannot create an employee"
// chain: canTarget() below was `ROLE_WRITE.includes(actorRole)` with
// a hard-coded `ROLE_WRITE = ['Admin']` list, i.e. an Admin-only gate. Even if the button
// and the route had been fixed, createUser() would still have thrown
// 403 "You are not allowed to create a Employee account" for HR and Manager.
//
// This matrix replaces the boolean with an explicit actor -> allowed target
// roles mapping. It does NOT weaken RBAC:
//   * Admin keeps every target role (identical to the old behaviour).
//   * HR and Manager may create ONLY the 'Employee' role - they can never
//     provision an Admin/HR/Manager/Client account, so no escalation is
//     possible and no one can create a peer or a superior.
//   * Any other role (Employee, Client) maps to [] and stays fully blocked.
const CREATE_ROLE_MATRIX = {
  Admin: ROLES,
  HR: ['Employee'],
  Manager: ['Employee'],
}

// Phase 5 (Task 1): gender is REQUIRED on creation but optional on the schema.
//
// The asymmetry is deliberate and is the whole reason existing users keep
// working: making it `required` in Mongoose would break every legacy document
// the moment it is saved (a role change, a status toggle, a password reset all
// call save()). Enforcing it at the point of CREATION instead means new data is
// always complete while old data stays loadable and editable.
//
// Roles that own an Employee HR profile must declare it. A Client is an
// external portal account with no HR record, so gender is not collected.
const assertGender = (gender, role) => {
  if (role === 'Client') return undefined
  if (!gender) throw new ApiError(400, 'Gender is required')
  if (!GENDERS.includes(gender)) {
    throw new ApiError(400, `Gender must be one of: ${GENDERS.join(', ')}`)
  }
  return gender
}

// Which *target* roles an actor may create/assign. Admin remains the highest
// authority and may assign every role including Admin itself. HR/Manager are
// limited to 'Employee' by CREATE_ROLE_MATRIX above (Phase 6.2, Task 5).
const canTarget = (actorRole, targetRole) =>
  (CREATE_ROLE_MATRIX[actorRole] || []).includes(targetRole)

// Strip secrets / non-editable fields from an update patch.
const sanitizePatch = (body) => {
  const patch = { ...body }
  delete patch.password
  delete patch._id
  delete patch.id
  delete patch.createdAt
  delete patch.updatedAt
  // Empty date strings can't be cast to a Date — drop rather than fail validation.
  if (patch.joiningDate === '') delete patch.joiningDate
  return patch
}

// List users (paginated, filtered, never returns password hashes).
export const listUsers = asyncHandler(async (req, res) => {
  const { search = '', role, status, page = 1, limit = 8 } = req.query
  // Guard against an empty `sortBy` (the client sends '' by default), which
  // would otherwise build `{ '': 1 }` and crash Mongoose with
  // "Invalid field \"\" passed to sort()".
  const sortBy = (typeof req.query.sortBy === 'string' && req.query.sortBy.trim()) ? req.query.sortBy.trim() : 'createdAt'
  const order = req.query.order === 'asc' ? 'asc' : 'desc'
  const filter = {}
  if (search) filter.$or = [
    { name: { $regex: escapeRegex(search), $options: 'i' } },
    { email: { $regex: escapeRegex(search), $options: 'i' } },
  ]
  // Only accept scalar role/status (reject operator objects) — NoSQL injection
  // defense. scalarOrNull also maps empty strings ("All") to null = no filter.
  const roleV = scalarOrNull(role)
  const statusV = scalarOrNull(status)
  if (roleV != null) filter.role = roleV
  if (statusV != null) filter.status = statusV

  const pageNum = clampPage(page)
  const limitNum = clampLimit(limit, 100)
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 }

  const [data, total] = await Promise.all([
    User.find(filter).select('-password').sort(sort).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    User.countDocuments(filter),
  ])
  // Phase 6.9 (TASK 13): expose `id` on every row so the Users table can
  // address rows (view, edit, select, bulk actions).
  res.json({ data: data.map(withId), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) })
})

export const getUser = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).select('-password').lean()
  if (!u) throw new ApiError(404, 'User not found')
  // Phase 6.9 (TASK 13): the detail page keys its form and mutations off the id.
  res.json(withId(u))
})

// Create a user. Hashes the password via the model pre-save hook, enforces a
// working account for every role, and links Client users to a client profile.
export const createUser = asyncHandler(async (req, res) => {
  const actor = req.user
  const {
    name, email, password, role = 'Employee', gender,
    department = '', designation = '', phone = '', status = 'Active',
    avatar = '', employeeId = '', notes = '', clientCode = '', empCode = '',
    employmentType = 'Full-time', workLocation = '', joiningDate,
    experienceYears = '', emergencyContact = '', salaryCtc = 0,
    reportingManager = '', shift = '', reportingTeam,
    // Phase 6.9 (TASK 10 + TASK 11): `accountManager` AND `clientStatus` removed
    // from the accepted payload. A newly provisioned client is always Active;
    // status is managed afterwards on the client record itself.
    clientId, clientCompany,
    // Phase 5.9 (Task 1 & 3): the full client profile now arrives from the one
    // unified Create User form, which is what makes the standalone "Add Client"
    // page redundant. Every one of these is OPTIONAL — when omitted the Client
    // model defaults apply, so older callers keep working byte-for-byte.
    address, gst, projectType, advancePayment, monthlyDue, budget,
    // Phase 6.3 (Task 2): Employees assigned as project members at client
    // creation. Optional - omitting it leaves the schema default ([]).
    projectMembers,
  } = req.body

  if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required')
  if (!canTarget(actor.role, role)) {
    throw new ApiError(403, `You are not allowed to create a ${role} account`)
  }
  // Phase 5 (Task 1): validate before any writes so a bad payload cannot leave
  // a half-provisioned Client record behind.
  const resolvedGender = assertGender(gender, role)

  if (await User.findOne({ email })) {
    throw new ApiError(409, 'This email address is already registered.')
  }

  const { valid } = validatePassword(password)
  if (!valid) {
    throw new ApiError(400, 'Password does not meet the required policy (8–64 chars, upper, lower, number, special).')
  }

  // --- Employee code -------------------------------------------------------
  // Phase 5.7 (Task 4): honour an admin-typed employee code. It is validated
  // for uniqueness HERE, before any write, so the user gets a clean 409
  // instead of a duplicate-key crash deeper in identityLink.
  const desiredEmpCode = String(empCode || '').trim()
  if (desiredEmpCode && STAFF_ROLES.includes(role)) {
    if (await Employee.findOne({ empCode: desiredEmpCode })) {
      throw new ApiError(409, `Employee code "${desiredEmpCode}" is already in use.`)
    }
  }

  // --- Client linking -------------------------------------------------------
  // Phase 6.3 (Task 2): normalise the assigned member names once, up front, the
  // same way `reportingTeam` is normalised below.
  const memberNames = Array.isArray(projectMembers)
    ? [...new Set(projectMembers.map((n) => String(n).trim()).filter(Boolean))]
    : []

  let resolvedClientId = ''
  if (role === 'Client') {
    if (clientId) {
      const existing = await Client.findOne({ clientId })
      if (!existing) throw new ApiError(400, 'Selected client profile does not exist')
      resolvedClientId = clientId
      // Linking an EXISTING client profile: merge rather than overwrite, so an
      // admin adding a second portal login cannot wipe the assigned team.
      if (memberNames.length) {
        await Client.updateOne(
          { clientId },
          { $addToSet: { projectMembers: { $each: memberNames } } },
        )
      }
    } else if (clientCompany) {
      // Phase 5.7 (Task 4): honour an admin-typed client code; only fall back
      // to a generated one when the field was left blank.
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
        // Phase 6.9 (TASK 11): status is no longer caller-supplied.
        status: 'Active',
        joinedDate: new Date().toISOString().slice(0, 10),
        // Phase 5.9 (Task 1 & 3): persist the rest of the client profile that
        // the unified form now collects. Guarded with `|| default` so a caller
        // that omits them (the pre-5.9 payload shape) is unaffected.
        phone: phone || '',
        address: address || '',
        gst: gst || '',
        projectType: projectType || '',
        advancePayment: Number(advancePayment) >= 0 ? Number(advancePayment) : 0,
        monthlyDue: Number(monthlyDue) >= 0 ? Number(monthlyDue) : 0,
        // Phase 6.16 (TASK 1): Budget reuses the Client model's existing
        // `budget` field (models/clientModels.js) - the column already
        // existed, it was simply never accepted from this endpoint.
        budget: Number(budget) >= 0 ? Number(budget) : 0,
        // Phase 6.3 (Task 2).
        projectMembers: memberNames,
      })
      resolvedClientId = client.clientId
    } else {
      throw new ApiError(400, 'A Client must be linked to a client profile (choose an existing client or provide a company).')
    }

    // Phase 6.3 (Task 2) - "Members automatically relate to the Client/Project
    // relationship". Storing the names on the Client alone would not satisfy
    // that, because every portal team surface reads `ClientProject.team[]`.
    // So the selection is also related onto each of this client's existing
    // projects, merged by name so re-running this can never create duplicates
    // and can never drop members that syncClientProject() put there from
    // `Project.members`. A brand-new client has no ClientProject yet; when one
    // is later created, syncClientProject() populates the team from the
    // project's own members exactly as before - unchanged behaviour.
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
    avatar, employeeId, notes, clientCode,
    // Carried into identityLink, which propagates it onto the Employee record
    // instead of letting the model generate a throwaway code.
    empCode: desiredEmpCode,
    clientId: resolvedClientId,
    // Extended HR fields — only meaningful for staff; harmless defaults otherwise.
    employmentType, workLocation, joiningDate,
    experienceYears, emergencyContact, salaryCtc,
    reportingManager, shift,
    // Phase 5.9 (Task 1): Manager-only reporting team. Normalised to trimmed,
    // non-empty names. Spread conditionally so an omitted field leaves the
    // schema default ([]) in place rather than writing undefined.
    ...(Array.isArray(reportingTeam)
      ? { reportingTeam: reportingTeam.map((n) => String(n).trim()).filter(Boolean) }
      : {}),
  })

  // Provision a linked Employee HR profile so the person shows in the
  // Employees directory and every HR module, no matter where they were added.
  if (STAFF_ROLES.includes(role)) {
    await linkUserToEmployee(user)
    await audit(actor.name, 'Employee Profile Created', {
      user: name, module: 'Users', severity: 'Info', ip: req.ip,
    })
  }

  await audit(actor.name, 'User Created', {
    user: `${name} (${role})`, module: 'Users', severity: 'Info', ip: req.ip,
  })

  // One-source-of-truth provisioning — default notification settings + a welcome
  // notification, so the client never needs extra calls after creation.
  try {
    await NotificationSettings.updateOne(
      { user: user.email },
      { $setOnInsert: { user: user.email } },
      { upsert: true },
    )
    await Notification.create({
      recipient: user.email,
      type: 'announcement',
      title: `Welcome to Skew Enterprise Hub, ${String(name).split(' ')[0]}!`,
      body: `Your ${role} account has been created. Sign in with your email to get started.`,
      sender: actor.name,
      priority: 'normal',
    })
  } catch (err) {
    // Provisioning a welcome notification must never fail account creation.
    console.error('Welcome provisioning failed:', err?.message)
  }

  const safe = user.toObject()
  delete safe.password
  res.status(201).json(safe)
})

// Update a user. Password is NEVER editable here (use reset-password).
export const updateUser = asyncHandler(async (req, res) => {
  const actor = req.user
  const existing = await User.findById(req.params.id)
  if (!existing) throw new ApiError(404, 'User not found')

  const patch = sanitizePatch(req.body)

  // Re-check target-role permission if the role itself is changing.
  if (patch.role && patch.role !== existing.role && !canTarget(actor.role, patch.role)) {
    throw new ApiError(403, `You are not allowed to assign the ${patch.role} role`)
  }

  // Phase 5 (Task 1): gender is EDITABLE — this is the path that lets an admin
  // backfill a legacy account. Validate the value when one is supplied, but
  // never force it on an update, otherwise every unrelated edit to a legacy
  // user (status, department) would fail until gender was filled in.
  if ('gender' in patch) {
    if (patch.gender === '' || patch.gender === null) {
      patch.gender = null
    } else if (!GENDERS.includes(patch.gender)) {
      throw new ApiError(400, `Gender must be one of: ${GENDERS.join(', ')}`)
    }
  }

  const oldStatus = existing.status
  const oldRole = existing.role

  // Client linking on update (same rules as create).
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
        // Phase 6.9 (TASK 11): mirrors the create path - always Active.
        status: 'Active',
        joinedDate: new Date().toISOString().slice(0, 10),
        // Phase 5.9 (Task 1 & 3): mirror the create path so a Client profile
        // provisioned during an UPDATE captures the same profile fields.
        phone: patch.phone || existing.phone || '',
        address: patch.address || '',
        gst: patch.gst || '',
        projectType: patch.projectType || '',
        advancePayment: Number(patch.advancePayment) >= 0 ? Number(patch.advancePayment) : 0,
        monthlyDue: Number(patch.monthlyDue) >= 0 ? Number(patch.monthlyDue) : 0,
        // Phase 6.16 (TASK 1): mirrors the create path - Budget reuses the
        // Client model's existing `budget` field.
        budget: Number(patch.budget) >= 0 ? Number(patch.budget) : 0,
      })
      patch.clientId = client.clientId
    }
    delete patch.clientCompany
    // Phase 6.9 (TASK 10): still stripped from the patch so a stale client
    // (or an old cached bundle) that keeps posting the retired key cannot
    // write it onto the User document. Backward compatible by design.
    delete patch.accountManager
    delete patch.clientStatus
    // Phase 5.9 (Task 1 & 3): these belong to the Client document, not the User
    // document. Mongoose strict mode would silently drop them, but deleting
    // them explicitly keeps the audit diff honest about what changed on User.
    delete patch.address
    delete patch.gst
    delete patch.projectType
    delete patch.advancePayment
    delete patch.monthlyDue
    // Phase 6.16 (TASK 1): Budget belongs to the Client document too.
    delete patch.budget
  }

  const updated = await User.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true }).select('-password').lean()

  // Keep the linked Employee HR profile in sync (creates it if none exists
  // yet for this staff member).
  if (STAFF_ROLES.includes(updated.role)) {
    await linkUserToEmployee(updated)
  }

  // Audit role + status transitions.
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

  // Phase 6.9 (TASK 13): keep the update response shape identical to get/list.
  res.json(withId(updated))
})

// Reset a user's password (admin action). Either a manual new password or a
// generated temporary one. Returns the temporary password when generated.
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

  // Set + save so the pre-save hook hashes it (findByIdAndUpdate would bypass it).
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
  // Cascade: remove the linked Employee HR profile first (while the user is
  // still resolvable by id), then delete the User.
  await deleteLinkedEmployee(user)
  await user.deleteOne()
  await audit(actor.name, 'User Deleted', { user: user.name, module: 'Users', severity: 'Critical', ip: req.ip })
  res.json({ ok: true })
})

// --- Bulk operations (account management) --------------------------------
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
  // Resolve linked Employees before deleting the Users, then cascade.
  const users = await User.find({ _id: { $in: ids } }, 'employeeId email').lean()
  const result = await User.deleteMany({ _id: { $in: ids } })
  // employeeId may hold an admin-typed business code (e.g. "EMP-1012") rather
  // than an Employee _id — only valid ObjectIds can go into the _id query.
  const empIds = users.map((u) => u.employeeId).filter((id) => id && mongoose.isValidObjectId(id))
  const empEmails = users.map((u) => u.email).filter(Boolean)
  if (empIds.length || empEmails.length) {
    await Employee.deleteMany({
      $or: [{ _id: { $in: empIds } }, { email: { $in: empEmails } }],
    })
  }
  await audit(req.user.name, 'Users Bulk Deleted', { user: `${ids.length} users`, module: 'Users', severity: 'Critical', ip: req.ip })
  res.json({ deleted: result.deletedCount })
})

// --- Per-user histories (derived from live collections) -------------------
export const loginHistory = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).lean()
  if (!u) throw new ApiError(404, 'User not found')
  const rows = await Activity.find({ user: u.email }).sort({ startedAt: -1 }).limit(50).lean()
  res.json(rows.map((r) => ({
    id: String(r._id),
    user: r.user,
    device: r.device || '—',
    browser: r.browser || '—',
    ip: r.ip || '—',
    location: r.location || '—',
    startedAt: r.startedAt || '',
    currentUrl: r.currentUrl || '',
    active: Boolean(r.active),
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
