import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiSend, FiMessageSquare, FiEdit2, FiTrash2, FiPaperclip, FiX, FiCheck, FiCornerUpLeft } from 'react-icons/fi'
import { Card, CardHeader, Badge, Avatar, Loader, Button } from '@/components/ui'
import { clientService } from './clientService'
import { fmtDate, fmtDateTime } from './constants'
import { fileUrl } from '@/features/files/constants'

export default function ProjectCommunication({ projectId, viewerName, title = 'Project Communication Center', subtitle = 'Talk directly with your project team' }) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const key = ['client-project-comments', projectId]

  const { data: comments = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => clientService.getProjectComments(projectId),
    enabled: !!projectId,
  })

  const addMut = useMutation({
    mutationFn: async (text) => {
      const comment = await clientService.addProjectComment(projectId, text)
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        await clientService.uploadCommentAttachment(projectId, fd)
      }
      return comment
    },
    onSuccess: () => {
      setBody('')
      setFile(null)
      setReplyTo(null)
      qc.invalidateQueries({ queryKey: key })
      toast.success('Sent to your project team')
    },
    onError: (err) => toast.error(err?.message || 'Could not post comment'),
  })

  const editMut = useMutation({
    mutationFn: ({ id, text }) => clientService.updateProjectComment(projectId, id, text),
    onSuccess: () => {
      setEditingId(null)
      qc.invalidateQueries({ queryKey: key })
      toast.success('Comment updated')
    },
    onError: (err) => toast.error(err?.message || 'Could not update comment'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => clientService.deleteProjectComment(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      toast.success('Comment deleted')
    },
    onError: (err) => toast.error(err?.message || 'Could not delete comment'),
  })

  const submit = (e) => {
    e.preventDefault()
    if (!body.trim()) return
    const text = replyTo ? `@${replyTo.author} ${body.trim()}` : body.trim()
    addMut.mutate(text)
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <form onSubmit={submit} className="mb-4 flex items-start gap-2">
        <Avatar name={viewerName} size={34} />
        <div className="flex-1">
          {replyTo && (
            <div className="mb-1 flex items-center justify-between rounded-lg bg-black/5 px-2 py-1 text-xs text-muted dark:bg-white/10">
              <span>Replying to {replyTo.author}</span>
              <button type="button" onClick={() => setReplyTo(null)}><FiX /></button>
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Write a message to your project team…"
            className="w-full rounded-xl border border-app bg-[var(--bg)] p-3 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-primary">
              <FiPaperclip />{file ? file.name : 'Attach file'}
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <Button type="submit" icon={FiSend} loading={addMut.isPending} disabled={!body.trim()}>Send</Button>
          </div>
        </div>
      </form>

      {isLoading ? <Loader label="Loading discussion…" /> : comments.length === 0 ? (
        <p className="flex flex-col items-center gap-2 py-8 text-sm text-muted">
          <FiMessageSquare className="h-6 w-6" />No messages yet
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const mine = c.viaClientPortal && c.author === viewerName
            const isEditing = editingId === (c.id || c._id)
            return (
              <div key={c.id || c._id} className="flex items-start gap-3">
                <Avatar name={c.author} src={c.avatar} size={34} />
                <div className="flex-1 rounded-xl border border-app bg-[var(--bg)] p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {c.author}
                      <Badge tone={c.viaClientPortal ? 'accent' : 'primary'}>{c.role || (c.viaClientPortal ? 'Client' : 'Team')}</Badge>
                      {c.edited && <span className="text-xs font-normal text-muted">(edited)</span>}
                    </span>
                    <span className="text-xs text-muted" title={fmtDateTime(c.createdAt)}>{fmtDate(c.createdAt)} · {fmtDateTime(c.createdAt).split(',').pop()?.trim()}</span>
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2}
                        className="w-full rounded-lg border border-app bg-[var(--bg)] p-2 text-sm outline-none focus:border-primary" />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="sm" icon={FiCheck} loading={editMut.isPending}
                          onClick={() => editMut.mutate({ id: c.id || c._id, text: editBody })}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  )}
                  {!!(c.attachments || []).length && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.attachments.map((a, i) => (
                        <a key={i} href={fileUrl(a.url)} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 rounded-lg bg-black/5 px-2 py-1 text-xs text-primary hover:underline dark:bg-white/10">
                          <FiPaperclip />{a.name}
                        </a>
                      ))}
                    </div>
                  )}
                  {!isEditing && (
                    <div className="mt-2 flex gap-3 text-xs text-muted">
                      <button type="button" className="flex items-center gap-1 hover:text-primary" onClick={() => setReplyTo(c)}>
                        <FiCornerUpLeft />Reply
                      </button>
                      {mine && (
                        <>
                          <button type="button" className="flex items-center gap-1 hover:text-primary"
                            onClick={() => { setEditingId(c.id || c._id); setEditBody(c.body) }}>
                            <FiEdit2 />Edit
                          </button>
                          <button type="button" className="flex items-center gap-1 hover:text-danger"
                            onClick={() => deleteMut.mutate(c.id || c._id)}>
                            <FiTrash2 />Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
