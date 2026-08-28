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
// PHASE SALARY/BILLING (TASK 1) ROOT CAUSE #4: the SAME Finance ledger
// projectService.createProjectWithClient() already posts advance payments to, so
// this client-creation path records the advance as a real transaction instead of
// leaving it as a display-only number. No new collection, no second billing
// system.
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 5): the helper that used to be a
// private copy in this file now lives in services/clientAdvanceService.js and is
// SHARED with clientController.createClient(), which needs the identical write
// now that Client Creation posts to /admin/clients. Same logic, same idempotency
// key, same ledger — one implementation instead of two.
import { recordAdvancePayment } from '../services/clientAdvanceService.js'
import {
  validatePassword, generateTempPassword, audit,
} from '../utils/password.js'
import { STAFF_ROLES, linkUserToEmployee, deleteLinkedEmployee, deleteUserWithDependencies } from '../services/identityLink.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

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

// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 5): the `recordAdvancePayment()`
// helper that lived here is now imported from services/clientAdvanceService.js
// (see the import block above). Its behaviour — including the party + category +
// reference idempotency key that prevents a double count — is unchanged; it was
// moved verbatim so a third caller (clientController.createClient) could share
// it rather than copy it.

// Phase 6.2 (Task 5) ROOT CAUSE 3 of the "HR/Manager cannot create an employee"
// chain: canTarget() below was `ROLE_WRITE.includes(actorRole)` with
// a hard-coded `ROLE_WRITE = ['Admin']` list, i.e. an Admin-only gate. Even if the button
// and the route had been fixed, createUser() would still have thrown
// 403 "You are not allowed to create a Employee account" for HR and Manager.
//
// This matrix replaces the boolean with an explicit actor -> allowed target
// roles mapping. It does NOT weaken RBAC:
//   * Admin keeps every target role (identical to the old behaviour).
//   * Manager (the merged role that absorbed HR in Phase 7.2) may create ONLY
//     the 'Employee' role - it can never provision an Admin/Manager/Client
//     account, so no escalation is possible and no one can create a peer or a
//     superior.
//   * Any other role (Employee, Client) maps to [] and stays fully blocked.
const CREATE_ROLE_MATRIX = {
  Admin: ROLES,
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
  // PHASE ADMIN ATTENDANCE (TASK 2): the employee code is no longer user-typed
  // anywhere. It is allocated by the Employee pre-save hook and mirrored onto
  // the User by identityLink, so accepting it on an update would re-open the
  // second write path this task removed. User.empCode already on the document
  // is untouched — only a client-supplied value is dropped.
  delete patch.empCode
  // PHASE SALARY/BILLING (TASK 10): `employeeId` is the LINK to the Employee
  // document (identityLink writes the Employee _id into it and keeps it in
  // sync). It is not a user-editable business field — accepting a client value
  // here would re-point, or break, a login's HR profile. The employee's
  // human-facing code is `empCode`, which is set once at creation and is
  // immutable thereafter because Attendance/LeaveRequest/Payroll join on it.
  delete patch.employeeId
  // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): drop `workLocation` from any
  // update body. No form sends it any more, and the schema path is gone (so
  // Mongoose strict mode would ignore it regardless) — dropping it explicitly
  // documents the retirement and keeps a stale cached bundle from re-adding an
  // off-schema key to the document.
  delete patch.workLocation
  // Empty date strings can't be cast to a Date — drop rather than fail validation.
  if (patch.joiningDate === '') delete patch.joiningDate
  return patch
}

// Projection applied to every User read that leaves this controller.
//
// `-password` is the long-standing rule: password hashes never leave the API.
//
// PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `-workLocation` is added for
// the same reason as the employee repository's exclusion projection. These
// reads are `.lean()`, so a User document stored BEFORE the schema path was
// removed still carried the retired key straight into the JSON response
// (verified over HTTP: 12 pre-existing user documents were still emitting it).
// The projection stops the API sending it WITHOUT modifying a single stored
// document — no migration is run and nothing is deleted.
const USER_PROJECTION = '-password -workLocation'

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
    User.find(filter).select(USER_PROJECTION).sort(sort).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    User.countDocuments(filter),
  ])
  // Phase 6.9 (TASK 13): expose `id` on every row so the Users table can
  // address rows (view, edit, select, bulk actions).
  res.json({ data: data.map(withId), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) })
})

export const getUser = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id).select(USER_PROJECTION).lean()
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
    // PHASE ADMIN ATTENDANCE (TASK 2): `empCode` is no longer accepted from the
    // create payload — see the block comment below.
    avatar = '', employeeId = '', notes = '', clientCode = '',
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` is no longer
    // accepted - the column is gone from both the User and Employee models.
    employmentType = 'Full-time', joiningDate,
    experienceYears = '', emergencyContact = '', salaryCtc = 0,
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3): `reportingTeam` is no
    // longer accepted on CREATE. No form submits it any more (it was Manager
    // creation only). The User.reportingTeam COLUMN is intentionally kept -
    // services/scopeService.js still reads it for the Manager write scope - and
    // updateUser() still accepts it, so existing teams stay administrable.
    reportingManager = '', shift = '',
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
    // PHASE ADMIN USER WIZARD (TASK 6): extended HR profile fields collected
    // by the multi-step creation wizard (staff roles only). None of these have
    // a User column - they belong to the linked Employee HR profile and are
    // persisted onto it after linkUserToEmployee() below. They are optional:
    // legacy callers that omit them get exactly the previous behaviour.
    dob, bloodGroup = '', maritalStatus,
    education, bank, emergencyContacts,
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
  // PHASE ADMIN ATTENDANCE (TASK 2) — the admin-typed Employee Code is REMOVED.
  //
  // What was here (Phase 5.7 Task 4): the create payload accepted an `empCode`
  // string, checked it for uniqueness and forwarded it through identityLink so
  // it landed on the new Employee document verbatim.
  //
  // WHY IT IS GONE, AND WHY THE FIELD ITSELF IS NOT:
  //   * `empCode` is NOT obsolete. Employee.empCode is a `unique`, indexed
  //     identifier and is a live join key across the system — Attendance.empCode,
  //     LeaveRequest.empCode, Payroll.empCode, the self-serve payslip filter in
  //     hrRoutes (`selfPayrollFilter`), the Employees directory search, salary
  //     documents and every attendance/leave/payroll export read it. Deleting
  //     the database field would break all of those workflows.
  //   * What was obsolete is the USER-CREATED half of it: the "Employee Code"
  //     input on Admin -> Users. Employee.js already owns a correct sequential
  //     allocator (`nextEmpCode`, EMP001, EMP002, …) that runs in a pre-save
  //     hook and verifies the candidate is free. Letting an admin type a code
  //     alongside it meant two competing sources for one unique key, with the
  //     manual one able to collide with, or interleave into, the generated
  //     sequence.
  //
  // So the code is now ALWAYS server-allocated. identityLink still propagates
  // the canonical Employee.empCode back onto the User document exactly as
  // before, so User.empCode keeps being populated — just never from user input.
  //
  // -------------------------------------------------------------------------
  // PHASE SALARY/BILLING (TASK 10) — THE TYPED "Employee ID" NOW REALLY STICKS.
  //
  // The brief requires that creating a user with Employee ID = "EMP-001" makes
  // My Profile show "EMP-001". That was impossible for two compounding reasons:
  //
  //   1. The form's `employeeId` value was written to `User.employeeId`, which
  //      is NOT the business code — services/identityLink.js uses that column as
  //      the LINK to the Employee document and overwrites it with
  //      `String(emp._id)` on the very next sync. The typed value was therefore
  //      destroyed within the same request, and My Profile (which read that
  //      column) ended up rendering a Mongo ObjectId.
  //   2. Nothing ever fed the typed value into `empCode`, the actual
  //      human-facing code, so the sequential allocator always won.
  //
  // FIX: a typed value is treated as the desired `empCode` — the ONE source of
  // truth — and is carried through the EXISTING mechanism rather than a new one:
  // `User.empCode` is seeded with it, identityLink's `desiredCode` picks it up,
  // and Employee.js's pre-save hook already honours a manually supplied code
  // ("a MANUALLY ENTERED code is never touched -- the generator only runs when
  // the field is genuinely empty"). Leaving the field blank keeps the existing
  // behaviour exactly: `nextEmpCode` allocates EMP001, EMP002, …
  //
  // The collision risk that motivated removing the input is handled, not
  // reintroduced: the code is checked against BOTH collections up front and
  // rejected with a clear 409, and `Employee.empCode` keeps its unique index as
  // the final guarantee.
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
        joinedDate: date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).toISOString().slice(0, 10),
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
      // PHASE SALARY/BILLING (TASK 1): mirror the advance into the Finance
      // ledger so "Paid Amount" reflects a real payment record, exactly as the
      // New-Project-with-Client path already does. Idempotent — see the helper.
      await recordAdvancePayment(client, advancePayment, actor.name)
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
    avatar, notes, clientCode,
    // PHASE SALARY/BILLING (TASK 10): `employeeId` is NO LONGER seeded from the
    // form. That column is the LINK to the Employee document (identityLink
    // overwrites it with the Employee _id on the next line of execution), so
    // writing a business code into it only ever produced a value that was
    // immediately discarded — and, until this phase, displayed as the Employee
    // ID in My Profile.
    //
    // The typed code goes to `empCode` instead — the real human-facing
    // identifier. When the field is left blank this stays '' and the previous
    // behaviour is unchanged: the Employee pre-save hook allocates the next
    // sequential code and linkUserToEmployee() mirrors it back onto the User.
    empCode: typedEmpCode && STAFF_ROLES.includes(role) ? typedEmpCode : '',
    clientId: resolvedClientId,
    // Extended HR fields — only meaningful for staff; harmless defaults otherwise.
    employmentType, joiningDate,
    experienceYears, emergencyContact, salaryCtc,
    reportingManager, shift,
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3): the `reportingTeam` spread
    // is removed. A newly created Manager starts with the schema default ([]);
    // their team is then defined the upward way, by the employees whose
    // `reportingManager` names them - which is exactly what
    // scopeService.getManagerTeamEmails() already unions in.
  })

  // Provision a linked Employee HR profile so the person shows in the
  // Employees directory and every HR module, no matter where they were added.
  if (STAFF_ROLES.includes(role)) {
    await linkUserToEmployee(user)
    await audit(actor.name, 'Employee Profile Created', {
      user: name, module: 'Users', severity: 'Info', ip: req.ip,
    })

    // PHASE ADMIN USER WIZARD (TASK 6): persist the wizard's extended profile
    // fields onto the just-linked Employee HR profile. These fields have no
    // User column (dob, blood group, marital status, education, bank details
    // and the emergency-contacts array are Employee-model only), so they can
    // never flow through linkUserToEmployee's field mirror - they are written
    // directly, matched by the link the mirror just established. Only non-empty
    // values are written, so a caller that omits them (the pre-wizard payload
    // shape) leaves the freshly created profile byte-for-byte as before.
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

  // Re-read the row so the response carries the authoritative values
  // identityLink just wrote (the linked Employee's ObjectId + the generated
  // EMP### code when the create form left the field blank) instead of the
  // pre-link in-memory snapshot.
  const safe = (await User.findById(user._id).select(USER_PROJECTION)).toObject()
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
        joinedDate: date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).toISOString().slice(0, 10),
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
      // PHASE SALARY/BILLING (TASK 1): same ledger mirror as the create path.
      await recordAdvancePayment(client, patch.advancePayment, actor.name)
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

  const updated = await User.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true }).select(USER_PROJECTION).lean()

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
  // PHASE DELETION (TASK 2C) ROOT CAUSE FIX: deleting a User could leave a
  // dependent record behind. The old implementation only handled the Employee
  // direction (User -> Employee); a Client-role User left its Client organisation
  // record orphaned in the Client collection.
  //
  // Centralised cascade: the same deleteUserWithDependencies routine is used here
  // and in bulkRemoveUsers, so single and bulk deletion can never drift.
  await deleteUserWithDependencies(user)
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
  // Resolve full user documents (not lean) so deleteUserWithDependencies can
  // inspect role/clientId/employeeId in one pass, then cascade before deletion.
  const users = await User.find({ _id: { $in: ids } })
  // PHASE DELETION (TASK 2C): run the SAME centralized cascade for every user,
  // so single + bulk deletion share one dependency rule instead of two copies.
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

// --- Per-user histories (derived from live collections) -------------------
// LOGIN HISTORY (real sessions): reads the Activity sessions opened by
// authController.login and closed by POST /auth/logout. Keyed by userId (the
// ObjectId), never by email/name, so histories can never bleed across
// accounts. `active` is derived from the stored flags: a session with no
// logoutAt and active=true is a CURRENT session; everything else is closed.
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
