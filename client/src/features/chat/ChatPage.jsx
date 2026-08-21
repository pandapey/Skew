// Chat — internal messaging for Admin / HR / Manager / Employee.
//
// Two-pane WhatsApp-inspired layout built ENTIRELY on the project design
// system (Card, Avatar, Button, EmptyState, Loader). No WhatsApp assets or
// branding are used.
//
// DATA + REALTIME:
//   * Conversation list and messages are react-query caches busted by the
//     EXISTING socket provider (useRealtimeSync.jsx handles chat:new-message /
//     chat:read / chat:conversation / chat:conversation-updated), so a message
//     sent in one browser appears in another without a refresh.
//   * While a conversation is open, incoming messages from others are marked
//     read immediately through the same socket event.
//   * Server-side authorization is the enforcement: the API returns 403 for
//     non-participants and Clients cannot reach /api/chat at all.
//
// ATTACHMENTS:
//   * Files are uploaded to POST /chat/conversations/:id/attachments (multer),
//     which returns metadata that is sent WITH the message.
//   * The bytes live in chat-uploads/ (NOT the public /uploads dir) and are
//     served only through the authenticated GET .../attachments/:fileId route,
//     so every preview/download below fetches a blob through the SAME axios
//     instance that carries the JWT — never a plain <img src>.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FiEdit, FiUsers, FiSend, FiArrowLeft, FiMessageSquare,
  FiInfo, FiPaperclip, FiX, FiDownload, FiFileText, FiFile, FiExternalLink,
} from 'react-icons/fi'
import { Card, Avatar, Button, Loader, EmptyState, PageHeader } from '@/components/ui'
import { getSocket } from '@/api/socket'
import { chatApi } from '@/api/chatService'
import apiClient from '@/api/client'
import { QK, messageTime, listTime, directPeer, formatBytes } from './chatUtils'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { MembersPanel } from './MembersPanel'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/utils'

const IMAGE_KINDS = new Set(['image', 'gif', 'png', 'jpeg', 'jpg', 'webp'])

// Fetches an attachment blob through the authenticated axios instance and
// exposes an object URL. Object URLs are revoked on unmount to avoid leaks.
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
    // PHASE: EMPLOYEE CHAT (404 FIX) — `skipErrorToast` keeps a missing/stale
    // attachment from popping the generic axios toast: the blob body carries no
    // `.message`, so the interceptor would show "Request failed with status
    // code 404" on every chat open. The failure is rendered gracefully below.
    apiClient.get(att.url, { responseType: 'blob', skipErrorToast: true })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [att?.fileId, att?.url])

  return { url, failed }
}

function AttachmentActions({ url, fileName, onView }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onView}
        className="flex items-center gap-1 rounded-lg border border-white/20 bg-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition hover:border-primary/40"
        aria-label={`Open ${fileName}`}
      >
        <FiExternalLink className="h-3 w-3" />
        Open
      </button>
      {url && (
        <a
          href={url}
          download={fileName}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded-lg border border-white/20 bg-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition hover:border-primary/40"
          aria-label={`Download ${fileName}`}
        >
          <FiDownload className="h-3 w-3" />
          Download
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

  if (failed) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
        Attachment unavailable. Contact support if this persists.
      </div>
    )
  }

  if (isImage && url) {
    return (
      <div className="mt-1 flex flex-col items-start gap-1">
        <img
          src={url}
          alt={fileName}
          onClick={openFile}
          className="max-h-64 max-w-full cursor-pointer rounded-xl border border-white/20 object-cover transition hover:border-primary/40"
        />
        <AttachmentActions url={url} fileName={fileName} onView={openFile} />
      </div>
    )
  }

  if (isPdf && url) {
    return (
      <div className="mt-1 flex flex-col gap-1">
        <iframe
          src={url}
          title={fileName}
          className="h-72 w-full max-w-full rounded-xl border border-white/20 bg-white"
        />
        <AttachmentActions url={url} fileName={fileName} onView={openFile} />
      </div>
    )
  }

  if (isVideo && url) {
    return (
      <div className="mt-1 flex flex-col items-start gap-1">
        <video src={url} controls className="max-h-64 max-w-full rounded-xl" />
        <AttachmentActions url={url} fileName={fileName} onView={openFile} />
      </div>
    )
  }

  if (isAudio && url) {
    return (
      <div className="mt-1 flex flex-col items-start gap-1">
        <audio src={url} controls className="h-9 w-56 max-w-full" />
        <AttachmentActions url={url} fileName={fileName} onView={openFile} />
      </div>
    )
  }

  // Other files (documents, archives, etc.): click the card to open, download via button.
  return (
    <div className="mt-1 flex flex-col gap-1">
      <button
        type="button"
        onClick={openFile}
        className="flex items-center gap-2 rounded-xl border border-white/20 bg-black/10 px-2.5 py-2 text-left transition hover:border-primary/40"
        aria-label={`Open ${fileName}`}
      >
        <DocIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{fileName}</span>
        <span className="flex-none text-[10px] opacity-70">{formatBytes(attachment?.size)}</span>
      </button>
      <AttachmentActions url={url} fileName={fileName} onView={openFile} />
    </div>
  )
}

function ConversationItem({ conversation, active, onClick }) {
  const { user: me } = useAuth()
  const peer = directPeer(conversation)
  const displayName = conversation.isGroup ? conversation.name : (peer?.name || 'Unknown user')
  const avatarSrc = conversation.isGroup ? '' : peer?.avatar || ''
  const last = conversation.lastMessage
  const isMine = last && String(last.sender) === String(me?._id)
  const preview = !last
    ? 'No messages yet'
    : `${isMine ? 'You: ' : ''}${last.hasAttachment ? '📎 Attachment' : (last.text || '')}`
  const unread = conversation.unreadCount || 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
        active
          ? 'bg-gradient-to-r from-primary to-accent shadow-glow-primary'
          : 'hover:bg-black/5 dark:hover:bg-white/10'
      )}
    >
      <Avatar
        name={conversation.isGroup ? conversation.name : (peer?.name || '?')}
        src={avatarSrc}
        size={44}
        ring={false}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm font-semibold', active && 'text-white')}>{displayName}</span>
          {last?.at && (
            <span className={cn('flex-none text-[11px]', active ? 'text-white/80' : 'text-muted')}>
              {listTime(last.at)}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-xs', active ? 'text-white/85' : 'text-muted')}>
            {preview}
          </span>
          {unread > 0 && (
            <span className={cn(
              'flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
              active ? 'bg-white text-primary' : 'bg-primary text-white'
            )}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function MessageBubble({ message, mine }) {
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-floating-sm sm:max-w-[70%]',
          mine
            ? 'rounded-br-md bg-gradient-to-br from-primary to-accent text-white'
            : 'rounded-bl-md border border-app bg-surface'
        )}
      >
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        {message.attachment && <AttachmentView attachment={message.attachment} />}
        <p className={cn('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-muted')}>
          {messageTime(message.createdAt)}
        </p>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [newChat, setNewChat] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingAttach, setPendingAttach] = useState(null) // { file, kind }
  const [mobilePane, setMobilePane] = useState('list') // 'list' | 'chat'
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  // --- Data ---
  const { data: conversations = [], isLoading, isError, refetch } = useQuery({
    queryKey: QK.conversations,
    queryFn: () => chatApi.conversations(),
  })

  const active = useMemo(
    () => conversations.find((c) => c._id === activeId) || null,
    [conversations, activeId]
  )

  const { data: messages = [], isLoading: loadingMessages, isError: messagesError } = useQuery({
    queryKey: QK.messages(activeId),
    queryFn: () => chatApi.messages(activeId, { limit: 100 }),
    enabled: Boolean(activeId),
  })

  // --- Mutations ---
  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: ({ text, attachment }) => chatApi.sendMessage(activeId, { text, attachment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.messages(activeId) })
      qc.invalidateQueries({ queryKey: QK.conversations })
    },
  })

  const { mutate: uploadAttach, isPending: uploadingAttach } = useMutation({
    mutationFn: (file) => chatApi.uploadAttachment(activeId, file),
    onSuccess: (attachment) => {
      setPendingAttach(null)
      send({ text: draft.trim(), attachment })
      setDraft('')
    },
    onError: () => {
      setPendingAttach(null)
    },
  })

  const { mutate: markRead } = useMutation({
    mutationFn: () => chatApi.markRead(activeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.conversations })
      qc.invalidateQueries({ queryKey: QK.messages(activeId) })
    },
    // PHASE: EMPLOYEE CHAT (REQUIREMENT 2) — a 404 here means the conversation
    // was left or deleted elsewhere. No raw 404 popup (the request opts out of
    // the global error toast); instead the selection is cleared and the list
    // refetch below drops the vanished conversation naturally.
    onError: (err) => {
      if (err?.response?.status === 404) {
        setActiveId(null)
        setShowMembers(false)
        setMobilePane('list')
        qc.invalidateQueries({ queryKey: QK.conversations })
      }
    },
  })

  // --- Realtime: read incoming messages of the OPEN conversation immediately ---
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onNewMessage = ({ conversationId, message }) => {
      if (
        String(conversationId) === String(activeIdRef.current)
        && message?.sender && String(message.sender) !== String(me?._id)
      ) {
        markReadRef.current()
      }
    }
    socket.on('chat:new-message', onNewMessage)
    return () => {
      socket.off('chat:new-message', onNewMessage)
    }
  }, [me])

  // Mark read when a conversation is opened (server truth; UI just triggers it).
  useEffect(() => {
    if (activeId) markRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Auto-scroll to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, activeId])

  // --- Handlers ---
  const openConversation = (id) => {
    setActiveId(id)
    setMobilePane('chat')
  }

  const handleSend = () => {
    const text = draft.trim()
    if (!activeId) return
    if (pendingAttach) {
      uploadAttach(pendingAttach.file)
      return
    }
    if (!text) return
    send({ text })
    setDraft('')
  }

  const pickFile = (e, kind = 'file') => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeId) return
    setPendingAttach({ file, kind })
  }

  const handleLeave = () => {
    if (!active) return
    chatApi.leaveGroup(active._id).then(() => {
      setActiveId(null)
      setShowMembers(false)
      setMobilePane('list')
      qc.invalidateQueries({ queryKey: QK.conversations })
    }).catch(() => {})
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter((c) => {
      const peer = directPeer(c)
      const haystack = `${c.isGroup ? c.name : ''} ${peer?.name || ''} ${c.isGroup ? '' : (peer?.email || '')}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [conversations, search])

  const peer = directPeer(active)
  const chatTitle = active?.isGroup ? active.name : (peer?.name || 'Chat')
  const chatSubtitle = active?.isGroup
    ? `${active.memberCount || 0} member(s)`
    : `${peer?.role || ''}${peer?.designation ? ` · ${peer.designation}` : ''}`

  const showMembersButton = active?.isGroup
  const canSend = (draft.trim() || pendingAttach) && !sending && !uploadingAttach

  return (
    <div>
      <PageHeader
        title="Chat"
        subtitle="Internal messaging · Admin, HR, Manager & Employee"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" icon={FiEdit} onClick={() => setNewChat(true)}>New Chat</Button>
            <Button variant="ghost" icon={FiUsers} onClick={() => setNewGroup(true)}>New Group</Button>
          </div>
        }
      />

      <Card className="flex h-[calc(100dvh-11rem)] min-h-[420px] overflow-hidden p-0">
        {/* ---------------- LEFT: conversation list ---------------- */}
        <div
          className={cn(
            'flex w-full flex-col border-r border-app sm:w-80 lg:w-96',
            mobilePane === 'chat' && 'hidden sm:flex'
          )}
        >
          <div className="border-b border-app p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="input"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading && <Loader label="Loading conversations…" />}
            {isError && (
              <EmptyState
                icon={FiMessageSquare}
                title="Could not load conversations"
                description="Please try again."
                action={<Button variant="ghost" size="sm" onClick={() => refetch()}>Retry</Button>}
              />
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <EmptyState
                icon={FiMessageSquare}
                title={search ? 'No matching conversations' : 'No conversations yet'}
                description={search
                  ? 'Try a different search.'
                  : 'Start a new chat or create a group to get going.'}
              />
            )}
            <div className="space-y-1">
              {filtered.map((c) => (
                <ConversationItem
                  key={c._id}
                  conversation={c}
                  active={c._id === activeId}
                  onClick={() => openConversation(c._id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- RIGHT: conversation area ---------------- */}
        <div className={cn('min-w-0 flex-1 flex-col', mobilePane === 'chat' ? 'flex' : 'hidden sm:flex')}>
          {!active ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={FiMessageSquare}
                title="Select a conversation"
                description="Pick a conversation from the list, start a new chat, or create a group."
              />
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-app px-4 py-3">
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted transition hover:bg-black/5 dark:hover:bg-white/10 sm:hidden"
                  onClick={() => setMobilePane('list')}
                  aria-label="Back to conversations"
                >
                  <FiArrowLeft />
                </button>
                <Avatar
                  name={active.isGroup ? active.name : (peer?.name || '?')}
                  src={active.isGroup ? '' : (peer?.avatar || '')}
                  size={40}
                  ring={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{chatTitle}</p>
                  <p className="truncate text-xs text-muted">{chatSubtitle}</p>
                </div>
                {showMembersButton && (
                  <Button variant="ghost" size="sm" icon={FiInfo} onClick={() => setShowMembers(true)}>
                    <span className="hidden sm:inline">Members</span>
                  </Button>
                )}
              </div>

              {/* Messages */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-black/[0.02] p-4 dark:bg-black/20">
                {loadingMessages && <Loader label="Loading messages…" />}
                {!loadingMessages && messagesError && (
                  <div className="flex h-full items-center justify-center">
                    {/* PHASE: EMPLOYEE CHAT (REQUIREMENT 2) — a conversation
                        that genuinely no longer exists is surfaced as a proper
                        not-found screen, never as a raw 404 popup. */}
                    <EmptyState
                      icon={FiMessageSquare}
                      title="This conversation is no longer available"
                      description="It may have been deleted or you may have left it."
                      action={(
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveId(null)
                            setMobilePane('list')
                            qc.invalidateQueries({ queryKey: QK.conversations })
                          }}
                        >
                          Back to conversations
                        </Button>
                      )}
                    />
                  </div>
                )}
                {!loadingMessages && !messagesError && messages.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={FiMessageSquare}
                      title="No messages yet"
                      description="Say hello to start the conversation."
                    />
                  </div>
                )}
                <div className="space-y-2">
                  {messages.map((m) => (
                    <MessageBubble key={m._id} message={m} mine={String(m.sender) === String(me?._id)} />
                  ))}
                </div>
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-app p-3">
                {pendingAttach && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-app bg-muted/10 px-3 py-2">
                    <FiPaperclip className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm">{pendingAttach.file?.name || 'Attachment'}</span>
                    <span className="flex-none text-xs text-muted">{formatBytes(pendingAttach.file?.size)}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttach(null)}
                      className="rounded-lg p-1 text-muted transition hover:text-danger"
                      aria-label="Remove attachment"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input ref={fileInputRef} type="file" hidden onChange={(e) => pickFile(e, 'file')} />
                  <Button
                    variant="ghost"
                    icon={FiPaperclip}
                    disabled={uploadingAttach || !activeId}
                    loading={uploadingAttach}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach a file"
                  />
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder={pendingAttach ? 'Add a caption… (optional)' : 'Type a message…'}
                    className="input min-h-[42px] max-h-32 flex-1 resize-none py-2.5"
                  />
                  <Button
                    icon={FiSend}
                    disabled={!canSend}
                    loading={sending}
                    onClick={handleSend}
                    aria-label="Send message"
                  >
                    <span className="hidden sm:inline">{pendingAttach ? 'Send' : 'Send'}</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <NewChatModal open={newChat} onClose={() => setNewChat(false)} onOpened={openConversation} />
      <NewGroupModal open={newGroup} onClose={() => setNewGroup(false)} onOpened={openConversation} />
      <MembersPanel
        conversation={active}
        open={showMembers}
        onClose={() => setShowMembers(false)}
        onLeave={handleLeave}
      />
    </div>
  )
}