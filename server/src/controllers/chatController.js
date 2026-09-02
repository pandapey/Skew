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

export const createDirect = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.getOrCreateDirectConversation(req.user._id, req.body?.userId))
)

export const createGroup = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createGroup(req.user._id, req.body || {}))
)

export const getConversation = asyncHandler(async (req, res) =>
  res.json(await svc.getConversation(req.user._id, req.params.id))
)

export const listMessages = asyncHandler(async (req, res) =>
  res.json(await svc.listMessages(req.user._id, req.params.id, req.query))
)

export const sendMessage = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.sendMessage(req.user._id, req.params.id, req.body || {}))
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

export const addMember = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addGroupMember(req.user._id, req.params.id, req.body?.userId))
)

export const removeMember = asyncHandler(async (req, res) =>
  res.json(await svc.removeGroupMember(req.user._id, req.params.id, req.params.userId))
)

export const leaveGroup = asyncHandler(async (req, res) =>
  res.json(await svc.leaveGroup(req.user._id, req.params.id))
)

