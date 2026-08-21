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

// Bulk operations (ids in body, not path). Declared BEFORE the
// parameterized routes: Express matches layers in REGISTRATION ORDER, so the
// old position (after router.delete('/:id')) meant DELETE /api/users/bulk was
// swallowed by DELETE /api/users/:id with id='bulk' — removeUser() then threw a
// Mongoose CastError ("Invalid _id: bulk", HTTP 400) and the selected users
// were never deleted. Single-record DELETE /api/users/:id is unchanged.
router.patch('/bulk', asyncHandler(bulkUpdateUsers))
router.delete('/bulk', asyncHandler(bulkRemoveUsers))

router.delete('/:id', asyncHandler(removeUser))

// Per-user derived histories (id is the user _id).
router.get('/:id/login-history', asyncHandler(loginHistory))
router.get('/:id/audit-history', asyncHandler(auditHistory))
router.get('/:id/assigned-projects', asyncHandler(assignedProjects))
router.get('/:id/activity', asyncHandler(userActivity))

export default router
