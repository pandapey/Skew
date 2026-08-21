import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiPlus, FiTrash2, FiSend, FiEdit2 } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from '@/features/client/clientService'
import { adminApi } from '@/api/adminApi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, Button, Badge, Input, Select, Textarea, Loader, EmptyState, Avatar, ProgressBar, ConfirmDialog } from '@/components/ui'
import { fmtDate } from '@/features/client/constants'
import { ROLES } from '@/constants'

const TABS = ['Overview', 'Projects', 'Team', 'Billing', 'Documents', 'Announcements', 'Progress', 'Messages', 'Danger']
const ADMIN_ONLY_TABS = TABS.filter((t) => t !== 'Overview')

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === ROLES.ADMIN
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)

  const { data: client, isLoading } = useQuery({ queryKey: ['admin-client', id], queryFn: () => clientService.getClient(id) })
  const { data: allProjects = [] } = useQuery({ queryKey: ['admin-client-projects'], queryFn: () => clientService.listProjects(), enabled: isAdmin })
  const { data: empRes } = useQuery({ queryKey: ['admin-client-employees'], queryFn: () => employeeApi.query({ limit: 100 }), enabled: isAdmin })
  const employees = empRes?.data || []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-client', id] })
    qc.invalidateQueries({ queryKey: ['admin-clients'] })
    qc.invalidateQueries({ queryKey: ['admin-client-projects'] })
  }

  const mut = (fn, msg) => useMutation({ mutationFn: fn, onSuccess: () => { toast.success(msg); invalidate() }, onError: () => toast.error('Action failed') })

  const assignProject = mut((pid) => clientService.assignProject(id, pid), 'Project assigned')
  const setManager = mut(({ pid, mgr }) => clientService.assignProjectManager(pid, mgr), 'Manager updated')
  const assignTeam = mut(({ pid, members }) => clientService.assignTeam(pid, members), 'Team updated')
  const genInvoice = mut(({ pid, inv }) => clientService.generateInvoice(pid, inv), 'Invoice generated')
  const updPayment = mut(({ pid, payId, patch }) => clientService.updatePayment(pid, payId, patch), 'Payment updated')
  const publish = mut((ann) => clientService.publishAnnouncement(ann), 'Announcement published')
  const uploadDoc = mut(({ pid, doc }) => clientService.uploadDocument(pid, doc), 'Document uploaded')
  const updProgress = mut(({ pid, progress }) => clientService.updateProgress(pid, progress), 'Progress updated')
  const reply = mut(({ threadId, text }) => adminApi.clients.reply(threadId, text), 'Sent')
  const remove = useMutation({ mutationFn: () => clientService.removeClient(id), onSuccess: () => {
    toast.success('Client deleted')
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    navigate('/clients')
  }, onError: () => toast.error('Delete failed') })

  if (isLoading) return <Loader label="Loading client…" />
  if (!client) return <EmptyState title="Client not found" />

  const visibleTabs = isAdmin ? TABS : TABS.filter((t) => !ADMIN_ONLY_TABS.includes(t))
  const clientProjects = allProjects.filter((p) => p.clientId === id)
  const available = allProjects.filter((p) => p.clientId !== id)

  return (
    <div>
      <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/clients')} className="mb-3">Back to Clients</Button>
      <PageHeader title={client.company} subtitle={`${client.contactPerson} · ${client.plan} · ${client.status}`}
        actions={(
          <div className="flex items-center gap-2">
            <Badge tone={client.status === 'Active' ? 'success' : 'warning'}>{client.status}</Badge>
            <Button size="sm" variant="ghost" icon={FiEdit2} onClick={() => navigate(`/clients/${id}/edit`)}>Edit</Button>
          </div>
        )} />

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {visibleTabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t ? 'bg-primary text-white' : 'bg-black/5 text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'}`}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (
        <Card>
          <CardHeader title="Company Profile" />
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[['Contact', client.contactPerson], ['Designation', client.designation], ['Email', client.email], ['Phone', client.phone], ['Industry', client.industry], ['GST', client.gst], ['Plan', client.plan], ['Joined', fmtDate(client.joinedDate)], ['Address', client.address], ['Website', client.website]].map(([k, v]) => (
              <div key={k}><p className="text-xs text-muted">{k}</p><p className="font-medium">{v || '—'}</p></div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Projects' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Assigned Projects" />
            {clientProjects.length === 0 ? <EmptyState title="No projects assigned" /> : clientProjects.map((p) => (
              <div key={p.projectId} className="flex items-center justify-between rounded-xl border border-app p-3">
                <div><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-muted">{p.code} · {p.status}</p></div>
                <Button variant="ghost" size="sm" icon={FiTrash2} onClick={() => assignProject.mutate(p.projectId)}>Unassign</Button>
              </div>
            ))}
          </Card>
          <Card>
            <CardHeader title="Available Projects" subtitle="Assign to this client" />
            {available.length === 0 ? <EmptyState title="Nothing available" /> : available.slice(0, 8).map((p) => (
              <div key={p.projectId} className="flex items-center justify-between rounded-xl border border-app p-3">
                <div><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-muted">{p.code}</p></div>
                <Button size="sm" icon={FiPlus} onClick={() => assignProject.mutate(p.projectId)}>Assign</Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'Team' && (
        <div className="space-y-4">
          {clientProjects.map((p) => (
            <Card key={p.projectId}>
              <CardHeader title={p.name} subtitle="Assign project manager & team" />
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Manager:</span>
                <Select className="w-auto" value={p.projectManager || ''} onChange={(e) => setManager.mutate({ pid: p.projectId, mgr: e.target.value })}
                  options={[{ value: '', label: 'Select manager' }, ...employees.slice(0, 20).map((e) => ({ value: e.name, label: e.name }))]} />
              </div>
              <div className="space-y-2">
                {p.team?.map((m, i) => (
                  <div key={m.name + i} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                    <div className="flex items-center gap-2"><Avatar name={m.name} size={28} /><span className="text-sm">{m.name}</span><span className="text-xs text-muted">{m.roleInProject}</span></div>
                    <Button variant="ghost" size="sm" icon={FiTrash2} onClick={() => assignTeam.mutate({ pid: p.projectId, members: p.team.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                ))}
                <Select className="w-full" value="" onChange={(e) => { if (e.target.value) assignTeam.mutate({ pid: p.projectId, members: [...(p.team || []), { name: e.target.value, roleInProject: 'Member', position: 'Team Member', department: 'Skew Team', availability: 'Available' }] }) }}
                  options={[{ value: '', label: '+ Add team member' }, ...employees.filter((e) => !(p.team || []).some((m) => m.name === e.name)).slice(0, 30).map((e) => ({ value: e.name, label: e.name }))]} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'Billing' && (
        <div className="space-y-4">
          {clientProjects.map((p) => (
            <Card key={p.projectId}>
              <CardHeader title={p.name} subtitle="Generate invoice / update payments" action={<span className="text-sm font-semibold">Budget ₹{p.budget?.toLocaleString()}</span>} />
              <div className="mb-3 flex flex-wrap gap-2">
                <Input placeholder="Invoice # (e.g. INV-NEW-001)" className="w-auto flex-1" id={`inv-${p.projectId}`} />
                <Input placeholder="Amount" type="number" className="w-32" id={`amt-${p.projectId}`} />
                <Button size="sm" icon={FiPlus} onClick={() => {
                  const inv = document.getElementById(`inv-${p.projectId}`).value || `INV-${Date.now()}`
                  const amt = Number(document.getElementById(`amt-${p.projectId}`).value) || 0
                  if (amt <= 0) return toast.error('Enter an amount')
                  genInvoice.mutate({ pid: p.projectId, inv: { invoice: inv, amount: amt, paid: 0, status: 'Pending', date: new Date().toISOString().slice(0, 10), method: 'Bank Transfer' } })
                }}>Generate Invoice</Button>
              </div>
              <div className="space-y-2">
                {p.payments?.map((x) => (
                  <div key={x._id} className="flex flex-wrap items-center gap-2 rounded-xl border border-app p-2.5">
                    <span className="text-sm font-medium">{x.invoice}</span>
                    <span className="text-xs text-muted">₹{x.amount.toLocaleString()}</span>
                    <Badge tone={x.status === 'Paid' ? 'success' : x.status === 'Overdue' ? 'danger' : 'warning'}>{x.status}</Badge>
                    <div className="ml-auto flex gap-1">
                      {['Paid', 'Pending', 'Partial Payment', 'Overdue'].map((s) => (
                        <button key={s} onClick={() => updPayment.mutate({ pid: p.projectId, payId: x._id, patch: { status: s } })}
                          className="rounded-lg bg-black/5 px-2 py-1 text-xs transition hover:bg-primary/10 hover:text-primary dark:bg-white/10">{s}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'Documents' && (
        <div className="space-y-4">
          {clientProjects.map((p) => (
            <Card key={p.projectId}>
              <CardHeader title={p.name} subtitle="Upload a document" />
              <div className="mb-3 flex flex-wrap gap-2">
                <Input placeholder="Document name" className="flex-1" id={`docn-${p.projectId}`} />
                <Select className="w-auto" value="Proposal" id={`doct-${p.projectId}`} onChange={() => {}} options={['Proposal', 'Quotation', 'Agreement', 'Requirement', 'Design', 'Manual', 'Completion', 'Acceptance', 'Other'].map((t) => ({ value: t, label: t }))} />
                <Input placeholder="Size e.g. 1.2 MB" className="w-32" id={`docs-${p.projectId}`} />
                <Button size="sm" icon={FiPlus} onClick={() => {
                  const name = document.getElementById(`docn-${p.projectId}`).value
                  if (!name) return toast.error('Enter a name')
                  uploadDoc.mutate({ pid: p.projectId, doc: { name, type: document.getElementById(`doct-${p.projectId}`).value, size: document.getElementById(`docs-${p.projectId}`).value || '—', uploadedBy: user?.name || 'Admin' } })
                }}>Upload</Button>
              </div>
              <div className="space-y-2">
                {p.documents?.map((d, di) => <div key={d._id || di} className="flex items-center justify-between rounded-xl border border-app p-2.5"><span className="text-sm">{d.name}</span><Badge tone="accent">{d.type}</Badge></div>)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'Announcements' && (
        <Card>
          <CardHeader title="Publish Announcement" />
          <div className="space-y-3">
            <Input id="ann-title" placeholder="Title (e.g. Server Maintenance)" />
            <Textarea id="ann-body" placeholder="Message body…" />
            <div className="flex flex-wrap gap-2">
              <Select className="w-auto" id="ann-tag" value="Update" onChange={() => {}} options={['Update', 'Holiday', 'Maintenance', 'Feature', 'General'].map((t) => ({ value: t, label: t }))} />
              <Button icon={FiSend} onClick={() => {
                const title = document.getElementById('ann-title').value
                if (!title) return toast.error('Enter a title')
                publish.mutate({ title, body: document.getElementById('ann-body').value, tag: document.getElementById('ann-tag').value, pinned: false, date: new Date().toISOString().slice(0, 10) })
              }}>Publish</Button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'Progress' && (
        <div className="space-y-4">
          {clientProjects.map((p) => (
            <Card key={p.projectId}>
              <CardHeader title={p.name} subtitle={`${p.progress}% complete`} />
              <div className="flex items-center gap-3">
                <div className="flex-1"><ProgressBar value={p.progress} showLabel /></div>
                <Input type="number" className="w-24" defaultValue={p.progress} id={`prog-${p.projectId}`} />
                <Button size="sm" onClick={() => updProgress.mutate({ pid: p.projectId, progress: Number(document.getElementById(`prog-${p.projectId}`).value) })}>Update</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'Messages' && (
        <Card>
          <CardHeader title="Conversations" subtitle="Respond as your team" />
          <MessagesTab clientId={id} onReply={(threadId, text) => reply.mutate({ threadId, text })} replying={reply.isPending} />
        </Card>
      )}

      {tab === 'Danger' && (
        <Card className="border-danger/30">
          <CardHeader title="Danger Zone" />
          <div className="flex items-center justify-between rounded-xl bg-danger/5 p-4">
            <div><p className="font-medium text-danger">Delete this client</p><p className="text-sm text-muted">Removes the client and unassigns their projects. This cannot be undone.</p></div>
            <Button variant="ghost" className="text-danger" icon={FiTrash2} onClick={() => setDeleting(true)}>Delete Client</Button>
          </div>
        </Card>
      )}

      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} title="Delete client?"
        message="This will remove the client account and unassign all their projects." confirmLabel="Delete" loading={remove.isPending} />
    </div>
  )
}

function MessagesTab({ clientId, onReply, replying }) {
  const { data: threads = [] } = useQuery({ queryKey: ['admin-client-msgs', clientId], queryFn: () => adminApi.clients.messages(clientId) })
  const [sel, setSel] = useState(null)
  const [text, setText] = useState('')
  const t = threads.find((x) => x._id === sel) || threads[0]
  if (!threads.length) return <EmptyState title="No conversations" />
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
      <div className="space-y-1">
        {threads.map((th) => <button key={th._id} onClick={() => setSel(th._id)} className={`w-full rounded-xl p-2 text-left text-sm ${sel === th._id ? 'bg-primary/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>{th.subject}</button>)}
      </div>
      <div>
        {t && (
          <>
            <div className="mb-2 space-y-2">
              {t.messages.map((m, mi) => <div key={m._id || mi} className="rounded-xl bg-black/5 p-2 text-sm dark:bg-white/10"><p className="text-xs text-muted">{m.from}</p>{m.text}</div>)}
            </div>
            <div className="flex gap-2">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply as team…" onKeyDown={(e) => e.key === 'Enter' && text && onReply(t._id, text)} />
              <Button icon={FiSend} disabled={replying || !text} onClick={() => { onReply(t._id, text); setText('') }}>Send</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
