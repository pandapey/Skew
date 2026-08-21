import { Router } from 'express'
import { employeeController as ctrl } from '../controllers/employeeController.js'
import { validateEmployeeUpdate } from '../validators/employeeValidator.js'
import { protect, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
// Phase 6.2 (Task 5): REUSED, not reimplemented. createUser is the single
// provisioning routine (User + linked Employee + empCode + audit) already used
// by Admin -> Users. Mounting the same controller here means HR/Manager
// creation cannot drift from Admin creation.
import { createUser } from '../controllers/userController.js'
import { upload, uploadImage, uploadProfileDoc } from '../middleware/upload.js'

const router = Router()

// Roles allowed to mutate employee records.
// Phase 6.1 ROOT CAUSE: this was authorize('Admin','HR'), which is why a
// Manager could open the Employees page but every save returned 403. Manager is
// now permitted at the role level. Phase 7.2: HR is retired and merged into
// Manager, so the former HR write access (any employee, including pay) comes
// with the same role — the write list is Admin + Manager.
const canWrite = authorize('Admin', 'Manager')
// Bulk operations stay Admin/Manager: they address many records at once.
const canBulkWrite = authorize('Admin', 'Manager')
const canDelete = authorize('Admin')

// --- PHASE 6 (TASK 2): FIELD-LEVEL AUTHORIZATION -------------------------
// ROOT CAUSE this addresses: `canWrite` + `withinTeam` answered "may this role
// touch this document?" but nothing answered "may this role touch THIS FIELD?".
// Every column inside an employee the caller could reach was equally writable,
// so a Manager editing one of their own team members could rewrite that
// person's CTC or bank account - and TASK 2 widens the edit form, which would
// have widened that hole.
//
// The rule is expressed once here and mirrored (for UI affordances only) in
// client/src/features/employees/permissions.js. The client copy is a
// convenience; THIS is the gate. It runs for create and update alike, so a
// hand-crafted POST/PUT is stripped exactly like a form submission.
//
// Immutable-by-design keys are dropped for EVERY role:
//   empCode  - server-allocated (Employee.js nextEmpCode) and a live join key
//              across Attendance / Leave / Payroll. Never client-supplied.
//   userId   - the identity link; owned by identityLink.js.
//   _id/id   - never rewritable.
// (`role`, `employeeId` and `password` are additionally stripped downstream in
// employeeService.update - kept there so any other caller stays protected.)
//
// PHASE 7.2: the former Manager-only restrictions (salary/bank/email stripping,
// team scope) are REMOVED. HR was merged into Manager, and HR could always edit
// salary, bank and email for any employee; the merged Manager therefore keeps
// the full HR write surface and is no longer narrowed to a reporting team.
const IMMUTABLE_FIELDS = ['empCode', 'userId', '_id', 'id', 'createdAt', 'updatedAt']

const restrictEmployeeFields = (req, res, next) => {
  const body = { ...(req.body || {}) }
  for (const key of IMMUTABLE_FIELDS) delete body[key]
  req.body = body
  next()
}

// All routes require authentication. The external Client role is blocked from
// the internal employee directory so salary / bank data never leaks to clients.
const blockClient = (req, res, next) =>
  req.user.role === 'Client'
    ? res.status(403).json({ message: 'Forbidden: clients cannot access employee records' })
    : next()
router.use(protect, blockClient)

// Reads
router.get('/', ctrl.list)
router.get('/stats', ctrl.stats)
// Phase 9 (My Profile): self-service record. Declared BEFORE /:id so the
// literal path never falls into the id route. Guarded only by the router-level
// protect + blockClient — every internal role (Admin / Manager / Employee) has
// their own profile. The controller resolves the record from req.user alone,
// so no caller can pass another person's id.
router.get('/me', ctrl.myProfile)

// PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — own-record writes for the
// Employee role only. The service derives the target from req.user (JWT), so
// there is no id parameter to tamper with: an Employee can edit/read/delete
// ONLY their own profile, can never touch Admin/Manager/HR accounts, and can
// never upload or fetch a document for another employee. Admin/Manager keep
// their existing canWrite routes for full employee management.
const onlyEmployee = authorize('Employee')
// My Profile self-service: Employees AND Managers edit their own personal
// record (Manager needs the same Education/Bank self-service as Employee).
// Document uploads/downloads stay Employee-only.
router.put('/me', authorize('Employee', 'Manager'), asyncHandler(ctrl.updateSelf))
router.post('/me/documents', onlyEmployee, uploadProfileDoc.single('document'), asyncHandler(ctrl.uploadSelfDocument))
router.get('/me/documents/:docId', onlyEmployee, asyncHandler(ctrl.downloadSelfDocument))
router.delete('/me/documents/:docId', onlyEmployee, asyncHandler(ctrl.deleteSelfDocument))

router.get('/:id', ctrl.get)

// Bulk (declared before /:id writes to keep paths unambiguous)
router.post('/bulk-delete', canDelete, ctrl.bulkRemove)
router.post('/bulk-update', canBulkWrite, ctrl.bulkUpdate)

// --- Phase 6.2 (Task 5): HR / Manager "Add Employee" ---------------------
// ROOT CAUSE CHAIN (all four links had to be broken for the button to work):
//   1. client/src/pages/Employees.jsx gated the button on
//      `hasRole([ROLES.ADMIN])`, so HR/Manager never even saw "Add Employee".
//   2. Its handler navigated to `/admin/users?add=employee` - the Admin
//      redirect the spec forbids.
//   3. server/src/routes/userRoutes.js is `router.use(protect,
//      authorize('Admin'))`, so that redirect would 403 for HR/Manager anyway.
//   4. userController.canTarget() was hard-coded to Admin, so even a reachable
//      POST would have been rejected.
// This file was link #5: employeeRoutes had NO create route at all, so there
// was no non-Admin endpoint to point a fixed button at. That is added here.
//
// RBAC IS NOT WEAKENED:
//   * userRoutes.js stays 100% Admin-only - untouched. Nothing about Admin ->
//     Users user-management was opened up.
//   * This endpoint can only ever create the 'Employee' role: forceEmployeeRole
//     overwrites req.body.role, and CREATE_ROLE_MATRIX in userController.js
//     independently caps Manager at 'Employee'. Two independent gates.
//   * A Manager's new hire is auto-linked into that Manager's own reporting
//     team, so the hire is editable under the pre-7.2 team-scope rule; the
//     merge no longer restricts edits to that team (HR could edit anyone).
const canCreate = authorize('Admin', 'Manager')

const forceEmployeeRole = (req, res, next) => {
  req.body = { ...(req.body || {}), role: 'Employee' }
  if (req.user.role === 'Manager' && !req.body.reportingManager) {
    req.body.reportingManager = req.user.name
  }
  next()
}

// PHASE 6 (TASK 2): restrictEmployeeFields runs BEFORE forceEmployeeRole so a
// Manager cannot smuggle a salary in at creation time either.
router.post('/', canCreate, restrictEmployeeFields, forceEmployeeRole, asyncHandler(createUser))

// Writes (creation lives in Admin → Users — the single source of truth)
router.put('/:id', canWrite, restrictEmployeeFields, validateEmployeeUpdate, ctrl.update)
router.delete('/:id', canDelete, ctrl.remove)

// File uploads
router.post('/:id/photo', canWrite, uploadImage.single('photo'), ctrl.uploadPhoto)
router.post('/:id/documents', canWrite, upload.single('document'), ctrl.uploadDocument)
// PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — Admin/Manager can open the
// PRIVATE documents an employee uploaded themselves. Uses the same canWrite
// permission the Documents tab already runs under; the employee's own route is
// the /me/documents one declared above.
router.get('/:id/documents/:docId', canWrite, asyncHandler(ctrl.downloadDocument))

export default router
