import { Router } from 'express'
import { LeaveType } from '../models/leaveModels.js'
import { leaveController as ctrl } from '../controllers/leaveController.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { makeValidator } from '../validators/hrValidators.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'

const router = Router()
const canApprove = authorize('Admin', 'HR', 'Manager')
const canManage = authorize('Admin', 'HR')
const validateType = makeValidator(['name', 'code'])

// Normalize _id -> id so responses match the frontend contract.
const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)

router.use(protect, blockClient)

// --- Personal (any authenticated user) ---
router.get('/me', ctrl.myRequests)
router.get('/balances', ctrl.balances)
router.get('/holidays', ctrl.holidays)
router.post('/apply', ctrl.apply)

// --- Phase 5.5 (Task 4): hourly permission (any authenticated staff user) ---
// Placed alongside the personal leave endpoints because it is the same kind of
// self-service action and is governed by the same router-level `protect` +
// `blockClient` guards applied above. Approval reuses the existing
// /requests/:id/approve and /requests/:id/reject routes — no parallel
// approval endpoints were added.
router.get('/hourly-balance', ctrl.hourlyBalance)
router.post('/hourly-permission', ctrl.applyHourly)

// --- Leave type CRUD (HR/Admin) ---
router.get('/types', asyncHandler(async (req, res) => {
  const { page = 1, limit = 8 } = req.query
  const pageNum = Math.max(1, Number(page))
  const limitNum = Math.min(100, Math.max(1, Number(limit)))
  const [rows, total] = await Promise.all([
    LeaveType.find().sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    LeaveType.countDocuments(),
  ])
  res.json({ data: rows.map(withId), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) })
}))
router.post('/types', canManage, validateType, asyncHandler(async (req, res) => {
  const doc = await LeaveType.create(req.body)
  res.status(201).json(withId(doc.toObject()))
}))
router.put('/types/:id', canManage, asyncHandler(async (req, res) => {
  const doc = await LeaveType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).lean()
  if (!doc) throw new ApiError(404, 'Leave type not found')
  res.json(withId(doc))
}))
router.delete('/types/:id', canManage, asyncHandler(async (req, res) => {
  const doc = await LeaveType.findByIdAndDelete(req.params.id)
  if (!doc) throw new ApiError(404, 'Leave type not found')
  res.json({ id: req.params.id })
}))

// --- Org-wide requests, approvals & analytics (managers/HR/admin) ---
router.get('/requests', canApprove, ctrl.list)
router.get('/stats', canApprove, ctrl.stats)
router.get('/requests/:id', ctrl.get)
router.patch('/requests/:id/approve', canApprove, ctrl.approve)
router.patch('/requests/:id/reject', canApprove, ctrl.reject)
router.patch('/requests/:id/cancel', ctrl.cancel)
router.delete('/requests/:id', canManage, ctrl.remove)

export default router
