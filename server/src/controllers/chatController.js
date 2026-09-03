import { asyncHandler } from '../utils/asyncHandler.js'
import * as svc from '../services/chatService.js'

export const listUsers = asyncHandler(async (req, res) =>
  res.json(await svc.listChatUsers())
)

export const listConversations = asyncHandler(async (req, res) =>
  res.json(await svc.listConversations(req.user._id))
)

export const unreadCount = asyncHandler(async (req, res) =>
  res.json(await svc.totalUnreadCount(req.user._id))
)

export const presence = asyncHandler(async (req, res) =>
  res.json(await svc.getPresence((req.query.ids || '').split(',').filter(Boolean)))
)

export const blocked = asyncHandler(async (req, res) =>
  res.json(await svc.getBlockedUsers(req.user._id))
)

export const block = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.blockUser(req.user._id, req.body?.userId))
)

export const unblock = asyncHandler(async (req, res) =>
  res.json(await svc.unblockUser(req.user._id, req.params.userId))
)

export const createDirect = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.getOrCreateDirectConversation(req.user._id, req.body?.userId))
)

export const createGroup = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createGroup(req.user._id, req.body || {}))
)

export const updateGroup = asyncHandler(async (req, res) =>
  res.json(await svc.updateGroupInfo(req.user._id, req.params.id, req.body || {}))
)

export const setAdmin = asyncHandler(async (req, res) =>
  res.json(await svc.setGroupAdmin(req.user._id, req.params.id, req.body?.userId, req.body?.makeAdmin !== false))
)

export const setSettings = asyncHandler(async (req, res) =>
  res.json(await svc.setGroupSettings(req.user._id, req.params.id, req.body || {}))
)

export const invite = asyncHandler(async (req, res) =>
  res.json(await svc.generateInviteCode(req.user._id, req.params.id))
)

export const joinInvite = asyncHandler(async (req, res) =>
  res.json(await svc.joinViaInvite(req.user._id, req.params.code))
)

export const pref = asyncHandler(async (req, res) =>
  res.json(await svc.setConversationPref(req.user._id, req.params.id, req.body || {}))
)

export const clear = asyncHandler(async (req, res) =>
  res.json(await svc.clearChat(req.user._id, req.params.id))
)

export const getConversation = asyncHandler(async (req, res) =>
  res.json(await svc.getConversation(req.user._id, req.params.id))
)

export const listMessages = asyncHandler(async (req, res) =>
  res.json(await svc.listMessages(req.user._id, req.params.id, req.query))
)

export const searchMessages = asyncHandler(async (req, res) =>
  res.json(await svc.searchMessages(req.user._id, req.params.id, req.query.q))
)

export const starred = asyncHandler(async (req, res) =>
  res.json(await svc.getStarredMessages(req.user._id, req.params.id))
)

export const media = asyncHandler(async (req, res) =>
  res.json(await svc.getMediaMessages(req.user._id, req.params.id, req.query.kind))
)

export const sendMessage = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.sendMessage(req.user._id, req.params.id, req.body || {}))
)

export const forward = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.forwardMessage(req.user._id, req.body?.messageId, req.params.id))
)

export const editMessage = asyncHandler(async (req, res) =>
  res.json(await svc.editMessage(req.user._id, req.params.id, req.params.messageId, req.body?.text))
)

export const deleteMessage = asyncHandler(async (req, res) => {
  const raw = req.query.forEveryone
  const forEveryone = String(raw).toLowerCase() === 'true'
  return res.json(await svc.deleteMessage(req.user._id, req.params.id, req.params.messageId, forEveryone))
})

export const deleteConversation = asyncHandler(async (req, res) =>
  res.json(await svc.deleteConversation(req.user._id, req.params.id))
)

export const star = asyncHandler(async (req, res) =>
  res.json(await svc.toggleStar(req.user._id, req.params.id, req.params.messageId))
)

export const react = asyncHandler(async (req, res) =>
  res.json(await svc.toggleReaction(req.user._id, req.params.id, req.params.messageId, req.body?.emoji))
)

export const pollVote = asyncHandler(async (req, res) =>
  res.json(await svc.votePoll(req.user._id, req.params.id, req.params.messageId, req.body?.optionIndex))
)

export const info = asyncHandler(async (req, res) =>
  res.json(await svc.getMessageInfo(req.user._id, req.params.id, req.params.messageId))
)

export const uploadAttachment = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.uploadChatAttachment(req.user._id, req.params.id, req.file))
)

export const downloadAttachment = asyncHandler(async (req, res) => {
  const result = await svc.getChatAttachment(req.user._id, req.params.id, req.params.fileId)
  if (result.isDrive) {
    const { driveDownload } = await import('../utils/driveUpload.js')
    res.setHeader('Content-Disposition', `attachment; filename="${result.name}"`)
    return driveDownload(result.driveId, res)
  }
  res.download(result.absPath, result.name)
})

export const markRead = asyncHandler(async (req, res) =>
  res.json(await svc.markConversationRead(req.user._id, req.params.id))
)

export const markDelivered = asyncHandler(async (req, res) =>
  res.json(await svc.markDelivered(req.user._id, req.params.id, req.body?.messageIds))
)

export const addMember = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addGroupMember(req.user._id, req.params.id, req.body?.userId))
)

export const removeMember = asyncHandler(async (req, res) =>
  res.json(await svc.removeGroupMember(req.user._id, req.params.id, req.params.userId))
)

export const leaveGroup = asyncHandler(async (req, res) =>
  res.json(await svc.leaveGroup(req.user._id, req.params.id))
)
