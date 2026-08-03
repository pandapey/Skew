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

const canReport = authorize('Admin', 'HR', 'Manager')

// --- Personal attendance (any authenticated user) ---
router.get('/me/summary', protect, ctrl.mySummary)
router.get('/me', protect, ctrl.myHistory)
router.get('/today', protect, ctrl.today)
router.get('/calendar', protect, ctrl.calendar)
router.post('/check-in', protect, ctrl.checkIn)
router.post('/check-out', protect, ctrl.checkOut)
router.post('/break', protect, ctrl.toggleBreak)

// --- Org-wide reports & analytics (managers/HR/admin) ---
router.get('/day', protect, canReport, ctrl.dayRecords)
router.get('/stats', protect, canReport, ctrl.stats)

// --- Shift & Holiday management (reuses the layered resource factory) ---
const shifts = createResourceService(Shift, { searchFields: ['name', 'code'] })
const holidays = createResourceService(Holiday, { searchFields: ['name'], filterFields: ['type'] })
router.use('/shifts', buildResourceRouter(shifts.service, { validate: makeValidator(['name', 'code', 'start', 'end']) }))

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
//   * /shifts is intentionally NOT touched - the Calendar does not read shifts,
//     so widening it would be an unnecessary change.
const canReadHolidays = authorize('Admin', 'HR', 'Manager', 'Employee')
router.use('/holidays', buildResourceRouter(holidays.service, {
  validate: makeValidator(['name', 'date']),
  readGuard: canReadHolidays,
}))

export default router
