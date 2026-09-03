import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiUserPlus, FiX, FiLogOut, FiUsers, FiShield, FiEdit2, FiLink, FiSettings } from 'react-icons/fi'
import { Modal, Button, Avatar, EmptyState, Input } from '@/components/ui'
import { chatApi } from '@/api/chatService'
import { QK } from './chatUtils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import toast from 'react-hot-toast'

export function MembersPanel({ conversation, open, onClose, onLeave }) {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [addMode, setAddMode] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [name, setName] = useState(conversation?.name || '')
  const [desc, setDesc] = useState(conversation?.description || '')
  const [onlyAdmins, setOnlyAdmins] = useState(conversation?.settings?.onlyAdminsCanSend || false)

  const canManage =
    conversation?.isGroup &&
    (String(conversation.createdBy) === String(me?._id) || (conversation.admins || []).some((id) => String(id) === String(me?._id)) || me?.role === ROLES.ADMIN)

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
      toast.success('Member added')
    },
  })

  const { mutate: removeMember } = useMutation({
    mutationFn: (userId) => chatApi.removeMember(conversation._id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.conversation(conversation._id) })
      qc.invalidateQueries({ queryKey: QK.conversations })
      toast.success('Member removed')
    },
  })

  const { mutate: toggleAdmin } = useMutation({
    mutationFn: ({ uid, makeAdmin }) => chatApi.setAdmin(conversation._id, uid, makeAdmin),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.conversations })
      qc.invalidateQueries({ queryKey: QK.conversation(conversation._id) })
    },
  })

  const saveGroup = async () => {
    try {
      await chatApi.updateGroup(conversation._id, { name, description: desc })
      await chatApi.setSettings(conversation._id, { onlyAdminsCanSend: onlyAdmins })
      qc.invalidateQueries({ queryKey: QK.conversations })
      qc.invalidateQueries({ queryKey: QK.conversation(conversation._id) })
      toast.success('Group updated')
      setEditMode(false)
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed') }
  }

  const copyInvite = async () => {
    try {
      const res = await chatApi.invite(conversation._id)
      navigator.clipboard.writeText(window.location.origin + res.link)
      toast.success('Invite link copied: ' + res.inviteCode)
    } catch { toast.error('Failed') }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Group Info · ${conversation?.name || ''}`} size="md">
      <p className="text-xs text-muted">
        {conversation?.memberCount || 0} member(s) · created by{' '}
        {conversation?.participants?.find((p) => String(p._id) === String(conversation.createdBy))?.name || 'the creator'}
      </p>
      {conversation?.description && !editMode && <p className="mt-2 text-sm rounded-lg bg-black/5 p-2 dark:bg-white/5">{conversation.description}</p>}
      {conversation?.inviteCode && <p className="mt-1 text-xs flex items-center gap-2"><FiLink className="h-3 w-3" /> Invite: <code className="rounded bg-black/5 px-1">{conversation.inviteCode}</code> <button onClick={copyInvite} className="text-primary text-xs">Copy</button></p>}

      {canManage && !editMode && (
        <div className="flex items-center gap-2 mt-3">
          <Button variant="ghost" size="sm" icon={FiUserPlus} onClick={() => setAddMode(true)}>Add member</Button>
          <Button variant="ghost" size="sm" icon={FiEdit2} onClick={() => { setName(conversation.name); setDesc(conversation.description || ''); setOnlyAdmins(!!conversation.settings?.onlyAdminsCanSend); setEditMode(true) }}>Edit group</Button>
          <Button variant="ghost" size="sm" icon={FiLink} onClick={copyInvite}>Invite link</Button>
        </div>
      )}

      {canManage && editMode && (
        <div className="mt-3 space-y-3 rounded-xl border border-app p-3">
          <Input label="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Input label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this group about?" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAdmins} onChange={(e) => setOnlyAdmins(e.target.checked)} /> Only admins can send messages</label>
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>Cancel</Button><Button size="sm" onClick={saveGroup}>Save</Button></div>
        </div>
      )}

      {canManage && addMode && (
        <div className="mt-3">
          <p className="label">Add member</p>
          {candidates.length === 0 && <p className="py-2 text-sm text-muted">No other internal users available.</p>}
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((u) => (
              <li key={u._id}>
                <button type="button" disabled={adding} onClick={() => addMember(u._id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10">
                  <Avatar name={u.name} src={u.avatar} size={28} />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className="text-xs text-muted">{u.role}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs font-semibold text-muted hover:text-primary" onClick={() => setAddMode(false)}>Done adding</button>
        </div>
      )}

      <div className="mt-4">
        <p className="label">Members ({conversation?.participants?.length || 0})</p>
        {(conversation?.participants || []).length === 0 && <EmptyState icon={FiUsers} title="No members" description="This group has no members left." />}
        <ul className="space-y-1">
          {(conversation?.participants || []).map((p) => {
            const isCreator = String(p._id) === String(conversation.createdBy)
            const isAdmin = (conversation.admins || []).some((id) => String(id) === String(p._id)) || isCreator
            const isMe = String(p._id) === String(me?._id)
            const canRemove = canManage && !isCreator && !isMe
            return (
              <li key={String(p._id)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-black/5">
                <Avatar name={p.name} src={p.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium flex items-center gap-1">{p.name}{isMe ? ' (you)' : ''} {isAdmin && <FiShield className="h-3 w-3 text-amber-500" />} {p.groupRole === 'admin' && !isCreator && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Admin</span>}</span>
                  <span className="block truncate text-xs text-muted">{p.role}{isCreator ? ' · Creator' : isAdmin ? ' · Admin' : ''}</span>
                </span>
                {canManage && !isMe && (
                  <button type="button" title={isAdmin ? 'Demote' : 'Make admin'} onClick={() => toggleAdmin({ uid: p._id, makeAdmin: !isAdmin })} className="rounded-lg p-1.5 text-muted hover:bg-primary/10 hover:text-primary"><FiShield className="h-4 w-4" /></button>
                )}
                {canRemove && (
                  <button type="button" title="Remove member" onClick={() => removeMember(p._id)} className="rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger"><FiX className="h-4 w-4" /></button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {conversation?.isGroup && (
        <div className="mt-5 flex justify-between items-center">
          <span className="text-xs text-muted flex items-center gap-1"><FiSettings className="h-3 w-3" /> {conversation.settings?.onlyAdminsCanSend ? 'Only admins can send' : 'All members can send'}</span>
          <Button variant="danger" icon={FiLogOut} onClick={onLeave}>Leave Group</Button>
        </div>
      )}
    </Modal>
  )
}
