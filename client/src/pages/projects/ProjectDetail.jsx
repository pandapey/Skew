import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiEdit2, FiPlus, FiCalendar, FiDollarSign, FiUser, FiTrash2,
  FiCheckCircle, FiAlertCircle, FiFlag, FiTrendingUp,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import {
  PageHeader, Card, Tabs, Badge, Avatar, Button, Loader,
  StatCard, ConfirmDialog, Modal,
} from '@/components/ui'
import { KanbanBoard } from '@/features/projects/KanbanBoard'
import { ActivityFeed } from '@/features/projects/ActivityFeed'
import { TaskModal } from '@/features/projects/TaskModal'
import { ProjectModal } from '@/features/projects/ProjectModal'
import { CommentsPanel } from '@/features/projects/CommentsPanel'
import { FilesPanel } from '@/features/projects/FilesPanel'
import { MembersPanel } from '@/features/projects/MembersPanel'
import { ProgressBar } from '@/features/projects/ProgressBar'
// Phase 6.12 (TASK 1): the SAME documents panel the client portal renders. It
// is parameterised by an `api` adapter so both portals drive the one shared
// ClientProject.documents[] store through their own RBAC-scoped routes. No
// second document component exists.
import ProjectDocuments from '@/features/client/ProjectDocuments'
// Phase 6.12 (TASK 2): project-scoped view over the EXISTING CalendarEvent
// meeting requests. No second meeting model, collection or endpoint.
import { MeetingRequestsPanel } from '@/features/projects/MeetingRequestsPanel'
import {
  PROJECT_DETAIL_TABS, PROJECT_WRITE_ROLES, PROJECT_STATUS_TONE, PRIORITY_TONE,
  TYPE_TONE, TASK_STATUS_TONE, MILESTONE_TONE, MANAGER_HIDDEN_DETAIL_TAB_KEYS } from '@/features/projects/constants'
import { formatDate, formatCurrency } from '@/utils'

// Tabs an Employee may see on the project detail page. The scoped employee view
// hides admin/other-employee surfaces (sprints, files, members, activity) and
// keeps only the work relevant to the logged-in employee (#1).
//
// Phase 6.12 (TASK 1): 'backlog' and 'milestones' are REMOVED from the employee
// view, and 'documents' is added. Both tabs remain in PROJECT_DETAIL_TABS for
// Admin/Manager/HR, who still manage backlog grooming and delivery milestones -
// this allow-list is precisely the mechanism the codebase already uses to scope
// the employee view, so the removal is expressed here rather than by deleting a
// working privileged surface.
//
// Phase 6.12 (TASK 2): 'meetings' sits immediately before 'comments' and is
// additionally gated on lead-ship below, so a non-lead Employee never sees it.
const EMPLOYEE_TAB_KEYS = ['overview', 'board', 'documents', 'meetings', 'comments']

// Phase 6.12 (TASK 1): the staff adapter for the shared document panel. Points
// at /project/:id/documents (staff-only router) instead of /client/... - the
// SAME ClientProject.documents[] array on the server, reached through the door
// this user is allowed to use.
const staffDocumentsApi = {
  list: (_user, projectId) => projectApi.documents(projectId),
  upload: (projectId, formData) => projectApi.uploadDocument(projectId, formData),
  remove: (projectId, docId) => projectApi.deleteDocument(projectId, docId),
  downloadUrl: (projectId, docId) => projectApi.downloadDocumentUrl(projectId, docId),
  // Busting 'project-detail' as well keeps the rest of the page consistent
  // after an upload, mirroring what the client-side adapter does.
  keys: (projectId) => [
    ['project-documents', projectId],
    ['project-detail', projectId],
  ],
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)
  // Employees get a scoped, read-only project view: no financials/budget, no
  // admin tabs, no edit/delete (already gated by canWrite) — only their work.
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  // Phase 6.14 (TASK 5): role flag declared alongside the existing isEmployee
  // flag and derived from the SAME hasRole() helper, so tab visibility keeps
  // using one role source rather than a second ad-hoc check.
  const isManager = hasRole(ROLES.MANAGER)
  // Phase 6.15 (TASK 4): HR needs the exact same tab set hidden (Backlog,
  // Sprints, Milestones, Activity, Files), so it is added to the SAME
  // MANAGER_HIDDEN_DETAIL_TAB_KEYS deny-list below rather than a second list.
  const isHR = hasRole(ROLES.HR)
  // Phase 6.16 (TASK 3): Admin has the exact same request (hide Backlog,
  // Sprints, Milestones, Files, Activity) with the exact same tab-key list,
  // so Admin joins the SAME deny-list check rather than a third parallel one.
  const isAdmin = hasRole(ROLES.ADMIN)

  const [tab, setTab] = useState('overview')
  const [taskModal, setTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [taskDetail, setTaskDetail] = useState(null)
  const [editProject, setEditProject] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: project, isLoading } = useQuery({ queryKey: ['project-detail', id], queryFn: () => projectApi.detail(id) })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-detail', id] })
    qc.invalidateQueries({ queryKey: ['project-activity', id] })
    qc.invalidateQueries({ queryKey: ['projects-all'] })
    qc.invalidateQueries({ queryKey: ['project-stats'] })
  }

  const moveMut = useMutation({
    mutationFn: ({ taskId, status }) => projectApi.moveTask(taskId, status),
    onSuccess: (_r, v) => { toast.success(`Moved to ${v.status}`); invalidate() },
    onError: () => toast.error('Could not move task'),
  })
  const saveTaskMut = useMutation({
    mutationFn: (values) => (editingTask ? projectApi.updateTask(editingTask.id, values) : projectApi.createTask({ ...values, project: id })),
    onSuccess: () => { toast.success(editingTask ? 'Task updated' : 'Task created — team notified'); setTaskModal(false); invalidate() },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save task'),
  })
  const saveProjectMut = useMutation({
    mutationFn: (values) => projectApi.update(id, values),
    onSuccess: () => { toast.success('Project updated'); setEditProject(false); invalidate() },
    onError: () => toast.error('Could not save project'),
  })
  const deleteMut = useMutation({
    mutationFn: () => projectApi.remove(id),
    onSuccess: () => { toast.success('Project deleted'); navigate('/projects') },
    onError: () => toast.error('Could not delete project'),
  })

  if (isLoading) return <Loader label="Loading project…" />
  if (!project) return <p className="py-10 text-center text-muted">Project not found.</p>

  const tasks = project.tasks || []
  const sprints = project.sprints || []
  const milestones = project.milestones || []
  const bugs = tasks.filter((t) => t.type === 'Bug')
  const doneTasks = tasks.filter((t) => t.status === 'Done').length
  const backlog = tasks.filter((t) => !t.sprint)

  // --- Part 6: Project Lead task management ---
  // The lead of THIS project may create and edit its tasks even though their
  // account role (usually Employee) is not in PROJECT_WRITE_ROLES. This only
  // unlocks TASK management — project edit/delete, files and members stay
  // gated by `canWrite`. The server re-checks lead-ship and the assignee pool,
  // so the UI gate is convenience, not the security boundary.
  const isLead = Boolean(user?.name) && project.lead === user.name
  const canManageTasks = canWrite || isLead
  // A lead may only assign to people on this project: its members plus itself.
  const assigneePool = [
    ...(project.lead ? [{ name: project.lead }] : []),
    ...(project.members || []),
  ].filter((m, i, arr) => m?.name && arr.findIndex((x) => x.name === m.name) === i)
  // Phase 6.12 (TASK 2): Meeting Requests is a LEAD surface. Privileged roles
  // (Admin/Manager/HR) keep it too, matching the server's own
  // assertCanManageMeeting rule; everyone else never sees the tab. The server
  // remains the authority - hiding the tab is convenience only.
  // Phase 6.17 (TASK 5) ROOT CAUSE FIX: this only checked canWrite (Admin/
  // HR/Manager) or isLead, so an ordinary Employee who is simply a project
  // MEMBER (not the lead) never saw the Meeting tab at all, even though
  // EMPLOYEE_TAB_KEYS already lists 'meetings' as an employee-visible tab and
  // the server-side visibility rule (Task 5) grants Employees their own
  // assigned/member projects. The tab-gating flag here was the actual gap -
  // widened to include plain project membership; the Accept/Reject/
  // Reschedule action buttons stay gated on canWrite/isLead exactly as
  // before, so only visibility (not authorization) changes.
  const isMember = (project?.members || []).some((m) => m?.name === user?.name)
  const canSeeMeetings = canWrite || isLead || isMember
  const visibleTabs = PROJECT_DETAIL_TABS.filter((t) => (t.key === 'meetings' ? canSeeMeetings : true))
  // Phase 6.14 (TASK 5) ROOT CAUSE: this file already had a per-role tab
  // filter, but Employee was the ONLY role wired into it - every other role
  // fell through to the full PROJECT_DETAIL_TABS list. The Manager arm is added
  // to the SAME expression rather than a parallel mechanism. It is a deny list
  // (not an allow list) so any tab added in a future phase keeps appearing for
  // Manager by default, and Admin/HR/Employee/Client are unaffected.
  const roleFilteredTabs = (isManager || isHR || isAdmin)
    ? visibleTabs.filter((t) => !MANAGER_HIDDEN_DETAIL_TAB_KEYS.includes(t.key))
    : visibleTabs
  const detailTabs = isEmployee ? roleFilteredTabs.filter((t) => EMPLOYEE_TAB_KEYS.includes(t.key)) : roleFilteredTabs

  const openAddTask = () => { setEditingTask(null); setTaskModal(true) }
  const openEditTask = (t) => { setEditingTask(t); setTaskDetail(null); setTaskModal(true) }

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />{project.name}</span>}
        subtitle={`${project.code || ''}${project.client ? ` · ${project.client}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>{project.status}</Badge>
            <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
            {canWrite && <Button variant="ghost" icon={FiEdit2} onClick={() => setEditProject(true)}>Edit</Button>}
            {canWrite && <Button variant="ghost" icon={FiTrash2} onClick={() => setConfirmDelete(true)}>Delete</Button>}
          </div>
        }
      />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tasks Done" value={`${doneTasks}/${tasks.length}`} icon={FiCheckCircle} tone="success" />
        <StatCard label="Open Bugs" value={bugs.filter((b) => b.status !== 'Done').length} icon={FiAlertCircle} tone="danger" />
        <StatCard label="Milestones" value={`${milestones.filter((m) => m.status === 'Reached').length}/${milestones.length}`} icon={FiFlag} tone="accent" />
        <StatCard label="Progress" value={`${project.progress || 0}%`} icon={FiTrendingUp} tone="primary" />
      </div>

      <Card className="mb-4">
        <Tabs items={detailTabs} value={tab} onChange={setTab} className="mb-4" />

        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <p className="text-sm text-muted">{project.description || 'No description provided.'}</p>
              <div className="mt-4"><ProgressBar value={project.progress || 0} color={project.color} showLabel /></div>
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { l: 'Lead', v: project.lead || '—', i: FiUser },
                  { l: 'Start', v: formatDate(project.startDate, 'DD MMM YYYY'), i: FiCalendar },
                  { l: 'Deadline', v: formatDate(project.deadline, 'DD MMM YYYY'), i: FiCalendar },
                  ...(isEmployee ? [] : [{ l: 'Budget', v: formatCurrency(project.budget), i: FiDollarSign }]),
                ].map((x) => (
                  <div key={x.l}>
                    <p className="flex items-center gap-1 text-xs text-muted"><x.i className="h-3 w-3" />{x.l}</p>
                    <p className="mt-0.5 text-sm font-medium">{x.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <h4 className="mb-2 text-sm font-semibold text-muted">Team</h4>
                <div className="flex flex-wrap gap-2">
                  {(project.members || []).map((m) => (
                    <span key={m.name} className="flex items-center gap-2 rounded-full border border-app py-1 pl-1 pr-3 text-sm">
                      <Avatar name={m.name} size={24} />{m.name}<Badge tone={m.role === 'Lead' ? 'primary' : 'default'}>{m.role}</Badge>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-muted">Recent Activity</h4>
              <ActivityFeed activity={(project.activity || []).slice(0, 6)} />
            </div>
          </div>
        )}

        {tab === 'board' && (
          <div>
            <div className="mb-4 flex justify-end">{canManageTasks && <Button icon={FiPlus} onClick={openAddTask}>Add Task</Button>}</div>
            <KanbanBoard tasks={tasks} onMove={(taskId, status) => moveMut.mutate({ taskId, status })} onCardClick={setTaskDetail} />
          </div>
        )}

        {tab === 'backlog' && (
          <div className="space-y-2">
            {backlog.length === 0 ? <p className="py-8 text-center text-sm text-muted">Backlog is empty</p> : backlog.map((t) => (
              <button key={t.id} onClick={() => setTaskDetail(t)} className="flex w-full items-center gap-3 rounded-xl border border-app p-3 text-left hover:border-primary">
                <Badge tone={TYPE_TONE[t.type]}>{t.type}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                <span className="text-xs text-muted">{t.storyPoints} pts</span>
                <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                <Avatar name={t.assignee} size={24} />
              </button>
            ))}
          </div>
        )}

        {tab === 'sprints' && (
          <div className="space-y-4">
            {sprints.length === 0 ? <p className="py-8 text-center text-sm text-muted">No sprints yet</p> : sprints.map((s) => {
              const items = tasks.filter((t) => t.sprint === s.id)
              const pts = items.reduce((sum, t) => sum + (t.storyPoints || 0), 0)
              const done = items.filter((t) => t.status === 'Done').length
              return (
                <div key={s.id} className="rounded-xl border border-app p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-xs text-muted">{s.goal} · {formatDate(s.startDate, 'DD MMM')} – {formatDate(s.endDate, 'DD MMM')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.status === 'Active' ? 'primary' : s.status === 'Completed' ? 'success' : 'default'}>{s.status}</Badge>
                      <Badge tone="accent">{items.length} tasks · {pts} pts</Badge>
                    </div>
                  </div>
                  <ProgressBar value={items.length ? (done / items.length) * 100 : 0} />
                </div>
              )
            })}
            <Button variant="ghost" icon={FiPlus} onClick={() => navigate('/projects/sprints')}>Manage sprints</Button>
          </div>
        )}

        {tab === 'milestones' && (
          <div className="space-y-3">
            {milestones.length === 0 ? <p className="py-8 text-center text-sm text-muted">No milestones yet</p> : milestones.map((m) => (
              <div key={m.id} className="rounded-xl border border-app p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium"><FiFlag className="text-warning" />{m.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={MILESTONE_TONE[m.status]}>{m.status}</Badge>
                    <span className="text-xs text-muted">{formatDate(m.dueDate, 'DD MMM YYYY')}</span>
                  </div>
                </div>
                <ProgressBar value={m.progress} />
              </div>
            ))}
          </div>
        )}

        {/* Phase 6.12 (TASK 1): one shared document source. An upload here
            lands in the identical ClientProject.documents[] array the client
            portal reads, and the server re-emits the portal's existing
            'client:document' event, so each side sees the other's uploads
            immediately. */}
        {tab === 'documents' && <ProjectDocuments projectId={id} api={staffDocumentsApi} />}
        {/* Phase 6.12 (TASK 2): guarded a second time at the render site so the
            panel cannot mount even if a stale tab value survives a role change. */}
        {/* Phase 6.21 (TASK 2): VIEWING meetings stays open to any member
            (Phase 6.17 TASK 5), but CREATING a client meeting request is
            restricted to the project lead and the full-access roles - reusing
            the same isLead/canWrite facts computed above, and mirrored by the
            server-side check in calendarController.create. */}
        {tab === 'meetings' && canSeeMeetings && (
          <MeetingRequestsPanel projectId={id} project={project} canRequestMeeting={canWrite || isLead} />
        )}
        {tab === 'files' && <FilesPanel projectId={id} canWrite={canWrite} />}
        {tab === 'members' && <MembersPanel project={project} canWrite={canWrite} />}
        {tab === 'comments' && <CommentsPanel projectId={id} />}
        {tab === 'activity' && <ActivityFeed activity={project.activity || []} />}
      </Card>

      {/* Create/edit task editor 2014 only mounted for users who can write.
          Employees get the read-only TaskDetailModal below instead. */}
      {canManageTasks && (
      <TaskModal
        open={taskModal}
        onClose={() => setTaskModal(false)}
        onSubmit={(v) => saveTaskMut.mutate(v)}
        editing={editingTask}
        saving={saveTaskMut.isPending}
        members={assigneePool}
        sprints={sprints}
        projectName={project.name}
        // A lead must pick someone on the project; privileged roles keep the
        // existing "Unassigned" escape hatch.
        requireAssignee={isLead && !canWrite}
        restrictedToMembers={isLead && !canWrite}
      />
      )}

      {/* Task detail */}
      {taskDetail && (
        <TaskDetailModal task={taskDetail} projectId={id} canWrite={canManageTasks} onClose={() => setTaskDetail(null)} onEdit={() => openEditTask(taskDetail)} />
      )}

      {/* Edit-project editor. Only mounted for users who can write. This modal
          loads clients via the admin-only GET /admin/clients endpoint, so
          mounting it for an Employee was the true root cause of the
          /api/admin/clients 500 + 403 seen on the employee project page. */}
      {canWrite && (
        <ProjectModal open={editProject} onClose={() => setEditProject(false)} onSubmit={(v) => saveProjectMut.mutate(v)} editing={project} saving={saveProjectMut.isPending} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMut.mutate()}
        title="Delete project?"
        message={`This permanently deletes "${project.name}" and cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMut.isPending}
      />
    </div>
  )
}

// Task detail modal with an embedded task-scoped comment thread.
function TaskDetailModal({ task, projectId, canWrite, onClose, onEdit }) {
  return (
    <Modal open onClose={onClose} title="Task Details" size="lg"
      footer={<>{canWrite && <Button variant="ghost" onClick={onEdit}>Edit</Button>}<Button onClick={onClose}>Close</Button></>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={TYPE_TONE[task.type]}>{task.type}</Badge>
        <Badge tone={TASK_STATUS_TONE[task.status]}>{task.status}</Badge>
        <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
        {task.type === 'Bug' && <Badge tone="danger">{task.severity}</Badge>}
      </div>
      <h3 className="text-lg font-semibold">{task.title}</h3>
      <p className="mt-1 text-sm text-muted">{task.description || 'No description.'}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Assignee', task.assignee || '—'], ['Reporter', task.reporter || '—'], ['Story Points', task.storyPoints || '—'], ['Due', formatDate(task.dueDate)]].map(([l, v]) => (
          <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
        ))}
      </div>
      <div className="mt-4"><ProgressBar value={task.progress} showLabel /></div>
      <div className="mt-6 border-t border-app pt-4">
        <h4 className="mb-3 text-sm font-semibold">Comments</h4>
        <CommentsPanel projectId={projectId} taskId={task.id} taskTitle={task.title} />
      </div>
    </Modal>
  )
}
