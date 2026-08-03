import { Router } from 'express'
import {
  login, me, refresh, forgotPassword, resetPassword, updateAvatar, deleteAvatar, changePassword,
} from '../controllers/authController.js'
import { protect } from '../middleware/auth.js'
import { uploadImage } from '../middleware/upload.js'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.get('/me', protect, me)
// Self-serve avatar upload (any authenticated user, own record only).
router.post('/me/avatar', protect, uploadImage.single('avatar'), updateAvatar)
// Phase 6.3 (Task 9): self-serve avatar REMOVAL. Same `protect`-only guard as
// the upload above and deliberately NOT blockClient, because a Client must be
// able to manage their own profile picture. The controller reads req.user, so
// there is no id to tamper with and no cross-user access.
router.delete('/me/avatar', protect, deleteAvatar)
// Phase 5.5 (Task 1): self-serve password change. Only `protect` is applied —
// deliberately NOT blockClient, because every role including Client must be
// able to rotate their own credential. The controller derives the target user
// from req.user, so there is no id to tamper with and no privilege escalation.
router.post('/me/password', protect, changePassword)

export default router
