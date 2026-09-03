import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FiEdit, FiUsers, FiSend, FiArrowLeft, FiMessageSquare,
  FiInfo, FiPaperclip, FiX, FiDownload, FiFileText, FiFile, FiExternalLink,
  FiSearch, FiMoreVertical, FiStar, FiTrash2, FiCornerUpLeft, FiSmile, FiShare2,
  FiMapPin, FiUser, FiBarChart2, FiEye, FiVolume2, FiMic, FiArchive, FiVolumeX, FiBookmark, FiTrash, FiCopy,
} from 'react-icons/fi'
import { Card, Avatar, Button, Loader, EmptyState, PageHeader, Modal } from '@/components/ui'
import { getSocket } from '@/api/socket'
import { chatApi } from '@/api/chatService'
import apiClient from '@/api/client'
import { QK, messageTime, listTime, lastSeenText, directPeer, formatBytes, tickStatus, groupedReactions, QUICK_EMOJIS } from './chatUtils'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { MembersPanel } from './MembersPanel'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/utils'
import toast from 'react-hot-toast'

const IMAGE_KINDS = new Set(['image', 'gif', 'png', 'jpeg', 'jpg', 'webp'])

function useAttachmentBlob(message) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const att = message?.attachment
  useEffect(() => {
    if (!att?.fileId || !att?.url) return
    let objectUrl = null
    let cancelled = false
    setFailed(false)
    setUrl(null)
    apiClient.get(att.url, { responseType: 'blob', skipErrorToast: true })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [att?.fileId, att?.url])
  return { url, failed }
}

function AttachmentActions({ url, fileName, onView }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onView} className="flex items-center gap-1 rounded-lg border border-white/20 bg-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition hover:border-primary/40" aria-label={`Open ${fileName}`}>
        <FiExternalLink className="h-3 w-3" /> Open
      </button>
      {url && (
        <a href={url} download={fileName} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded-lg border border-white/20 bg-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition hover:border-primary/40" aria-label={`Download ${fileName}`}>
          <FiDownload className="h-3 w-3" /> Download
        </a>
      )}
    </div>
  )
}

function AttachmentView({ attachment }) {
  const { url, failed } = useAttachmentBlob({ attachment })
  const mime = (attachment?.mimeType || '').split('/')[1]
  const isImage = attachment?.kind === 'image' || IMAGE_KINDS.has(mime)
  const isPdf = attachment?.kind === 'pdf' || attachment?.mimeType === 'application/pdf'
  const isVideo = attachment?.kind === 'video'
  const isAudio = attachment?.kind === 'audio'
  const DocIcon = attachment?.kind === 'excel' ? FiFile : FiFileText
  const fileName = attachment?.name || 'Document'
  const openFile = () => { if (url) window.open(url, '_blank', 'noopener') }

  if (failed) return <div className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs">Attachment unavailable.</div>
  if (attachment?.viewOnce && !url) return <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs flex items-center gap-2"><FiEye className="h-4 w-4" /> View once photo — tap to view (expired if already opened)</div>
  if (isImage && url) return <div className="mt-1 flex flex-col items-start gap-1"><img src={url} alt={fileName} onClick={openFile} className="max-h-64 max-w-full cursor-pointer rounded-xl border border-white/20 object-cover transition hover:border-primary/40" /><AttachmentActions url={url} fileName={fileName} onView={openFile} /></div>
  if (isPdf && url) return <div className="mt-1 flex flex-col gap-1"><iframe src={url} title={fileName} className="h-72 w-full max-w-full rounded-xl border border-white/20 bg-white" /><AttachmentActions url={url} fileName={fileName} onView={openFile} /></div>
  if (isVideo && url) return <div className="mt-1 flex flex-col items-start gap-1"><video src={url} controls className="max-h-64 max-w-full rounded-xl" /><AttachmentActions url={url} fileName={fileName} onView={openFile} /></div>
  if (isAudio && url) return <div className="mt-1 flex flex-col items-start gap-1"><audio src={url} controls className="h-9 w-56 max-w-full" /><AttachmentActions url={url} fileName={fileName} onView={openFile} /></div>
  return (
    <div className="mt-1 flex flex-col gap-1">
      <button type="button" onClick={openFile} className="flex items-center gap-2 rounded-xl border border-white/20 bg-black/10 px-2.5 py-2 text-left transition hover:border-primary/40" aria-label={`Open ${fileName}`}>
        <DocIcon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-xs font-medium">{fileName}</span><span className="flex-none text-[10px] opacity-70">{formatBytes(attachment?.size)}</span>
      </button>
      <AttachmentActions url={url} fileName={fileName} onView={openFile} />
    </div>
  )
}

function Tick({ status }) {
  if (!status) return null
  if (status === 'sent') return <span className="ml-1 text-[11px] opacity-70">✓</span>
  if (status === 'delivered') return <span className="ml-1 text-[11px] opacity-70">✓✓</span>
  if (status === 'read') return <span className="ml-1 text-[11px] text-sky-400">✓✓</span>
  return null
}

function ConversationItem({ conversation, active, onClick, onAction }) {
  const { user: me } = useAuth()
  const peer = directPeer(conversation)
  const displayName = conversation.isGroup ? conversation.name : (peer?.name || 'Unknown user')
  const avatarSrc = conversation.isGroup ? conversation.icon || '' : peer?.avatar || ''
  const last = conversation.lastMessage
  const isMine = last && String(last.sender) === String(me?._id)
  const preview = !last ? 'No messages yet' : `${isMine ? 'You: ' : ''}${last.hasAttachment ? '📎 Attachment' : (last.text || '')}`
  const unread = conversation.unreadCount || 0
  return (
    <div className={cn('group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', active ? 'bg-gradient-to-r from-primary to-accent shadow-glow-primary' : 'hover:bg-black/5 dark:hover:bg-white/10')}>
      <button type="button" onClick={onClick} className="flex flex-1 items-center gap-3 text-left">
        <div className="relative">
          <Avatar name={conversation.isGroup ? conversation.name : (peer?.name || '?')} src={avatarSrc} size={44} ring={false} />
          {conversation.isPinned && <FiBookmark className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-amber-400 p-0.5 text-white" />}
          {peer?.isOnline && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-sm font-semibold flex items-center gap-1', active && 'text-white')}>{displayName} {conversation.isMuted && <FiVolumeX className="h-3 w-3 opacity-60" />} {conversation.isArchived && <FiArchive className="h-3 w-3 opacity-60" />}</span>
            {last?.at && <span className={cn('flex-none text-[11px]', active ? 'text-white/80' : 'text-muted')}>{listTime(last.at)}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn('truncate text-xs', active ? 'text-white/85' : 'text-muted')}>{preview}</span>
            {unread > 0 && <span className={cn('flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white text-primary' : 'bg-primary text-white')}>{unread > 99 ? '99+' : unread}</span>}
          </span>
        </span>
      </button>
      <div className="hidden group-hover:flex items-center gap-1">
        <button onClick={() => onAction?.('pin', conversation)} className="rounded-md p-1 hover:bg-black/10" title={conversation.isPinned ? 'Unpin' : 'Pin'}><FiBookmark className="h-3.5 w-3.5" /></button>
        <button onClick={() => onAction?.('mute', conversation)} className="rounded-md p-1 hover:bg-black/10" title={conversation.isMuted ? 'Unmute' : 'Mute'}><FiVolumeX className="h-3.5 w-3.5" /></button>
        <button onClick={() => onAction?.('archive', conversation)} className="rounded-md p-1 hover:bg-black/10" title={conversation.isArchived ? 'Unarchive' : 'Archive'}><FiArchive className="h-3.5 w-3.5" /></button>
        <button onClick={() => onAction?.('delete', conversation)} className="rounded-md p-1 hover:bg-danger/10 hover:text-danger" title="Delete chat"><FiTrash className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

function MessageBubble({ message, mine, onReply, onEdit, onDelete, onStar, onReact, onForward, onInfo, meId, participantCount }) {
  const [showMenu, setShowMenu] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const status = tickStatus(message, meId, participantCount)
  const grouped = groupedReactions(message.reactions)
  const isSystem = message.messageType === 'system'
  if (isSystem) return <div className="flex justify-center"><span className="rounded-full bg-black/5 px-3 py-1 text-[11px] text-muted dark:bg-white/10">{message.text}</span></div>
  if (message.isDeleted || message.isDeletedForEveryone) return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm italic opacity-60', mine ? 'rounded-br-md bg-gradient-to-br from-primary/50 to-accent/50 text-white' : 'rounded-bl-md border border-app bg-surface')}>
        <p className="flex items-center gap-1"><FiTrash2 className="h-3 w-3" /> {message.isDeletedForEveryone ? 'This message was deleted' : 'You deleted this message'}</p>
        <p className={cn('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-muted')}>{messageTime(message.createdAt)}</p>
      </div>
    </div>
  )
  return (
    <div className={cn('group relative flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-floating-sm sm:max-w-[70%] relative', mine ? 'rounded-br-md bg-gradient-to-br from-primary to-accent text-white' : 'rounded-bl-md border border-app bg-surface')}>
        {message.forwarded && <p className="mb-1 flex items-center gap-1 text-[10px] italic opacity-70"><FiShare2 className="h-3 w-3" /> Forwarded</p>}
        {message.replyTo?.messageId && (
          <div className={cn('mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs', mine ? 'border-white/50 bg-white/15' : 'border-primary/40 bg-black/5 dark:bg-white/5')}>
            <p className="font-semibold text-[11px]">{message.replyTo.senderName}</p>
            <p className="truncate opacity-80">{message.replyTo.hasAttachment ? '📎 Attachment' : message.replyTo.text}</p>
          </div>
        )}
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text} {message.isEdited && <span className="text-[10px] opacity-60">(edited)</span>}</p>}
        {message.attachment?.fileId && <AttachmentView attachment={message.attachment} />}
        {grouped.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {grouped.map((g) => <span key={g.emoji} className="rounded-full border border-white/20 bg-black/10 px-1.5 py-0.5 text-[11px]">{g.emoji} {g.count}</span>)}
          </div>
        )}
        <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-white/70' : 'text-muted')}>
          {message.starredBy?.includes(String(meId)) && <FiStar className="h-3 w-3 fill-amber-400 text-amber-400" />}
          {messageTime(message.createdAt)}
          {mine && <Tick status={status} />}
        </p>
        <div className={cn('absolute top-1 hidden group-hover:flex items-center gap-0.5 rounded-full border border-app bg-surface px-1 py-0.5 shadow', mine ? '-left-16' : '-right-16')}>
          <button onClick={() => setShowReactions((v) => !v)} className="rounded-full p-1 hover:bg-black/5" title="React"><FiSmile className="h-3.5 w-3.5" /></button>
          <button onClick={() => onReply(message)} className="rounded-full p-1 hover:bg-black/5" title="Reply"><FiCornerUpLeft className="h-3.5 w-3.5" /></button>
          <button onClick={() => setShowMenu((v) => !v)} className="rounded-full p-1 hover:bg-black/5" title="More"><FiMoreVertical className="h-3.5 w-3.5" /></button>
        </div>
        {showReactions && (
          <div className="absolute top-full mt-2 left-0 flex items-center gap-1 rounded-full border border-app bg-surface px-2 py-1 shadow-lg z-20">
            {QUICK_EMOJIS.map((e) => <button key={e} onClick={() => { onReact(message._id, e); setShowReactions(false) }} className="hover:scale-125 transition text-base">{e}</button>)}
            <button onClick={() => setShowReactions(false)} className="ml-1 text-muted"><FiX className="h-3 w-3" /></button>
          </div>
        )}
        {showMenu && (
          <div className="absolute right-0 top-8 w-44 rounded-xl border border-app bg-surface shadow-lg z-20 p-1 text-xs">
            <button onClick={() => { onReply(message); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiCornerUpLeft className="h-3.5 w-3.5" /> Reply</button>
            <button onClick={() => { onForward(message); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiShare2 className="h-3.5 w-3.5" /> Forward</button>
            <button onClick={() => { navigator.clipboard.writeText(message.text); toast.success('Copied'); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiCopy className="h-3.5 w-3.5" /> Copy</button>
            <button onClick={() => { onStar(message._id); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiStar className="h-3.5 w-3.5" /> {message.starredBy?.includes(String(meId)) ? 'Unstar' : 'Star'}</button>
            {mine && <button onClick={() => { onEdit(message); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiEdit className="h-3.5 w-3.5" /> Edit</button>}
            <button onClick={() => { onDelete(message._id, false); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiTrash className="h-3.5 w-3.5" /> Delete for me</button>
            {mine && <button onClick={() => { onDelete(message._id, true); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5 text-danger"><FiTrash2 className="h-3.5 w-3.5" /> Delete for everyone</button>}
            <button onClick={() => { onInfo(message._id); setShowMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiInfo className="h-3.5 w-3.5" /> Info</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [msgSearch, setMsgSearch] = useState('')
  const [newChat, setNewChat] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showForward, setShowForward] = useState(null)
  const [showInfo, setShowInfo] = useState(null)
  const [infoData, setInfoData] = useState(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [pendingAttach, setPendingAttach] = useState(null)
  const [viewOnce, setViewOnce] = useState(false)
  const [mobilePane, setMobilePane] = useState('list')
  const [typingUsers, setTypingUsers] = useState({})
  const [presence, setPresence] = useState({})
  const [hasMore, setHasMore] = useState(true)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const bottomRef = useRef(null)
  const listRef = useRef(null)
  const fileInputRef = useRef(null)

  const { data: conversations = [], isLoading, isError, refetch } = useQuery({
    queryKey: QK.conversations,
    queryFn: () => chatApi.conversations(),
  })

  const active = useMemo(() => conversations.find((c) => c._id === activeId) || null, [conversations, activeId])
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const { data: messages = [], isLoading: loadingMessages, isError: messagesError } = useQuery({
    queryKey: QK.messages(activeId),
    queryFn: () => chatApi.messages(activeId, { limit: 100 }),
    enabled: Boolean(activeId),
  })

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: ({ text, attachment, replyTo: rt, viewOnce: vo }) => {
      if (editing) return chatApi.editMessage(activeId, editing._id, text)
      return chatApi.sendMessage(activeId, { text, attachment, replyTo: rt?._id || rt?.messageId || null, viewOnce: vo })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.messages(activeId) })
      qc.invalidateQueries({ queryKey: QK.conversations })
      setDraft(''); setReplyTo(null); setEditing(null); setViewOnce(false)
    },
  })

  const { mutate: uploadAttach, isPending: uploadingAttach } = useMutation({
    mutationFn: (file) => chatApi.uploadAttachment(activeId, file),
    onSuccess: (attachment) => {
      setPendingAttach(null)
      send({ text: draft.trim(), attachment, replyTo, viewOnce })
      setDraft('')
    },
    onError: () => { setPendingAttach(null) },
  })

  const { mutate: markRead } = useMutation({
    mutationFn: (cid) => chatApi.markRead(cid || activeIdRef.current || activeId),
    onSuccess: (_data, cid) => {
      const target = cid || activeIdRef.current || activeId
      // optimistic: set unread to 0 for this conversation
      qc.setQueryData(QK.conversations, (old) => {
        if (!Array.isArray(old)) return old
        return old.map((c) => String(c._id) === String(target) ? { ...c, unreadCount: 0 } : c)
      })
      qc.invalidateQueries({ queryKey: QK.conversations })
      if (target) qc.invalidateQueries({ queryKey: QK.messages(target) })
    },
  })

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase()
    let rows = [...conversations]
    if (term) rows = rows.filter((c) => {
      const peer = directPeer(c)
      const haystack = `${c.isGroup ? c.name : ''} ${peer?.name || ''} ${c.isGroup ? '' : (peer?.email || '')}`.toLowerCase()
      return haystack.includes(term)
    })
    return rows
  }, [conversations, search])

  const displayedMessages = useMemo(() => {
    if (!msgSearch.trim()) return messages
    const term = msgSearch.trim().toLowerCase()
    return messages.filter((m) => (m.text || '').toLowerCase().includes(term))
  }, [messages, msgSearch])

  // presence fetch
  useEffect(() => {
    if (!active || active.isGroup) return
    const peer = directPeer(active)
    if (!peer?._id) return
    chatApi.presence([peer._id]).then((res) => {
      const data = res?.data ?? res
      const arr = Array.isArray(data) ? data : []
      const p = arr[0]
      if (p) setPresence((prev) => ({ ...prev, [peer._id]: p }))
    }).catch(() => {})
  }, [active?._id])

  // socket listeners
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onNew = ({ conversationId, message }) => {
      qc.invalidateQueries({ queryKey: QK.messages(conversationId) })
      qc.invalidateQueries({ queryKey: QK.conversations })
      if (String(conversationId) === String(activeIdRef.current) && message?.sender && String(message.sender) !== String(me?._id)) {
        chatApi.markDelivered(conversationId, [message._id]).catch(() => {})
        if (String(activeIdRef.current) === String(conversationId)) markRead(conversationId)
      }
    }
    const onEdited = ({ conversationId }) => qc.invalidateQueries({ queryKey: QK.messages(conversationId) })
    const onDeleted = ({ conversationId }) => qc.invalidateQueries({ queryKey: QK.messages(conversationId) })
    const onReact = ({ conversationId }) => qc.invalidateQueries({ queryKey: QK.messages(conversationId) })
    const onDelivered = ({ conversationId }) => qc.invalidateQueries({ queryKey: QK.messages(conversationId) })
    const onRead = ({ conversationId }) => { qc.invalidateQueries({ queryKey: QK.messages(conversationId) }); qc.invalidateQueries({ queryKey: QK.conversations }) }
    const onTyping = ({ conversationId, userName }) => setTypingUsers((p) => ({ ...p, [conversationId]: userName }))
    const onStop = ({ conversationId }) => setTypingUsers((p) => { const n = { ...p }; delete n[conversationId]; return n })
    const onConv = () => qc.invalidateQueries({ queryKey: QK.conversations })
    const onPresence = ({ userId, isOnline, lastSeen }) => setPresence((p) => ({ ...p, [userId]: { userId, isOnline, lastSeen } }))
    const onOnline = ({ userId }) => setPresence((p) => ({ ...p, [userId]: { userId, isOnline: true } }))
    const onOffline = ({ userId, lastSeen }) => setPresence((p) => ({ ...p, [userId]: { userId, isOnline: false, lastSeen } }))
    socket.on('chat:new-message', onNew)
    socket.on('chat:message-edited', onEdited)
    socket.on('chat:message-deleted', onDeleted)
    socket.on('chat:reaction', onReact)
    socket.on('chat:delivered', onDelivered)
    socket.on('chat:read', onRead)
    socket.on('chat:typing', onTyping)
    socket.on('chat:stop-typing', onStop)
    socket.on('chat:conversation', onConv)
    socket.on('chat:conversation-updated', onConv)
    socket.on('presence:update', onPresence)
    socket.on('user:online', onOnline)
    socket.on('user:offline', onOffline)
    socket.on('chat:poll-vote', onReact)
    return () => {
      socket.off('chat:new-message', onNew)
      socket.off('chat:message-edited', onEdited)
      socket.off('chat:message-deleted', onDeleted)
      socket.off('chat:reaction', onReact)
      socket.off('chat:delivered', onDelivered)
      socket.off('chat:read', onRead)
      socket.off('chat:typing', onTyping)
      socket.off('chat:stop-typing', onStop)
      socket.off('chat:conversation', onConv)
      socket.off('chat:conversation-updated', onConv)
      socket.off('presence:update', onPresence)
      socket.off('user:online', onOnline)
      socket.off('user:offline', onOffline)
      socket.off('chat:poll-vote', onReact)
    }
  }, [me?._id, qc])

  useEffect(() => { if (activeId) markRead(activeId) }, [activeId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [displayedMessages.length, activeId])

  const handleScroll = useCallback(async (e) => {
    if (e.target.scrollTop !== 0 || !activeId || !hasMore || loadingMessages) return
    const oldest = displayedMessages[0]?._id
    if (!oldest) return
    try {
      const older = await chatApi.messages(activeId, { before: oldest, limit: 50 })
      const arr = Array.isArray(older) ? older : older?.data || []
      if (!arr.length) { setHasMore(false); return }
      qc.setQueryData(QK.messages(activeId), (old) => [...arr, ...(old || [])])
      if (arr.length < 50) setHasMore(false)
    } catch {}
  }, [activeId, displayedMessages, hasMore, loadingMessages, qc])

  useEffect(() => { setHasMore(true) }, [activeId])

  const prevActiveRef = useRef(null)
  useEffect(() => {
    const prev = prevActiveRef.current
    if (prev && prev !== activeId) {
      try {
        const prevMsgs = qc.getQueryData(QK.messages(prev))
        const conv = conversations.find((c) => String(c._id) === String(prev))
        const isEmpty = Array.isArray(prevMsgs) && prevMsgs.length === 0 && conv && !conv.lastMessage?.text && !conv.lastMessage?.hasAttachment && conv.type === 'direct'
        if (isEmpty) {
          chatApi.deleteConversation(prev).catch(() => {})
          qc.invalidateQueries({ queryKey: QK.conversations })
        }
      } catch {}
    }
    if (activeId) prevActiveRef.current = activeId
  }, [activeId, conversations, qc])

  const openConversation = (id) => { setActiveId(id); setMobilePane('chat'); setHasMore(true) }

  const handleSend = () => {
    const text = draft.trim()
    if (!activeId) return
    if (pendingAttach) { uploadAttach(pendingAttach.file); return }
    if (!text && !editing) return
    send({ text, replyTo, viewOnce })
  }

  const pickFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeId) return
    if (file.size > 25 * 1024 * 1024) { toast.error('Max 25MB'); return }
    setPendingAttach({ file })
  }

  const handleTyping = (val) => {
    setDraft(val)
    const socket = getSocket()
    if (!socket || !activeId) return
    if (val.trim()) socket.emit('chat:typing', { conversationId: activeId })
    else socket.emit('chat:stop-typing', { conversationId: activeId })
  }

  const handleAction = async (action, conv) => {
    try {
      if (action === 'pin') await chatApi.pref(conv._id, { isPinned: !conv.isPinned })
      if (action === 'mute') await chatApi.pref(conv._id, { isMuted: !conv.isMuted })
      if (action === 'archive') await chatApi.pref(conv._id, { isArchived: !conv.isArchived })
      if (action === 'clear') await chatApi.clear(conv._id)
      if (action === 'delete') {
        if (!confirm(`Delete chat "${conv.isGroup ? conv.name : directPeer(conv)?.name || 'this chat'}"? This cannot be undone.`)) return
        await chatApi.deleteConversation(conv._id)
        if (String(activeId) === String(conv._id)) { setActiveId(null); setMobilePane('list') }
      }
      qc.invalidateQueries({ queryKey: QK.conversations })
      qc.invalidateQueries({ queryKey: QK.messages(conv._id) })
      toast.success(action)
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed') }
  }

  const peer = directPeer(active)
  const peerPresence = peer ? presence[peer._id] : null
  const chatTitle = active?.isGroup ? active.name : (peer?.name || 'Chat')
  const chatSubtitle = active?.isGroup ? `${active.memberCount || 0} member(s)${active && typingUsers[active._id] ? ` · ${typingUsers[active._id]} is typing…` : ''}` : peerPresence ? (peerPresence.isOnline ? 'online' : lastSeenText(peerPresence.lastSeen)) : `${peer?.role || ''}${peer?.designation ? ` · ${peer.designation}` : ''}${active && typingUsers[active._id] ? ` · typing…` : ''}`
  const showMembersButton = active?.isGroup
  const canSend = (draft.trim() || pendingAttach) && !sending && !uploadingAttach

  const handleForward = (msg) => setShowForward(msg)
  const doForward = async (targetId) => {
    try { await chatApi.forward(targetId, showForward._id); toast.success('Forwarded'); setShowForward(null); qc.invalidateQueries({ queryKey: QK.conversations }) } catch { toast.error('Forward failed') }
  }
  const handleInfo = async (mid) => {
    try { const res = await chatApi.info(activeId, mid); setInfoData(res); setShowInfo(mid) } catch {}
  }

  return (
    <div>
      <PageHeader title="Chat" subtitle="Internal messaging · Admin, HR, Manager & Employee — WhatsApp style" actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={FiEdit} onClick={() => setNewChat(true)}>New Chat</Button>
          <Button variant="ghost" icon={FiUsers} onClick={() => setNewGroup(true)}>New Group</Button>
        </div>
      } />

      <Card className="flex h-[calc(100dvh-11rem)] min-h-[420px] overflow-hidden p-0">
        <div className={cn('flex w-full flex-col border-r border-app sm:w-80 lg:w-96', mobilePane === 'chat' && 'hidden sm:flex')}>
          <div className="border-b border-app p-3 space-y-2">
            <div className="relative">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" className="input pl-9" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading && <Loader label="Loading conversations…" />}
            {isError && <EmptyState icon={FiMessageSquare} title="Could not load conversations" description="Please try again." action={<Button variant="ghost" size="sm" onClick={() => refetch()}>Retry</Button>} />}
            {!isLoading && !isError && filteredConversations.length === 0 && <EmptyState icon={FiMessageSquare} title={search ? 'No matching conversations' : 'No conversations yet'} description={search ? 'Try a different search.' : 'Start a new chat or create a group to get going.'} />}
            <div className="space-y-1">
              {filteredConversations.map((c) => <ConversationItem key={c._id} conversation={c} active={c._id === activeId} onClick={() => openConversation(c._id)} onAction={handleAction} />)}
            </div>
          </div>
        </div>

        <div
          className={cn('min-w-0 flex-1 flex-col relative', mobilePane === 'chat' ? 'flex' : 'hidden sm:flex')}
          onDragOver={(e) => { e.preventDefault(); if (active) setIsDragOver(true) }}
          onDragEnter={(e) => { e.preventDefault(); if (active) setIsDragOver(true) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
          onDrop={(e) => {
            e.preventDefault(); setIsDragOver(false)
            if (!active) return
            const file = e.dataTransfer?.files?.[0]
            if (!file) return
            if (file.size > 25 * 1024 * 1024) { toast.error('Max 25MB'); return }
            setPendingAttach({ file })
          }}
        >
          {isDragOver && active && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl m-2">
              <FiPaperclip className="h-10 w-10 text-primary mb-2" />
              <p className="text-sm font-semibold text-primary">Drop file to send</p>
              <p className="text-xs text-muted">WhatsApp style — release to attach</p>
            </div>
          )}
          {!active ? (
            <div className="flex flex-1 items-center justify-center"><EmptyState icon={FiMessageSquare} title="Select a conversation" description="Pick a conversation from the list, start a new chat, or create a group. You can also drag & drop files here." /></div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-app px-4 py-3">
                <button type="button" className="rounded-lg p-2 text-muted transition hover:bg-black/5 dark:hover:bg-white/10 sm:hidden" onClick={() => setMobilePane('list')} aria-label="Back to conversations"><FiArrowLeft /></button>
                <Avatar name={active.isGroup ? active.name : (peer?.name || '?')} src={active.isGroup ? active.icon || '' : (peer?.avatar || '')} size={40} ring={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold flex items-center gap-1">{chatTitle} {active.isPinned && <FiBookmark className="h-3 w-3 text-amber-500" />} {active.isMuted && <FiVolumeX className="h-3 w-3 text-muted" />}</p>
                  <p className="truncate text-xs text-muted">{chatSubtitle}</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="relative hidden sm:flex items-center gap-1">
                    <input value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)} placeholder="Search in chat…" className="input h-8 w-36 text-xs" />
                  </div>
                  {showMembersButton && <Button variant="ghost" size="sm" icon={FiInfo} onClick={() => setShowMembers(true)}><span className="hidden sm:inline">Members</span></Button>}
                  <div className="relative">
                    <Button variant="ghost" size="sm" icon={FiMoreVertical} onClick={() => setShowAttachMenu((v) => !v)} />
                    {showAttachMenu && (
                      <div className="absolute right-0 top-9 w-56 rounded-xl border border-app bg-surface shadow-lg z-20 p-1 text-xs">
                        <button onClick={() => { handleAction('mute', active); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiVolumeX className="h-3.5 w-3.5" /> {active.isMuted ? 'Unmute' : 'Mute'}</button>
                        <button onClick={() => { handleAction('pin', active); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiBookmark className="h-3.5 w-3.5" /> {active.isPinned ? 'Unpin' : 'Pin'}</button>
                        <button onClick={() => { handleAction('archive', active); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiArchive className="h-3.5 w-3.5" /> {active.isArchived ? 'Unarchive' : 'Archive'}</button>
                        <button onClick={() => { handleAction('clear', active); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiTrash className="h-3.5 w-3.5" /> Clear chat</button>
                        <button onClick={() => { handleAction('delete', active); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-danger/10 text-danger"><FiTrash2 className="h-3.5 w-3.5" /> Delete chat</button>
                        <button onClick={async () => { const r = await chatApi.invite(active._id); navigator.clipboard.writeText(window.location.origin + r.link); toast.success('Invite copied'); setShowAttachMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/5"><FiShare2 className="h-3.5 w-3.5" /> Invite link</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-black/[0.02] p-4 dark:bg-black/20">
                {loadingMessages && <Loader label="Loading messages…" />}
                {!loadingMessages && messagesError && (
                  <div className="flex h-full items-center justify-center"><EmptyState icon={FiMessageSquare} title="This conversation is no longer available" description="It may have been deleted or you may have left it." action={<Button variant="ghost" size="sm" onClick={() => { setActiveId(null); setMobilePane('list'); qc.invalidateQueries({ queryKey: QK.conversations }) }}>Back to conversations</Button>} /></div>
                )}
                {!loadingMessages && !messagesError && displayedMessages.length === 0 && <div className="flex h-full items-center justify-center"><EmptyState icon={FiMessageSquare} title="No messages yet" description="Say hello to start the conversation." /></div>}
                {hasMore && displayedMessages.length >= 20 && <p className="text-center text-[11px] text-muted mb-2">Scroll to top to load older messages</p>}
                <div className="space-y-2">
                  {displayedMessages.map((m) => (
                    <MessageBubble key={m._id} message={m} mine={String(m.sender) === String(me?._id)} meId={me?._id} participantCount={active.memberCount || 2} onReply={setReplyTo} onEdit={(msg) => { setEditing(msg); setDraft(msg.text) }} onDelete={(id, fe) => chatApi.deleteMessage(activeId, id, fe).then(() => qc.invalidateQueries({ queryKey: QK.messages(activeId) }))} onStar={(id) => chatApi.star(activeId, id).then(() => qc.invalidateQueries({ queryKey: QK.messages(activeId) }))} onReact={(id, emoji) => chatApi.react(activeId, id, emoji).then(() => qc.invalidateQueries({ queryKey: QK.messages(activeId) }))} onForward={handleForward} onInfo={handleInfo} />
                  ))}
                </div>
                {typingUsers[activeId] && <p className="mt-2 text-xs italic text-muted">{typingUsers[activeId]} is typing…</p>}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-app p-3">
                {replyTo && (
                  <div className="mb-2 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                    <div className="min-w-0"><p className="text-xs font-semibold text-primary">{replyTo.senderName || 'Reply'}</p><p className="truncate text-xs opacity-70">{replyTo.text || 'Attachment'}</p></div>
                    <button type="button" onClick={() => setReplyTo(null)} className="rounded-lg p-1 text-muted hover:text-danger"><FiX className="h-4 w-4" /></button>
                  </div>
                )}
                {editing && (
                  <div className="mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-700">Editing message</p><button type="button" onClick={() => { setEditing(null); setDraft('') }} className="rounded-lg p-1 text-muted hover:text-danger"><FiX className="h-4 w-4" /></button>
                  </div>
                )}
                {pendingAttach && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-app bg-muted/10 px-3 py-2">
                    <FiPaperclip className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate text-sm">{pendingAttach.file?.name || 'Attachment'}</span><span className="flex-none text-xs text-muted">{formatBytes(pendingAttach.file?.size)}</span>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} /> View once</label>
                    <button type="button" onClick={() => setPendingAttach(null)} className="rounded-lg p-1 text-muted transition hover:text-danger"><FiX className="h-4 w-4" /></button>
                  </div>
                )}
                <div className="flex items-center gap-2 relative">
                  <input ref={fileInputRef} type="file" hidden onChange={pickFile} />
                  <Button variant="ghost" icon={FiPaperclip} disabled={uploadingAttach || !activeId} loading={uploadingAttach} onClick={() => fileInputRef.current?.click()} aria-label="Attach a file" className="!min-h-[42px] !h-[42px] shrink-0" />
                  <div className="relative shrink-0">
                    <button onClick={() => setShowEmoji((v) => !v)} className="rounded-lg p-2 text-muted hover:bg-black/5 h-[42px] w-[42px] flex items-center justify-center" title="Emoji"><FiSmile className="h-5 w-5" /></button>
                    {showEmoji && (
                      <div className="absolute bottom-full left-0 mb-2 flex flex-wrap gap-1 rounded-xl border border-app bg-surface p-2 shadow-xl z-30 max-w-[240px]">
                        {['😀','😂','😍','🥺','😎','🤔','👍','❤️','🔥','🎉','🙏','😢','😮','🤣','😅','😇','🤩','😭','🥳','😡'].map((e) => <button key={e} onClick={() => { setDraft((d) => d + e); setShowEmoji(false) }} className="text-xl hover:scale-125 transition">{e}</button>)}
                      </div>
                    )}
                  </div>
                  <textarea rows={1} value={draft} onChange={(e) => handleTyping(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} placeholder={pendingAttach ? 'Add a caption… (optional)' : 'Type a message…'} className="input !min-h-[42px] !h-[42px] max-h-24 flex-1 resize-none py-2.5 overflow-y-auto" style={{minHeight:'42px', height:'42px'}} />
                  <Button icon={FiSend} disabled={!canSend} loading={sending} onClick={handleSend} aria-label="Send message" className="!min-h-[42px] !h-[42px] shrink-0"><span className="hidden sm:inline">{editing ? 'Update' : pendingAttach ? 'Send' : 'Send'}</span></Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <NewChatModal open={newChat} onClose={() => setNewChat(false)} onOpened={openConversation} />
      <NewGroupModal open={newGroup} onClose={() => setNewGroup(false)} onOpened={openConversation} />
      <MembersPanel conversation={active} open={showMembers} onClose={() => setShowMembers(false)} onLeave={() => { if (!active) return; chatApi.leaveGroup(active._id).then(() => { setActiveId(null); setShowMembers(false); setMobilePane('list'); qc.invalidateQueries({ queryKey: QK.conversations }) }).catch(()=>{}) }} />

      {showForward && (
        <Modal open={!!showForward} onClose={() => setShowForward(null)} title="Forward to…">
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {conversations.map((c) => (
              <button key={c._id} onClick={() => doForward(c._id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-black/5">
                <Avatar name={c.isGroup ? c.name : directPeer(c)?.name || '?'} size={36} />
                <span className="flex-1 truncate text-sm font-medium">{c.isGroup ? c.name : directPeer(c)?.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {showInfo && infoData && (
        <Modal open={!!showInfo} onClose={() => setShowInfo(null)} title="Message info">
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Delivered to</p>
            {(infoData.deliveredTo || []).length ? infoData.deliveredTo.map((d) => <p key={d.user} className="flex justify-between text-xs"><span>{d.name}</span><span className="text-muted">{messageTime(d.at)}</span></p>) : <p className="text-muted text-xs">Not delivered yet</p>}
            <p className="font-semibold mt-3">Read by</p>
            {(infoData.readBy || []).length ? infoData.readBy.map((d) => <p key={d.user} className="flex justify-between text-xs"><span>{d.name}</span><span className="text-muted">{messageTime(d.at)}</span></p>) : <p className="text-muted text-xs">Not read yet</p>}
            <p className="text-xs opacity-60">Edited: {infoData.isEdited ? messageTime(infoData.editedAt) : 'Never'} · Forwarded: {infoData.forwarded ? 'Yes' : 'No'}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
