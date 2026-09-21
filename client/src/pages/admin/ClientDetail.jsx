import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiPlus, FiTrash2, FiSend, FiEdit2, FiArrowRight } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from '@/features/client/clientService'
import { adminApi } from '@/api/adminApi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, Button, Badge, Input, Select, Textarea, Loader, EmptyState, Avatar, ConfirmDialog } from '@/components/ui'
import { ROLES } from '@/constants'

const TABS = ['Overview', 'Projects', 'Team', 'Billing', 'Documents', 'Announcements', 'Messages', 'Danger']
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

  const setManager = mut(({ pid, mgr }) => clientService.assignProjectManager(pid, mgr), 'Manager updated')
  const assignTeam = mut(({ pid, members }) => clientService.assignTeam(pid, members), 'Team updated')
  const genInvoice = mut(({ pid, inv }) => clientService.generateInvoice(pid, inv), 'Invoice generated')
  const updPayment = mut(({ pid, payId, patch }) => clientService.updatePayment(pid, payId, patch), 'Payment updated')
  const publish = mut((ann) => clientService.publishAnnouncement(ann), 'Announcement published')
  const uploadDoc = mut(({ pid, doc }) => clientService.uploadDocument(pid, doc), 'Document uploaded')
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
  // Fix: /admin/projects returns Project docs ({_id, lead, members}) while the
  // Team UI expected legacy ClientProject shape ({projectId, projectManager, team}).
  // Normalize so already-added members + current manager always show.
  const toTeamMember = (m) => {
    if (!m) return null
    if (typeof m === 'string') return { name: m, roleInProject: 'Member', position: 'Team Member', department: 'Skew Team', availability: 'Available' }
    return {
      name: m.name || '',
      roleInProject: m.roleInProject || m.role || 'Member',
      position: m.position || m.role || 'Team Member',
      department: m.department || 'Skew Team',
      availability: m.availability || 'Available',
      avatar: m.avatar || '',
    }
  }
  const clientProjects = allProjects
    .filter((p) => p.clientId === id)
    .map((p) => {
      const projectId = p.projectId || p.id || (p._id ? String(p._id) : '')
      const projectManager = p.projectManager || p.lead || ''
      let team = Array.isArray(p.team) && p.team.length
        ? p.team.map(toTeamMember).filter((m) => m && m.name)
        : []
      if (!team.length && Array.isArray(p.members) && p.members.length) {
        const fromMembers = p.members.map((m) => toTeamMember(m)).filter((m) => m && m.name)
        const leadEntry = projectManager ? [toTeamMember({ name: projectManager, roleInProject: 'Lead', position: 'Team Lead' })] : []
        // Dedupe by name so lead isn't listed twice
        const seen = new Set()
        team = [...leadEntry, ...fromMembers].filter((m) => {
          const k = String(m.name).trim().toLowerCase()
          if (!k || seen.has(k)) return false
          seen.add(k)
          return true
        })
      }
      return { ...p, projectId, projectManager, team }
    })

  return (
    <div>
      <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/clients')} className="mb-3">Back to Clients</Button>
      <PageHeader title={client.company} subtitle={`${client.contactPerson} · ${client.status}`}
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
            {[['Contact', client.contactPerson], ['Email', client.email], ['Phone', client.phone], ['GST', client.gst], ['Address', client.address]].map(([k, v]) => (
              <div key={k}><p className="text-xs text-muted">{k}</p><p className="font-medium">{v || '—'}</p></div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Projects' && (
        <Card>
          <CardHeader title="Assigned Projects" />
          {clientProjects.length === 0 ? <EmptyState title="No projects assigned" /> : (
            <div className="space-y-2.5">
              {clientProjects.map((p) => {
                const target = `/projects/${p.code || p.projectId || p.id}`
                return (
                  <button
                    key={p.projectId || p.id}
                    type="button"
                    onClick={() => navigate(target)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-app p-3 text-left transition hover:border-primary/50 hover:bg-primary/[0.03]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted">{p.code} · {p.status}</p>
                    </div>
                    <span className="flex flex-none items-center gap-1 text-xs font-medium text-primary">
                      Open <FiArrowRight />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'Team' && (
        <div className="space-y-4">
          {clientProjects.length === 0 && <Card><EmptyState title="No projects assigned" description="Team members will appear here once projects are assigned." /></Card>}
          {clientProjects.map((p) => {
            const managerOpts = [
              { value: '', label: p.projectManager ? `Current: ${p.projectManager}` : 'Select manager' },
              ...employees
                .filter((e) => !p.projectManager || e.name !== p.projectManager)
                .slice(0, 50)
                .map((e) => ({ value: e.name, label: e.name })),
            ]
            // Ensure current manager stays selectable even if outside the sliced list
            if (p.projectManager && !managerOpts.some((o) => o.value === p.projectManager)) {
              managerOpts.splice(1, 0, { value: p.projectManager, label: p.projectManager })
            }
            const availableToAdd = employees
              .filter((e) => !(p.team || []).some((m) => String(m.name).trim().toLowerCase() === String(e.name).trim().toLowerCase()))
              .slice(0, 50)
            return (
            <Card key={p.projectId || p.id || p._id}>
              <CardHeader title={`Project: ${p.name}`} subtitle={`${p.code || ''} · ${p.status || ''} · ${(p.team || []).length} member(s)${p.projectManager ? ` · Manager: ${p.projectManager}` : ''}`} />
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Manager:</span>
                <Select className="w-auto" value={p.projectManager || ''} onChange={(e) => setManager.mutate({ pid: p.projectId, mgr: e.target.value })}
                  options={managerOpts} />
                {p.projectManager && <Badge tone="primary">{p.projectManager}</Badge>}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Already added members — {p.name} ({(p.team || []).length})</p>
                {!(p.team || []).length && <p className="rounded-xl border border-dashed border-app p-3 text-sm text-muted">No team members assigned to {p.name} yet.</p>}
                {p.team?.map((m, i) => (
                  <div key={m.name + i} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                    <div className="flex min-w-0 items-center gap-2"><Avatar name={m.name} size={28} /><span className="truncate text-sm font-medium">{m.name}</span><span className="text-xs text-muted">{m.roleInProject || m.position || 'Member'}</span></div>
                    <Button variant="ghost" size="sm" icon={FiTrash2} onClick={() => assignTeam.mutate({ pid: p.projectId, members: p.team.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                ))}
                <Select className="w-full" value="" onChange={(e) => { if (e.target.value) assignTeam.mutate({ pid: p.projectId, members: [...(p.team || []), { name: e.target.value, roleInProject: 'Member', position: 'Team Member', department: 'Skew Team', availability: 'Available' }] }) }}
                  options={[{ value: '', label: p.team?.length ? `+ Add more (${(p.team || []).length} already added)` : '+ Add team member' }, ...availableToAdd.map((e) => ({ value: e.name, label: e.name }))]} />
              </div>
            </Card>
            )
          })}
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
                  genInvoice.mutate({ pid: p.projectId, inv: { invoice: inv, amount: amt, paid: 0, status: 'Pending', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), method: 'Bank Transfer' } })
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
                publish.mutate({ title, body: document.getElementById('ann-body').value, tag: document.getElementById('ann-tag').value, pinned: false, date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) })
              }}>Publish</Button>
            </div>
          </div>
        </Card>
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
