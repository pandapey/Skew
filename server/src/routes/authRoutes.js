import { Router } from 'express'
import {
  login, logout, me, refresh, updateAvatar, deleteAvatar, changePassword,
} from '../controllers/authController.js'
import { protect } from '../middleware/auth.js'
import { uploadImage } from '../middleware/upload.js'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
// POST /auth/logout: closes the Activity session the browser opened at login
// (identified by the sessionId returned by /login). Requires the access token
// so the server knows WHO is logging out; always answers 200, idempotent.
router.post('/logout', protect, logout)
// Phase 8 (TASK 1): the self-service forgot/reset password flow is REMOVED.
// Password recovery is now handled by an administrator (POST /users/:id/
// reset-password in userRoutes.js) or by the signed-in user's own change
// password endpoint below — no emailed-token flow remains.
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
