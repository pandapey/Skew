// New Group modal — group name + member picker (internal staff only). Creating
// the group is a POST to /chat/conversations/groups; the server rejects any
// Client-role member id and always adds the creator as a member.
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiUsers } from 'react-icons/fi'
import { Modal, Button, Avatar, Loader, Input } from '@/components/ui'
import { chatApi } from '@/api/chatService'
import { QK } from './chatUtils'
import { useAuth } from '@/hooks/useAuth'

export function NewGroupModal({ open, onClose, onOpened }) {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState([])
  const [q, setQ] = useState('')

  const { data: users = [], isLoading } = useQuery({
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

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const { mutate: create, isPending } = useMutation({
    mutationFn: () => chatApi.createGroup({ name, memberIds: selected }),
    onSuccess: (conversation) => {
      qc.setQueryData(QK.conversations, (old) => {
        const rows = Array.isArray(old) ? old.filter((c) => c._id !== conversation._id) : []
        return [conversation, ...rows]
      })
      setName('')
      setSelected([])
      onClose()
      onOpened?.(conversation._id)
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="New Group" size="md">
      <Input
        label="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Product Team"
        maxLength={60}
      />

      <p className="label mt-4">Add members ({selected.length} selected)</p>
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="input pl-3"
        />
      </div>

      <div className="mt-2 max-h-[40vh] min-h-[160px] overflow-y-auto">
        {isLoading && <Loader label="Loading people…" />}
        {!isLoading && list.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No internal users to add.</p>
        )}
        <ul className="space-y-1">
          {list.map((u) => {
            const checked = selected.includes(u._id)
            return (
              <li key={u._id}>
                <button
                  type="button"
                  onClick={() => toggle(u._id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Avatar name={u.name} src={u.avatar} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {u.role}{u.designation ? ` · ${u.designation}` : ''}
                    </span>
                  </span>
                  <span
                    className={`flex h-4 w-4 flex-none items-center justify-center rounded border ${
                      checked ? 'border-primary bg-primary text-white' : 'border-app'
                    }`}
                  >
                    {checked && <FiUsers className="h-3 w-3" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={isPending} disabled={!name.trim() || selected.length === 0} onClick={() => create()}>
          Create Group
        </Button>
      </div>
    </Modal>
  )
}