// E2E verification for the false "Viewed salary portal" audit records fix
// (PHASE ADMIN ATTENDANCE TASK 3A / Task 7 of the current phase). Uses the
// LIVE server + MongoDB. Prints PASS/FAIL per check, exits 1 on any failure.
// Run from server/: node src/tests/salary-audit-e2e.mjs
//
// Covered flows (all against a fresh temp Employee):
//   A. Login + profile read          -> NO audit record
//   B. mySalary WITHOUT ?context     -> NO audit record (dashboard widget /
//      My Profile tab read the same endpoint before the fix)
//   C. mySalary WITH ?context        -> exactly ONE audit record
//   D. Repeat portal read            -> still ONE (15-min dedup window)
//   E. Audit record shape            -> user/module/severity via the shared
//      audit() helper
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { AuditLog } from '../models/adminModels.js'

const API = 'http://localhost:5000/api'
const EMP_EMAIL = 'e2e-salary-audit@skew.com'
const EMP_PASSWORD = 'E2eSalaryAudit#1'
const EMP_NAME = 'E2E Salary Audit Employee'
const ACTION = 'Viewed salary portal'

let pass = 0
let fail = 0
const results = []
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  // Idempotent start cleanup (leftovers from an aborted previous run).
  const old = await User.findOne({ email: EMP_EMAIL }).lean()
  await User.deleteMany({ email: EMP_EMAIL })
  await Employee.deleteMany({ email: EMP_EMAIL })
  if (old) await AuditLog.deleteMany({ user: EMP_NAME })

  const userDoc = await User.create({
    email: EMP_EMAIL, password: EMP_PASSWORD, role: 'Employee',
    name: EMP_NAME, department: 'Engineering', designation: 'Tester', active: true,
  })
  await Employee.create({
    userId: userDoc._id, name: EMP_NAME, email: EMP_EMAIL, empCode: 'E2ESA001',
    phone: '9999999998', gender: 'Female',
    department: 'Engineering', designation: 'Tester', shift: 'General',
    salary: { ctc: 120000 }, status: 'Active',
  })

  const countRecords = async () => AuditLog.countDocuments({ user: EMP_NAME, action: ACTION })

  // A. Login + profile must not mint a record.
  const login = await api('/auth/login', { method: 'POST', body: { email: EMP_EMAIL, password: EMP_PASSWORD } })
  check('A: login succeeds', login.status === 200 && !!login.data?.token, `status=${login.status}`)
  const token = login.data?.token
  const me = await api('/auth/me', { token })
  check('A: profile read succeeds', me.status === 200, `status=${me.status}`)
  const countA = await countRecords()
  check('A: login + profile created NO audit record', countA === 0, `count=${countA}`)

  // B. The shared salary endpoint without the portal flag must not audit
  // (the dashboard Salary widget and the My Profile tab read it like this).
  const plain = await api('/hr/payroll/me/salary', { token })
  check('B: mySalary (no context) succeeds', plain.status === 200, `status=${plain.status}`)
  const countB = await countRecords()
  check('B: mySalary without ?context created NO audit record', countB === 0, `count=${countB}`)

  // C. A genuine portal read (with the flag) must mint exactly one record.
  const portal1 = await api('/hr/payroll/me/salary?context=salary-portal', { token })
  check('C: portal mySalary succeeds', portal1.status === 200, `status=${portal1.status}`)
  const countC = await countRecords()
  check('C: first portal read created exactly ONE record', countC === 1, `count=${countC}`)

  // D. The dedup window collapses repeat reads into the same record.
  const portal2 = await api('/hr/payroll/me/salary?context=salary-portal', { token })
  check('D: repeat portal read succeeds', portal2.status === 200, `status=${portal2.status}`)
  const countD = await countRecords()
  check('D: repeat portal read still ONE record (15-min dedup)', countD === 1, `count=${countD}`)

  // E. Record shape comes from the shared audit() helper.
  const rec = await AuditLog.findOne({ user: EMP_NAME, action: ACTION }).lean()
  check('E: record carries user', rec?.user === EMP_NAME, rec?.user || 'none')
  check('E: record carries module Payroll', rec?.module === 'Payroll', rec?.module || 'none')
  check('E: record carries severity Info', rec?.severity === 'Info', rec?.severity || 'none')

  // Cleanup.
  await User.deleteMany({ email: EMP_EMAIL })
  await Employee.deleteMany({ email: EMP_EMAIL })
  await AuditLog.deleteMany({ user: EMP_NAME })
  await mongoose.disconnect()
}

run()
  .then(() => {
    console.log(results.join('\n'))
    console.log(`\nsalary-audit-e2e: ${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })