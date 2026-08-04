import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiSend, FiMessageSquare } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { Avatar, Button, Loader } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/utils'

// Threaded comment stream for a project (optionally scoped to a task).
export function CommentsPanel({ projectId, taskId = null, taskTitle }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [body, setBody] = useState('')

  const params = taskId ? { project: projectId, task: taskId } : { project: projectId }
  const key = ['project-comments', projectId, taskId]
  const { data: comments = [], isLoading } = useQuery({ queryKey: key, queryFn: () => projectApi.comments(params), enabled: !!projectId })

  const addMut = useMutation({
    mutationFn: (payload) => projectApi.addComment(payload),
    onSuccess: () => {
      setBody('')
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] })
      toast.success('Comment posted')
    },
    onError: () => toast.error('Could not post comment'),
  })

  const submit = (e) => {
    e.preventDefault()
    if (!body.trim()) return
    addMut.mutate({ project: projectId, task: taskId, author: user?.name, body: body.trim(), taskTitle })
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex items-start gap-2">
        <Avatar name={user?.name} size={34} />
        <div className="flex-1">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="w-full rounded-xl border border-app bg-[var(--bg)] p-3 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" icon={FiSend} loading={addMut.isPending} disabled={!body.trim()}>Comment</Button>
          </div>
        </div>
      </form>

      {isLoading ? <Loader label="Loading comments…" /> : comments.length === 0 ? (
        <p className="flex flex-col items-center gap-2 py-8 text-sm text-muted"><FiMessageSquare className="h-6 w-6" />No comments yet</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <Avatar name={c.author} size={34} />
              <div className="flex-1 rounded-xl border border-app bg-[var(--bg)] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {c.author}
                    {/* Phase 5.4 (Task 4): same thread, two audiences - flag the
                        ones written from the Client Portal so the team can tell
                        at a glance that the client is watching/replying here. */}
                    {c.viaClientPortal && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Client</span>
                    )}
                  </span>
                  <span className="text-xs text-muted">{formatDate(c.createdAt, 'DD MMM YYYY')}</span>
                </div>
                <p className="text-sm">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
