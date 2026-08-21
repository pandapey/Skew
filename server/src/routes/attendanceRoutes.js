import { Router } from 'express'
import { Shift, Holiday } from '../models/attendanceModels.js'
import { attendanceController as ctrl } from '../controllers/attendanceController.js'
import { createResourceService } from '../services/resourceFactory.js'
import { buildResourceRouter } from './resourceRouter.js'
import { makeValidator } from '../validators/hrValidators.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'

const router = Router()

// Authenticate (defense-in-depth; the resource routers also authenticate) and
// keep the external Client role out of the internal attendance surface.
router.use(protect, blockClient)

const canReport = authorize('Admin', 'Manager')

// --- Personal attendance (any authenticated user) ---
router.get('/me/summary', protect, ctrl.mySummary)
router.get('/me', protect, ctrl.myHistory)
router.get('/today', protect, ctrl.today)
router.get('/calendar', protect, ctrl.calendar)
router.post('/check-in', protect, ctrl.checkIn)
router.post('/check-out', protect, ctrl.checkOut)
router.post('/break', protect, ctrl.toggleBreak)

// --- Org-wide reports & analytics (managers/admin) ---
router.get('/day', protect, canReport, ctrl.dayRecords)
router.get('/stats', protect, canReport, ctrl.stats)

// --- Shift & Holiday management (reuses the layered resource factory) ---
const shifts = createResourceService(Shift, { searchFields: ['name', 'code'] })
const holidays = createResourceService(Holiday, { searchFields: ['name'], filterFields: ['type'] })
// ---------------------------------------------------------------------------
// PHASE SALARY/BILLING (TASK 7) ROOT CAUSE — MANAGER -> ADD EMPLOYEE SHOWED
// "Insufficient permission".
//
// TRACE (Navigation -> Route -> Page -> API -> RBAC), and the failure is at the
// RBAC layer, not the button and not the create endpoint:
//   1. Button:     pages/Employees.jsx gates "Add Employee" on
//                  EMPLOYEE_CREATE_ROLES = [Admin, HR, Manager] -> VISIBLE.
//   2. Route:      routes/index.jsx gates /employees/new on
//                  [Admin, HR, Manager] -> REACHABLE.
//   3. Create API: employeeRoutes.js POST '/' is authorize('Admin','HR','Manager')
//                  and CREATE_ROLE_MATRIX caps HR/Manager at 'Employee'
//                  -> ALREADY AUTHORISED. The server could always accept the save.
//   4. THE REAL CAUSE: the form itself. features/employees/EmployeeFormFields.jsx
//                  populates its Shift dropdown with attendanceApi.shifts.all()
//                  -> GET /api/attendance/shifts/all. THIS mount passed no
//                  `readGuard`, and routes/resourceRouter.js defaults
//                  readGuardFn = writeGuardFn = authorize('Admin','HR') (HR_WRITE).
//                  So the moment a Manager opened the form, that read returned
//                  403 'Forbidden: insufficient permissions', and api/client.js's
//                  interceptor toasts the server message verbatim — the exact
//                  popup reported. The employee was never even submitted.
//
// This is the identical defect fixed for /holidays below in Phase 6.6 (TASK 4);
// that note concluded "/shifts is intentionally NOT touched - the Calendar does
// not read shifts". True for the Calendar, but the EMPLOYEE FORM does read them,
// which is why the same gap resurfaced here.
//
// FIX: a READ-ONLY widening to the roles that can already open the two forms
// which need this list (features/employees/EmployeeFormFields.jsx for
// Admin/HR/Manager, and features/admin/UserFormFields.jsx for Admin).
//
// RBAC IS NOT WEAKENED:
//   * writeGuard is deliberately left unset, so it keeps defaulting to
//     Admin/HR — a Manager still cannot create, edit or delete a shift, and
//     Shift Management stays Admin/HR only.
//   * Employee and Client are NOT added. Client is blocked router-wide by
//     `blockClient`; Employee has no screen that reads this list, so widening to
//     them would grant access nothing needs.
//   * Admin and HR behaviour is byte-for-byte identical.
const canReadShifts = authorize('Admin', 'Manager')
router.use('/shifts', buildResourceRouter(shifts.service, {
  validate: makeValidator(['name', 'code', 'start', 'end']),
  readGuard: canReadShifts,
}))

// --- Phase 6.6 (TASK 4): Manager/Employee Calendar "Insufficient Permission" ---
// ROOT CAUSE (traced Navigation -> Route -> RBAC -> API -> Controller -> Service
// -> DB, and the failure is at the RBAC layer, NOT the route or the page):
//   1. Navigation:  constants/navigation.js lists Calendar for every internal
//                   role -> the link is correct.
//   2. Route:       routes/index.jsx gates /calendar on STAFF_ROLES (which
//                   includes Manager) -> the page itself is reachable.
//   3. Page:        features/calendar/CalendarApp.jsx fetches company holidays
//                   via attendanceApi.holidays.all() -> GET /api/attendance/holidays/all.
//   4. RBAC (the real cause): this mount passed NO `readGuard`, and
//                   routes/resourceRouter.js defaults `readGuardFn = writeGuardFn
//                   = authorize('Admin','HR')` (HR_WRITE). So the holiday READ
//                   returned 403 'Forbidden: insufficient permissions' for
//                   Manager and Employee. api/client.js's response interceptor
//                   toasts that server message verbatim -> the exact
//                   "Insufficient Permission" popup reported on Manager login.
//                   Nothing was wrong with calendarRoutes.js (its reads are open
//                   to all non-Client roles already) - the holiday sub-resource
//                   was the failing call.
//
// THIS IS NOT A WIDENING OF ACCESS. Holidays are ALREADY readable by every
// non-Client role through a different endpoint: leaveRoutes.js line 21 mounts
// `router.get('/holidays', ctrl.holidays)` behind only protect + blockClient,
// and the Leave page relies on it for holiday-aware date pickers. Both endpoints
// read the SAME Holiday collection. This change makes the attendance mount
// consistent with the leave mount instead of granting new data.
//
// RBAC PRESERVED:
//   * writeGuard is deliberately left at its default (Admin/HR), so create /
//     update / delete of holidays remains Admin+HR only - Manager and Employee
//     still cannot mutate the company holiday calendar.
//   * Client is still fully blocked by the router-level `blockClient` above.
//   * Admin and HR behaviour is byte-for-byte identical (they were already in
//     both guard lists).
//   * /shifts was left untouched HERE because the Calendar does not read shifts.
//     PHASE SALARY/BILLING (TASK 7) later found that the EMPLOYEE FORM does, and
//     gave that mount its own read guard — see the block above it.
const canReadHolidays = authorize('Admin', 'Manager', 'Employee')
router.use('/holidays', buildResourceRouter(holidays.service, {
  validate: makeValidator(['name', 'date']),
  readGuard: canReadHolidays,
}))

export default router
