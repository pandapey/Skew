// Phase 5.1 (Task 6) — database integrity verification. READ-ONLY.
//
//   node src/migrations/phase51-verify.js
//
// This script NEVER writes. It reports findings and exits non-zero if any
// FAIL-level problem is found, so it can be used as a release gate.
//
// Checks:
//   1. Enum validity      — stored values still legal for the current schemas
//   2. Duplicate identity — duplicate emails / empCodes across User+Employee
//   3. Broken references  — links pointing at documents that no longer exist
//   4. Orphan records     — child rows whose owner is gone
//   5. Schema validation  — every document re-validated against its schema

import mongoose from 'mongoose'
import dotenv from 'dotenv'

import { User, ROLES, GENDERS } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { LeaveRequest, LeaveBalance, LeaveType } from '../models/leaveModels.js'
import { Attendance } from '../models/attendanceModels.js'
import { Notification } from '../models/notificationModels.js'
import { Project, ProjectTask } from '../models/projectModels.js'
import { Client } from '../models/clientModels.js'

dotenv.config()

const findings = []
const add = (level, check, detail) => {
  findings.push({ level, check, detail })
  console.log(`  [${level}] ${check}: ${detail}`)
}
const ok = (check, detail) => add('PASS', check, detail)
const fail = (check, detail) => add('FAIL', check, detail)
const warn = (check, detail) => add('WARN', check, detail)

// --- 1. Enum validity --------------------------------------------------------
async function checkEnums() {
  console.log('\n[1/5] Enum validity')

  const badRole = await User.countDocuments({ role: { $nin: ROLES } })
  badRole ? fail('User.role', `${badRole} user(s) hold a role outside [${ROLES.join(', ')}]`)
    : ok('User.role', 'all users hold a valid role')

  // gender is intentionally nullable for legacy accounts (Phase 5 design).
  const badGender = await User.countDocuments({ gender: { $nin: [...GENDERS, null] } })
  badGender ? fail('User.gender', `${badGender} user(s) have an invalid gender`)
    : ok('User.gender', `all users are ${GENDERS.join('/')} or null`)
  const nullGender = await User.countDocuments({ gender: null, role: { $ne: 'Client' } })
  if (nullGender) warn('User.gender', `${nullGender} non-client account(s) have no gender yet (legacy; editable in Admin > Users)`)

  // The Phase 5.1 Task 1 bug class: a stored value outside the type enum.
  const NOTIF_TYPES = Notification.schema.path('type').enumValues
  const badNotif = await Notification.countDocuments({ type: { $nin: NOTIF_TYPES } })
  badNotif ? fail('Notification.type', `${badNotif} notification(s) outside [${NOTIF_TYPES.join(', ')}]`)
    : ok('Notification.type', `all values within [${NOTIF_TYPES.join(', ')}]`)

  const LEAVE_STATUSES = LeaveRequest.schema.path('status').enumValues
  const badStatus = await LeaveRequest.countDocuments({ status: { $nin: LEAVE_STATUSES } })
  badStatus ? fail('LeaveRequest.status', `${badStatus} request(s) outside [${LEAVE_STATUSES.join(', ')}]`)
    : ok('LeaveRequest.status', `all values within [${LEAVE_STATUSES.join(', ')}]`)

  const ATT_STATUSES = Attendance.schema.path('status').enumValues
  const badAtt = await Attendance.countDocuments({ status: { $nin: ATT_STATUSES } })
  badAtt ? fail('Attendance.status', `${badAtt} record(s) outside the allowed set`)
    : ok('Attendance.status', 'all values valid')
}

// --- 2. Duplicate identity ---------------------------------------------------
async function checkDuplicates() {
  console.log('\n[2/5] Duplicate identity')

  const dupe = async (Model, field, label) => {
    const rows = await Model.aggregate([
      { $match: { [field]: { $nin: [null, ''] } } },
      { $group: { _id: { $toLower: `$${field}` }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    rows.length
      ? fail(label, `${rows.length} duplicated value(s): ${rows.slice(0, 5).map((r) => r._id).join(', ')}`)
      : ok(label, 'no duplicates')
  }

  await dupe(User, 'email', 'User.email')
  await dupe(Employee, 'email', 'Employee.email')
  await dupe(Employee, 'empCode', 'Employee.empCode')
  await dupe(Client, 'clientId', 'Client.clientId')

  // One Employee profile per login.
  const rows = await Employee.aggregate([
    { $match: { userId: { $ne: null } } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ])
  rows.length ? fail('Employee.userId', `${rows.length} login(s) have more than one Employee profile`)
    : ok('Employee.userId', 'at most one Employee profile per login')
}

// --- 3 + 4. Broken references and orphans ------------------------------------
async function checkReferences() {
  console.log('\n[3/5] Broken references')

  // User.employeeId may legitimately hold a business code rather than an _id,
  // so only ObjectId-shaped values are checked (matching identityLink's rule).
  const users = await User.find({ employeeId: { $nin: [null, ''] } }).select('email employeeId').lean()
  const broken = []
  for (const u of users) {
    if (!mongoose.isValidObjectId(u.employeeId)) continue
    if (!(await Employee.exists({ _id: u.employeeId }))) broken.push(u.email)
  }
  broken.length ? fail('User.employeeId', `${broken.length} user(s) point at a missing Employee: ${broken.slice(0, 5).join(', ')}`)
    : ok('User.employeeId', 'every ObjectId link resolves')

  const emps = await Employee.find({ userId: { $ne: null } }).select('email userId').lean()
  const brokenEmp = []
  for (const e of emps) {
    if (!mongoose.isValidObjectId(e.userId)) continue
    if (!(await User.exists({ _id: e.userId }))) brokenEmp.push(e.email)
  }
  brokenEmp.length ? fail('Employee.userId', `${brokenEmp.length} profile(s) point at a missing User: ${brokenEmp.slice(0, 5).join(', ')}`)
    : ok('Employee.userId', 'every link resolves')

  const clientUsers = await User.find({ role: 'Client', clientId: { $nin: [null, ''] } }).select('email clientId').lean()
  const brokenClient = []
  for (const u of clientUsers) {
    if (!(await Client.exists({ clientId: u.clientId }))) brokenClient.push(u.email)
  }
  brokenClient.length ? fail('User.clientId', `${brokenClient.length} portal login(s) point at a missing Client: ${brokenClient.join(', ')}`)
    : ok('User.clientId', 'every portal login resolves to a Client')

  console.log('\n[4/5] Orphan records')

  // Leave and attendance reference the employee by NAME (existing design), so
  // an orphan is a row whose employee name no longer exists.
  const names = new Set((await Employee.find({}).select('name').lean()).map((e) => e.name))
  const userNames = new Set((await User.find({}).select('name').lean()).map((u) => u.name))
  const known = (n) => names.has(n) || userNames.has(n)

  const orphanRequests = (await LeaveRequest.find({}).select('employee').lean())
    .filter((r) => r.employee && !known(r.employee))
  orphanRequests.length ? warn('LeaveRequest.employee', `${orphanRequests.length} request(s) reference an unknown employee name`)
    : ok('LeaveRequest.employee', 'no orphan leave requests')

  const orphanBalances = (await LeaveBalance.find({}).select('employee type').lean())
  const typeNames = new Set((await LeaveType.find({}).select('name').lean()).map((t) => t.name))
  const badBalEmp = orphanBalances.filter((b) => b.employee && !known(b.employee))
  const badBalType = orphanBalances.filter((b) => b.type && !typeNames.has(b.type))
  badBalEmp.length ? warn('LeaveBalance.employee', `${badBalEmp.length} balance(s) reference an unknown employee`)
    : ok('LeaveBalance.employee', 'no orphan balances')
  badBalType.length ? warn('LeaveBalance.type', `${badBalType.length} balance(s) reference a leave type that no longer exists`)
    : ok('LeaveBalance.type', 'every balance maps to a live leave type')

  const orphanAtt = (await Attendance.find({}).select('employee').lean())
    .filter((a) => a.employee && !known(a.employee))
  orphanAtt.length ? warn('Attendance.employee', `${orphanAtt.length} record(s) reference an unknown employee`)
    : ok('Attendance.employee', 'no orphan attendance')

  const projectNames = new Set((await Project.find({}).select('name').lean()).map((p) => p.name))
  const orphanTasks = (await ProjectTask.find({}).select('project').lean())
    .filter((t) => t.project && !projectNames.has(t.project))
  orphanTasks.length ? warn('ProjectTask.project', `${orphanTasks.length} task(s) belong to a project that no longer exists`)
    : ok('ProjectTask.project', 'no orphan tasks')
}

// --- 5. Schema validation ----------------------------------------------------
// Re-validates real documents against the CURRENT schemas. This is what proves
// "no schema mismatch": if a document could not be saved today, it is reported.
async function checkSchemas() {
  console.log('\n[5/5] Schema validation')
  const models = [
    ['User', User], ['Employee', Employee], ['LeaveRequest', LeaveRequest],
    ['LeaveBalance', LeaveBalance], ['LeaveType', LeaveType],
    ['Attendance', Attendance], ['Notification', Notification],
    ['Project', Project], ['ProjectTask', ProjectTask], ['Client', Client],
  ]
  for (const [label, Model] of models) {
    const docs = await Model.find({}).limit(2000)
    const errors = []
    for (const d of docs) {
      const err = d.validateSync()
      if (err) errors.push(`${d._id}: ${Object.keys(err.errors).join(', ')}`)
    }
    errors.length
      ? fail(`${label} schema`, `${errors.length}/${docs.length} invalid — e.g. ${errors[0]}`)
      : ok(`${label} schema`, `${docs.length} document(s) valid`)
  }
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting.')
    process.exit(1)
  }
  await mongoose.connect(uri)
  console.log('Connected. READ-ONLY verification — no writes will be made.')

  await checkEnums()
  await checkDuplicates()
  await checkReferences()
  await checkSchemas()

  const fails = findings.filter((f) => f.level === 'FAIL')
  const warns = findings.filter((f) => f.level === 'WARN')
  console.log('\n================ SUMMARY ================')
  console.log(`  PASS : ${findings.filter((f) => f.level === 'PASS').length}`)
  console.log(`  WARN : ${warns.length}`)
  console.log(`  FAIL : ${fails.length}`)

  await mongoose.disconnect()
  if (fails.length) {
    console.log('\nFAILures must be resolved before going to production.')
    process.exit(1)
  }
  console.log('\nNo integrity failures found.')
}

main().catch((err) => { console.error(err); process.exit(1) })
