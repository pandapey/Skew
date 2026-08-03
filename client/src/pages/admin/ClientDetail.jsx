import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiPlus, FiTrash2, FiSend, FiEdit2 } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from '@/features/client/clientService'
import { adminApi } from '@/api/adminApi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, Button, Badge, Input, Select, Textarea, Loader, EmptyState, Avatar, ProgressBar, Modal, ConfirmDialog } from '@/components/ui'
import { fmtDate } from '@/features/client/constants'
// Phase 6.14 (TASK 3): the SAME schema + field config + renderer the Clients
// list page uses for its edit dialog. Reused wholesale so this page does not
// become a second, drifting definition of "a client form".
import { clientEditSchema, CLIENT_FIELDS } from '@/features/client/clientForm'
import { EntityFormFields } from '@/features/hr/EntityFormFields'
import { ROLES } from '@/constants'

const TABS = ['Overview', 'Projects', 'Team', 'Billing', 'Documents', 'Announcements', 'Progress', 'Messages', 'Danger']

// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 3) - RBAC ROOT CAUSE
// ---------------------------------------------------------------------------
// Routing already let a Manager reach /clients/:id, and GET /admin/clients/:id
// is authorize('Admin','HR','Manager') + assertCanAccessClient, so VIEWING
// worked. Every OTHER tab on this page, however, is backed by an endpoint the
// server gates with adminOnly = authorize('Admin'):
//   Projects      -> GET  /admin/projects, POST /clients/:id/projects
//   Team          -> PUT  /projects/:id/manager, /projects/:id/team
//   Billing       -> POST /projects/:id/invoices, PUT .../payments/:payId
//   Documents     -> POST /projects/:id/documents
//   Announcements -> POST /announcements
//   Progress      -> PUT  /projects/:id/progress
//   Messages      -> GET  /clients/:id/messages, POST /messages/:id/reply
//   Danger        -> DELETE /clients/:id
// A Manager opening this page therefore fired GET /admin/projects immediately
// on mount and took a guaranteed 403, which is what made the page look broken.
//
// The fix is presentational, NOT a permission change: those tabs are hidden
// from non-Admins and their queries are disabled, so a Manager is never shown a
// control that the server will refuse. Not one authorize() call was relaxed -
// the server remains the sole authority and still rejects these routes for
// Managers even if the UI were bypassed.
const ADMIN_ONLY_TABS = TABS.filter((t) => t !== 'Overview')

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === ROLES.ADMIN
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)
  // Phase 6.14 (TASK 3): edit dialog visibility.
  const [editOpen, setEditOpen] = useState(false)

  const { data: client, isLoading } = useQuery({ queryKey: ['admin-client', id], queryFn: () => clientService.getClient(id) })
  // Phase 6.14 (TASK 3): both of these back Admin-only tabs and both are
  // adminOnly server-side, so they are not fetched for other roles. The hooks
  // still RUN on every render (only `enabled` changes), so hook order - the
  // thing Phase 5.9 had to fix on this page - is untouched.
  const { data: allProjects = [] } = useQuery({ queryKey: ['admin-client-projects'], queryFn: () => clientService.listProjects(), enabled: isAdmin })
  const { data: empRes } = useQuery({ queryKey: ['admin-client-employees'], queryFn: () => employeeApi.query({ limit: 100 }), enabled: isAdmin })
  const employees = empRes?.data || []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-client', id] })
    qc.invalidateQueries({ queryKey: ['admin-clients'] })
    qc.invalidateQueries({ queryKey: ['admin-client-projects'] })
  }

  // ---------------------------------------------------------------------------
  // Phase 5.9 (Task 6) — CLIENT DETAILS PAGE ROOT CAUSE
  //
  // TRACE: pages/Clients.jsx row click -> navigate(`/clients/${id}`)
  //        -> routes/index.jsx `/clients/:id` -> AdminClientDetail (this file)
  //        -> clientService.getClient(id) -> GET /admin/clients/:id
  //        -> clientController.getClient -> Client.findOne -> res
  //
  // Routing, the API, the controller, the Mongo lookup and the RBAC guard were
  // ALL correct and were all verified individually. The page broke in the
  // browser, client-side, for a completely different reason: a violation of the
  // Rules of Hooks in this component.
  //
  // `mut()` is a thin wrapper whose body calls useMutation(). It was previously
  // invoked ~10 times BELOW the `if (isLoading)` / `if (!client)` early returns.
  // That means:
  //   * FIRST render — the query is still loading, so the component returns
  //     <Loader/> early and React records only the 3 useQuery hooks.
  //   * SECOND render — the client has arrived, the early returns are skipped,
  //     and React now encounters 11 EXTRA hooks that did not exist last time.
  // React compares hook counts between renders and throws
  //   "Rendered more hooks than during the previous render"
  // which unmounts the subtree — so clicking a client showed a blank page /
  // error boundary even though the data had loaded perfectly.
  //
  // This is also why the bug looked like a "backend" or "permission" problem:
  // the network request succeeded (200 with the client payload) and the crash
  // happened only after it resolved.
  //
  // FIX: every hook is now called unconditionally, in a fixed order, BEFORE any
  // early return. Hook order is therefore identical on every render. The derived
  // values that depend on `client` are moved below the guards (they are plain
  // computations, not hooks, so they are safe there). No API, route, controller
  // or permission was touched — the root cause was purely this ordering.
  // ---------------------------------------------------------------------------
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
  // Phase 6.14 (TASK 3): VIEW -> EDIT -> UPDATE, the capability this page was
  // missing entirely (Overview was read-only markup). It reuses the existing
  // PUT /admin/clients/:id endpoint via the existing clientService.updateClient
  // - the same service call the Clients list page's edit action makes. The
  // controller behind it already calls assertCanAccessClient(req.user, existing)
  // BEFORE mutating, so a Manager can only update a client linked to one of
  // their own projects. No new endpoint, service or permission.
  const editForm = useForm({ resolver: zodResolver(clientEditSchema) })
  const updateClientMut = useMutation({
    // `confirmPassword` / `password` are not rendered while editing (both are
    // createOnly), so they are dropped rather than sent as undefined.
    mutationFn: ({ password, confirmPassword, ...values }) => clientService.updateClient(id, values),
    onSuccess: () => { toast.success('Client updated'); setEditOpen(false); invalidate() },
    onError: (e) => toast.error(e?.response?.data?.message || 'Update failed'),
  })
  const openEdit = () => {
    // Seed the form from the loaded record so untouched fields round-trip.
    editForm.reset(CLIENT_FIELDS.reduce((acc, f) => ({ ...acc, [f.name]: client?.[f.name] ?? '' }), {}))
    setEditOpen(true)
  }

  const remove = useMutation({ mutationFn: () => clientService.removeClient(id), onSuccess: () => { toast.success('Client deleted'); navigate('/clients') }, onError: () => toast.error('Delete failed') })

  // Guards run AFTER every hook has been registered.
  if (isLoading) return <Loader label="Loading client…" />
  if (!client) return <EmptyState title="Client not found" />

  // Plain derived values (not hooks) — safe to compute after the guards.
  // Phase 6.14 (TASK 3): non-Admin roles see only the surfaces their token can
  // actually call (see ADMIN_ONLY_TABS above).
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
            {/* Phase 6.14 (TASK 3): Edit is available to every role allowed to
                reach this page. The server re-checks on PUT via
                assertCanAccessClient, so this button never widens access. */}
            <Button size="sm" variant="ghost" icon={FiEdit2} onClick={openEdit}>Edit</Button>
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

      {/* Phase 6.14 (TASK 3): the SHARED form - same <Modal>, same
          EntityFormFields renderer, same CLIENT_FIELDS config and same
          clientEditSchema the Clients list page edits with. `editing` is passed
          so createOnly fields (the portal credentials) stay hidden, exactly as
          they do in the list's edit modal. */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Client"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={updateClientMut.isPending} onClick={editForm.handleSubmit((v) => updateClientMut.mutate(v))}>Save</Button>
          </>
        )}
      >
        <form onSubmit={editForm.handleSubmit((v) => updateClientMut.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EntityFormFields form={editForm} fields={CLIENT_FIELDS} editing />
        </form>
      </Modal>

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
