// Group members panel — view members, add/remove members, leave group.
//
// Permission model matches the server exactly:
//   * Add / remove member buttons are rendered ONLY for the group creator or
//     an Admin-role user (the server re-enforces this on every request).
//   * The creator cannot be removed; self-removal goes through "Leave group".
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiUserPlus, FiX, FiLogOut, FiUsers } from 'react-icons/fi'
import { Modal, Button, Avatar, EmptyState } from '@/components/ui'
import { chatApi } from '@/api/chatService'
import { QK } from './chatUtils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

export function MembersPanel({ conversation, open, onClose, onLeave }) {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [addMode, setAddMode] = useState(false)

  const canManage =
    conversation?.isGroup &&
    (String(conversation.createdBy) === String(me?._id) || me?.role === ROLES.ADMIN)

  const { data: users = [] } = useQuery({
    queryKey: QK.users,
    queryFn: () => chatApi.users(),
    enabled: open && addMode,
  })

  const candidates = useMemo(() => {
    const memberIds = new Set((conversation?.participants || []).map((p) => String(p._id)))
    return users.filter((u) => !memberIds.has(String(u._id)) && String(u._id) !== String(me?._id))
  }, [users, conversation, me])

  const { mutate: addMember, isPending: adding } = useMutation({
    mutationFn: (userId) => chatApi.addMember(conversation._id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.conversation(conversation._id) })
      qc.invalidateQueries({ queryKey: QK.conversations })
      setAddMode(false)
    },
  })

  const { mutate: removeMember } = useMutation({
    mutationFn: (userId) => chatApi.removeMember(conversation._id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.conversation(conversation._id) })
      qc.invalidateQueries({ queryKey: QK.conversations })
    },
  })

  return (
    <Modal open={open} onClose={onClose} title={`Group Info · ${conversation?.name || ''}`} size="sm">
      <p className="text-xs text-muted">
        {conversation?.memberCount || 0} member(s) · created by{' '}
        {conversation?.participants?.find((p) => String(p._id) === String(conversation.createdBy))?.name || 'the creator'}
      </p>

      {canManage && !addMode && (
        <Button
          variant="ghost"
          size="sm"
          icon={FiUserPlus}
          className="mt-3"
          onClick={() => setAddMode(true)}
        >
          Add member
        </Button>
      )}

      {canManage && addMode && (
        <div className="mt-3">
          <p className="label">Add member</p>
          {candidates.length === 0 && (
            <p className="py-2 text-sm text-muted">No other internal users available.</p>
          )}
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((u) => (
              <li key={u._id}>
                <button
                  type="button"
                  disabled={adding}
                  onClick={() => addMember(u._id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Avatar name={u.name} src={u.avatar} size={28} />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className="text-xs text-muted">{u.role}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs font-semibold text-muted hover:text-primary" onClick={() => setAddMode(false)}>
            Done adding
          </button>
        </div>
      )}

      <div className="mt-4">
        <p className="label">Members</p>
        {(conversation?.participants || []).length === 0 && (
          <EmptyState icon={FiUsers} title="No members" description="This group has no members left." />
        )}
        <ul className="space-y-1">
          {(conversation?.participants || []).map((p) => {
            const isCreator = String(p._id) === String(conversation.createdBy)
            const isMe = String(p._id) === String(me?._id)
            const canRemove = canManage && !isCreator && !isMe
            return (
              <li key={String(p._id)} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
                <Avatar name={p.name} src={p.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}{isMe ? ' (you)' : ''}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {p.role}{isCreator ? ' · Creator' : ''}
                  </span>
                </span>
                {canRemove && (
                  <button
                    type="button"
                    title="Remove member"
                    onClick={() => removeMember(p._id)}
                    className="rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {conversation?.isGroup && (
        <div className="mt-5 flex justify-end">
          <Button variant="danger" icon={FiLogOut} onClick={onLeave}>
            Leave Group
          </Button>
        </div>
      )}
    </Modal>
  )
}