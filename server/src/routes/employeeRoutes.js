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
import { upload, uploadImage } from '../middleware/upload.js'
import { Employee } from '../models/Employee.js'
// Phase 6.1: shared scoping rule (see services/scopeService.js).
import { assertCanEditEmployee } from '../services/scopeService.js'

const router = Router()

// Roles allowed to mutate employee records.
// Phase 6.1 ROOT CAUSE: this was authorize('Admin','HR'), which is why a
// Manager could open the Employees page but every save returned 403. Manager is
// now permitted at the role level, but ONLY in combination with `withinTeam`
// below - the coarse role list alone would have let a Manager edit any employee
// in the company, which the spec forbids ("team scope only").
const canWrite = authorize('Admin', 'HR', 'Manager')
// Bulk operations stay Admin/HR: they address many records at once and cannot be
// meaningfully team-scoped, so widening them would be an escalation.
const canBulkWrite = authorize('Admin', 'HR')
const canDelete = authorize('Admin')

// Phase 6.1: per-document team scope for Manager writes. Admin/HR pass straight
// through (assertCanEditEmployee is a no-op for them), so existing behaviour is
// byte-for-byte preserved for those roles.
const withinTeam = async (req, res, next) => {
  try {
    const emp = await Employee.findById(req.params.id).select('email')
    if (!emp) return res.status(404).json({ message: 'Employee not found' })
    await assertCanEditEmployee(req.user, emp)
    return next()
  } catch (err) {
    return next(err)
  }
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
//     independently caps HR/Manager at 'Employee'. Two independent gates.
//   * A Manager's new hire is auto-linked into that Manager's own reporting
//     team, which keeps the Phase 6.1 team-scope rule (assertCanEditEmployee)
//     self-consistent: a Manager can only later edit people they created.
const canCreate = authorize('Admin', 'HR', 'Manager')

const forceEmployeeRole = (req, res, next) => {
  req.body = { ...(req.body || {}), role: 'Employee' }
  if (req.user.role === 'Manager' && !req.body.reportingManager) {
    req.body.reportingManager = req.user.name
  }
  next()
}

router.post('/', canCreate, forceEmployeeRole, asyncHandler(createUser))

// Writes (creation lives in Admin → Users — the single source of truth)
// Phase 6.1: `withinTeam` added after canWrite so a Manager can only save an
// employee inside their own reporting team.
router.put('/:id', canWrite, withinTeam, validateEmployeeUpdate, ctrl.update)
router.delete('/:id', canDelete, ctrl.remove)

// File uploads
router.post('/:id/photo', canWrite, withinTeam, uploadImage.single('photo'), ctrl.uploadPhoto)
router.post('/:id/documents', canWrite, withinTeam, upload.single('document'), ctrl.uploadDocument)

export default router
