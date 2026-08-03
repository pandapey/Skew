import { Router } from 'express'
import { protect, blockClient } from '../middleware/auth.js'
import {
  listNotifications, markRead, markAllRead, getSettings, updateSettings,
  createNotification, unreadCount,
} from '../controllers/notificationController.js'

const router = Router()

router.use(protect, blockClient)

router.get('/', listNotifications)
router.get('/unread-count', unreadCount)
router.post('/read-all', markAllRead)
router.get('/settings', getSettings)
router.put('/settings', updateSettings)
router.post('/', createNotification)
router.patch('/:id/read', markRead)

export default router
