import { Router } from 'express'
import { announcementController as ctrl } from '../controllers/announcementController.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { upload } from '../middleware/upload.js'

const router = Router()
const canWrite = authorize('Admin', 'Manager')
router.use(protect, blockClient)
router.get('/', asyncHandler(ctrl.list))
router.get('/unread-count', asyncHandler(ctrl.unreadCount))
router.get('/:id', asyncHandler(ctrl.get))
router.post('/', canWrite, asyncHandler(ctrl.create))
router.put('/:id', canWrite, asyncHandler(ctrl.update))
router.delete('/:id', canWrite, asyncHandler(ctrl.remove))
router.patch('/:id/like', asyncHandler(ctrl.like))
router.post('/:id/read', asyncHandler(ctrl.markRead))
router.post('/:id/comments', asyncHandler(ctrl.comment))
router.post('/:id/media', upload.single('media'), asyncHandler(ctrl.uploadMedia))
router.get('/:id/attachments/:attId/download', asyncHandler(ctrl.downloadMedia))
router.get('/:id/attachments/:attId/raw', asyncHandler(ctrl.downloadMedia))

export default router
