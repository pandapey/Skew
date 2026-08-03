import { Router } from 'express'
import { announcementController as ctrl } from '../controllers/announcementController.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { upload } from '../middleware/upload.js'

const router = Router()

// Only privileged roles may create / edit / delete posts.
const canWrite = authorize('Admin', 'HR', 'Manager')

// Internal company feed — external clients have their own scoped portal.
router.use(protect, blockClient)

// Reads
router.get('/', asyncHandler(ctrl.list))
router.get('/:id', asyncHandler(ctrl.get))

// Writes (privileged)
router.post('/', canWrite, asyncHandler(ctrl.create))
router.put('/:id', canWrite, asyncHandler(ctrl.update))
router.delete('/:id', canWrite, asyncHandler(ctrl.remove))

// Anyone authenticated may like, comment and attach media.
router.patch('/:id/like', asyncHandler(ctrl.like))
router.post('/:id/comments', asyncHandler(ctrl.comment))
router.post('/:id/media', upload.single('media'), asyncHandler(ctrl.uploadMedia))

export default router
