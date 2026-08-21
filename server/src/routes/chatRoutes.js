// Chat routes — internal staff messaging (Admin / HR / Manager / Employee).
//
// SECURITY:
//   * Every route is guarded by `protect, blockClient` — Clients get 403 and
//     cannot reach any internal chat endpoint (frontend hiding is not the
//     enforcement; the server rejects them here).
//   * Conversation-scoped routes additionally verify participant membership
//     inside chatService (assertParticipant), and group member management is
//     restricted to the group creator or an Admin-role user.
//   * Static segments ('users', 'conversations/direct', 'conversations/groups')
//     are declared BEFORE '/conversations/:id' so they are never shadowed by
//     the parameter route.
import { Router } from 'express'
import { protect, blockClient } from '../middleware/auth.js'
import { uploadChat } from '../middleware/upload.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import * as chat from '../controllers/chatController.js'

const router = Router()

router.use(protect, blockClient)

// Internal user directory for the "start a chat" picker.
router.get('/users', asyncHandler(chat.listUsers))

// Conversation collection (list / find-or-create).
router.get('/conversations', asyncHandler(chat.listConversations))
// PHASE: EMPLOYEE CHAT (REQUIREMENT 7) — total unread badge count.
router.get('/unread-count', asyncHandler(chat.unreadCount))
router.post('/conversations/direct', asyncHandler(chat.createDirect))
router.post('/conversations/groups', asyncHandler(chat.createGroup))

// Single conversation + messages.
router.get('/conversations/:id', asyncHandler(chat.getConversation))
router.get('/conversations/:id/messages', asyncHandler(chat.listMessages))
router.post('/conversations/:id/messages', asyncHandler(chat.sendMessage))
router.post('/conversations/:id/read', asyncHandler(chat.markRead))

// Attachments — upload via multer (bytes land in chat-uploads/, outside the
// public static dir) and download through an authenticated, participant-checked
// route so chat files are never reachable by URL guessing.
router.post('/conversations/:id/attachments', uploadChat.single('file'), asyncHandler(chat.uploadAttachment))
router.get('/conversations/:id/attachments/:fileId', asyncHandler(chat.downloadAttachment))

// Group membership management.
router.post('/conversations/:id/members', asyncHandler(chat.addMember))
router.delete('/conversations/:id/members/:userId', asyncHandler(chat.removeMember))
router.post('/conversations/:id/leave', asyncHandler(chat.leaveGroup))

export default router
