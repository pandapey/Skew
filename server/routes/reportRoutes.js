import { Router } from 'express'
import { protect, blockClient } from '../middleware/auth.js'
import {
  dashboardReport, employeesReport, attendanceReport, leavesReport,
  financeReport, projectsReport, dashboardStats,
} from '../controllers/reportController.js'

const router = Router()

router.use(protect, blockClient)

// Home dashboard stats (consumed by dashboardService.stats in real mode).
router.get('/stats', dashboardStats)

// Each endpoint returns { kpis, charts, table } (dashboard returns { kpis, charts }).
// Optional query params: from, to (YYYY-MM-DD) and department.
router.get('/dashboard', dashboardReport)
router.get('/employees', employeesReport)
router.get('/attendance', attendanceReport)
router.get('/leaves', leavesReport)
router.get('/finance', financeReport)
router.get('/projects', projectsReport)

export default router
