// New Chat modal — pick an internal user and start (or resume) a one-to-one
// conversation. The user list comes from GET /chat/users (staff only, Active);
// starting a chat calls the find-or-create direct endpoint, so resuming an
// existing thread never creates a duplicate.
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiSearch, FiMessageSquare } from 'react-icons/fi'
import { Modal, Avatar, Loader, EmptyState } from '@/components/ui'
import { chatApi } from '@/api/chatService'
import { QK } from './chatUtils'
import { useAuth } from '@/hooks/useAuth'

export function NewChatModal({ open, onClose, onOpened }) {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: QK.users,
    queryFn: () => chatApi.users(),
    enabled: open,
  })

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return users.filter((u) => {
      if (String(u._id) === String(me?._id)) return false
      if (!term) return true
      return `${u.name} ${u.email} ${u.role} ${u.empCode || ''}`.toLowerCase().includes(term)
    })
  }, [users, q, me])

  const { mutate: start, isPending } = useMutation({
    mutationFn: (userId) => chatApi.createDirect(userId),
    onSuccess: (conversation) => {
      qc.setQueryData(QK.conversations, (old) => {
        const rows = Array.isArray(old) ? old.filter((c) => c._id !== conversation._id) : []
        return [conversation, ...rows]
      })
      onClose()
      onOpened?.(conversation._id)
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="New Chat" size="md">
      <div className="relative">
        <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="input pl-9"
        />
      </div>

      <div className="mt-3 max-h-[55vh] min-h-[200px] overflow-y-auto">
        {isLoading && <Loader label="Loading people…" />}
        {isError && (
          <EmptyState icon={FiMessageSquare} title="Could not load people" description="Please try again." />
        )}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState icon={FiMessageSquare} title="No matches" description="No internal users match your search." />
        )}
        <ul className="space-y-1">
          {list.map((u) => (
            <li key={u._id}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => start(u._id)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Avatar name={u.name} src={u.avatar} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{u.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {u.role}{u.designation ? ` · ${u.designation}` : ''}{u.empCode ? ` · ${u.empCode}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}