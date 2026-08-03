import { Router } from 'express'
import { protect, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  listUsers, getUser, createUser, updateUser, resetPassword, removeUser,
  bulkUpdateUsers, bulkRemoveUsers, loginHistory, auditHistory,
  assignedProjects, userActivity,
} from '../controllers/userController.js'

const router = Router()

// All user-management routes require an authenticated staff admin.
router.use(protect, authorize('Admin'))

router.get('/', asyncHandler(listUsers))
router.get('/:id', asyncHandler(getUser))
router.post('/', asyncHandler(createUser))
router.put('/:id', asyncHandler(updateUser))
router.post('/:id/reset-password', asyncHandler(resetPassword))
router.delete('/:id', asyncHandler(removeUser))

// Bulk operations (ids in body, not path).
router.patch('/bulk', asyncHandler(bulkUpdateUsers))
router.delete('/bulk', asyncHandler(bulkRemoveUsers))

// Per-user derived histories (id is the user _id).
router.get('/:id/login-history', asyncHandler(loginHistory))
router.get('/:id/audit-history', asyncHandler(auditHistory))
router.get('/:id/assigned-projects', asyncHandler(assignedProjects))
router.get('/:id/activity', asyncHandler(userActivity))

export default router
