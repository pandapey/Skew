import { Router } from 'express'
import { protect, blockClient } from '../middleware/auth.js'
import { uploadChat } from '../middleware/upload.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import * as chat from '../controllers/chatController.js'

const router = Router()

router.use(protect, blockClient)
router.get('/users', asyncHandler(chat.listUsers))
router.get('/conversations', asyncHandler(chat.listConversations))
router.get('/unread-count', asyncHandler(chat.unreadCount))
router.get('/presence', asyncHandler(chat.presence))
router.get('/blocked', asyncHandler(chat.blocked))
router.post('/block', asyncHandler(chat.block))
router.delete('/block/:userId', asyncHandler(chat.unblock))
router.post('/conversations/direct', asyncHandler(chat.createDirect))
router.post('/conversations/groups', asyncHandler(chat.createGroup))
router.get('/join/:code', asyncHandler(chat.joinInvite))
router.get('/conversations/:id', asyncHandler(chat.getConversation))
router.delete('/conversations/:id', asyncHandler(chat.deleteConversation))
router.patch('/conversations/:id', asyncHandler(chat.updateGroup))
router.post('/conversations/:id/admin', asyncHandler(chat.setAdmin))
router.post('/conversations/:id/settings', asyncHandler(chat.setSettings))
router.post('/conversations/:id/invite', asyncHandler(chat.invite))
router.post('/conversations/:id/pref', asyncHandler(chat.pref))
router.post('/conversations/:id/clear', asyncHandler(chat.clear))
router.get('/conversations/:id/messages', asyncHandler(chat.listMessages))
router.get('/conversations/:id/messages/search', asyncHandler(chat.searchMessages))
router.get('/conversations/:id/starred', asyncHandler(chat.starred))
router.get('/conversations/:id/media', asyncHandler(chat.media))
router.post('/conversations/:id/messages', asyncHandler(chat.sendMessage))
router.post('/conversations/:id/forward', asyncHandler(chat.forward))
router.patch('/conversations/:id/messages/:messageId', asyncHandler(chat.editMessage))
router.delete('/conversations/:id/messages/:messageId', asyncHandler(chat.deleteMessage))
router.post('/conversations/:id/messages/:messageId/star', asyncHandler(chat.star))
router.post('/conversations/:id/messages/:messageId/react', asyncHandler(chat.react))
router.post('/conversations/:id/messages/:messageId/poll', asyncHandler(chat.pollVote))
router.get('/conversations/:id/messages/:messageId/info', asyncHandler(chat.info))
router.post('/conversations/:id/read', asyncHandler(chat.markRead))
router.post('/conversations/:id/delivered', asyncHandler(chat.markDelivered))
router.post('/conversations/:id/attachments', uploadChat.single('file'), asyncHandler(chat.uploadAttachment))
router.get('/conversations/:id/attachments/:fileId', asyncHandler(chat.downloadAttachment))
router.post('/conversations/:id/members', asyncHandler(chat.addMember))
router.delete('/conversations/:id/members/:userId', asyncHandler(chat.removeMember))
router.post('/conversations/:id/leave', asyncHandler(chat.leaveGroup))

export default router
