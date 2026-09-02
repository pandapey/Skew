import { Router } from 'express'
import {
  login, logout, me, refresh, updateAvatar, deleteAvatar, changePassword, getAvatar,
} from '../controllers/authController.js'
import { protect } from '../middleware/auth.js'
import { uploadImage } from '../middleware/upload.js'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.post('/logout', protect, logout)
router.get('/me', protect, me)
router.get('/avatar/:fileId', getAvatar)
router.post('/me/avatar', protect, uploadImage.single('avatar'), updateAvatar)
router.delete('/me/avatar', protect, deleteAvatar)
router.post('/me/password', protect, changePassword)

export default router
