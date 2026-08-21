import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiCheckCircle, FiClock, FiCircle } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { cn } from '@/utils'
import { PageHeader, Card, CardHeader, Badge, ProgressBar, Avatar, Loader, EmptyState, Button } from '@/components/ui'
// Phase 6.11 (TASK 2): fmtDateTime dropped. It was imported here but never
// called - the Activity tab removed below used fmtDate, not fmtDateTime - so it
// was a dead import even before this phase.
import { PROJECT_STATUS_TONE, fmtDate, TIMELINE_STAGES, stageState, stageTone } from './constants'
import ProjectCommunication from './ProjectCommunication'
import ProjectProgressDashboard from './ProjectProgressDashboard'
import ProjectTaskHistory from './ProjectTaskHistory'
// Phase 6.3 (Task 5): the SAME panel the Documents page renders.
import ProjectDocuments from './ProjectDocuments'

// Phase 5.8 (Task 5): 'Task History' inserted right after 'Timeline', per the
// task spec ("Inside Timeline add another tab"). 'Discussion' now renders the
// SAME shared ProjectCommunication component used by the Messages page - one
// comment UI, no duplication.
//
// Phase 6.10 (TASK 2) - MERGE PROJECT DETAILS.
// ROOT CAUSE of the duplication this task removes: the client portal exposed
// the SAME three project views twice. '/client/tasks' (ClientTasks.jsx),
// '/client/timeline' (ClientTimeline.jsx) and '/client/messages'
// (ClientMessages.jsx) were account-wide pages that each began with a "which
// project?" <Select>, while this page already rendered the identical per-project
// views as the 'Tasks', 'Timeline' and 'Discussion' tabs. Two navigation paths,
// one dataset.
//
// FIX: the three requested buttons are the tabs that ALREADY existed here -
// only their labels changed to the names the task asks for. Nothing is
// re-implemented and no view is added twice:
//   'Tasks'      -> 'Task Progress'    (same p.tasks block, same query)
//   'Timeline'   -> 'Project Timeline' (same p.timeline block, same query)
//   'Discussion' -> 'Messages'         (same shared <ProjectCommunication/>)
// The three standalone pages/routes/nav entries are deleted, so each view now
// has exactly ONE implementation reached from exactly ONE place.
//
// Phase 6.11 (TASK 2) - TAB CLEANUP.
// Order is now exactly as specified, and two tabs are removed outright:
//
//   * 'Task Progress' - it listed p.tasks (title / assignee / due / priority /
//     status / completion) which is the SAME per-task data the 'Task History'
//     tab already renders through <ProjectTaskHistory/>, plus the headline
//     percentage shown on Overview. Redundant surface, not unique data.
//   * 'Activity'      - the per-project activity feed. Phase 6.11 TASK 1
//     removes the dashboard's Recent Activity widget for the same reason the
//     client does not need an audit trail; this is the project-level twin.
//
// These were TABS (local `tab` state), never routes, so there is no route or
// lazy import to delete for them - the standalone client pages were already
// retired in Phase 6.10. The two render blocks are deleted below; `p.tasks`
// and `p.activity` remain on the API payload because the server assembles them
// for other consumers (Task History reads tasks; Admin reads activity).
const TABS = ['Overview', 'Task History', 'Documents', 'Team', 'Project Timeline', 'Messages']

export default function ClientProjectDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('Overview')

  const { data: p, isLoading } = useQuery({ queryKey: ['client-project', id], queryFn: () => clientService.getProject(user, id) })

  if (isLoading) return <Loader label="Loading project…" />
  if (!p) return <EmptyState title="Project not found" description="It may have been reassigned." />

  return (
    <div>
      <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/client/projects')} className="mb-3">Back to Projects</Button>
      {/* Phase 6.11 (TASK 2): the header used to print the bare stored code
          (e.g. "CP-F1F2D9") with no indication of what the string was. It is
          now explicitly labelled "Project ID". The VALUE is unchanged and still
          comes straight from the project document - `code` is the human-facing
          identifier stored on ClientProject (clientModels.js), with the stored
          `projectId` key as fallback for older rows created before `code` was
          populated. No identifier is generated, derived or faked here. */}
      <PageHeader
        title={p.name}
        subtitle={`Project ID: ${p.code || p.projectId || '—'} · ${p.projectManager}`}
        actions={<Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>}
      />

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t ? 'bg-primary text-white' : 'bg-black/5 text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Progress" />
            <div className="mb-4 flex items-center gap-4">
              <div className="text-4xl font-bold">{p.progress}%</div>
              <div className="flex-1"><ProgressBar value={p.progress} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-muted">Priority</p><Badge>{p.priority}</Badge></div>
              <div><p className="text-muted">Start</p><p className="font-medium">{fmtDate(p.startDate)}</p></div>
              <div><p className="text-muted">Delivery</p><p className="font-medium">{fmtDate(p.deliveryDate)}</p></div>
              <div><p className="text-muted">Manager</p><p className="font-medium">{p.projectManager}</p></div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Quick facts" />
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted">Status</span><Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge></div>
              {/* Phase 6.9 (TASK 10): Account Manager replaced with the Project
                  Manager already stored on the same client-project mirror, so
                  the client keeps a named point of contact without reviving the
                  retired field. */}
              <div className="flex justify-between"><span className="text-muted">Project Manager</span><span className="font-medium">{p.projectManager || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">Budget</span><span className="font-medium">₹{p.budget?.toLocaleString()}</span></div>
              {/* Phase 6.11 (TASK 6): relabelled "Team size" -> "Team Members".
                  Label only - the value is the same stored p.team array length. */}
              <div className="flex justify-between"><span className="text-muted">Team Members</span><span className="font-medium">{p.team?.length || 0}</span></div>
            </div>
          </Card>
          <div className="lg:col-span-3">
            <ProjectProgressDashboard projectId={id} />
          </div>
        </div>
      )}

      {tab === 'Project Timeline' && (
        <Card>
          <CardHeader title="Project Timeline" subtitle="Six-stage delivery roadmap" />
          <div className="relative space-y-1 pl-2">
            {TIMELINE_STAGES.map((stage, idx) => {
              const st = p.timeline.find((s) => s.name === stage)
              const state = stageState(st?.status)
              return (
                <div key={stage} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={cn('flex h-9 w-9 items-center justify-center rounded-full', state === 'done' ? 'bg-success text-white' : state === 'active' ? 'bg-primary text-white ring-4 ring-primary/15' : 'bg-black/10 text-muted dark:bg-white/10')}>
                      {state === 'done' ? <FiCheckCircle /> : state === 'active' ? <FiClock /> : <FiCircle />}
                    </div>
                    {idx < TIMELINE_STAGES.length - 1 && <div className={cn('w-0.5 flex-1', st && p.timeline[idx + 1]?.status === 'Completed' ? 'bg-success' : 'bg-black/10 dark:bg-white/10')} />}
                  </div>
                  <div className="flex-1 pb-5">
                    <div className="flex items-center justify-between">
                      <p className={cn('font-medium', state === 'todo' && 'text-muted')}>{stage}</p>
                      <Badge tone={stageTone(st?.status)}>{st?.status}</Badge>
                    </div>
                    <p className="text-xs text-muted">{st?.date ? `Completed: ${fmtDate(st.date)}` : 'In progress / scheduled'}</p>
                    {st?.notes && <p className="mt-1 text-sm text-muted">{st.notes}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {tab === 'Task History' && <ProjectTaskHistory projectId={id} />}

      {tab === 'Team' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {p.team?.map((m) => (
            // Phase 6.23 (TASK 2): the server now de-duplicates the team, but the
            // key still includes the role so distinct people sharing a display name
            // remain distinct React nodes rather than silently collapsing.
            <Card key={`${m.name}|${m.roleInProject || ''}`}>
              <div className="flex items-center gap-3">
                <Avatar name={m.name} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.name}</p>
                  <p className="text-xs text-muted">{m.position}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-muted">{m.roleInProject}</span>
                <Badge tone={m.availability === 'Available' ? 'success' : 'warning'}>{m.availability}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{m.department}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Phase 6.11 (TASK 2): the 'Task Progress' and 'Activity' render blocks
          that stood here are REMOVED along with their tabs. Task-level detail
          remains available on the 'Task History' tab (<ProjectTaskHistory/>),
          which reads the SAME ProjectTask collection, so no information the
          client relies on was lost and no component was duplicated to replace
          them. */}

      {/* Phase 6.10 (TASK 2): same shared component, same ['client-project-comments',
          projectId] query and same 'client:project-comment' socket event as
          before - comments, attachments, edit/delete ownership rules and the
          notifications the server raises on a new comment are all untouched. */}
      {tab === 'Messages' && <ProjectCommunication projectId={id} viewerName={user?.name} title="Messages" />}

      {/* Phase 6.3 (TASK 5): this tab used to be a READ-ONLY list (name / type /
          size / uploadedAt / uploadedBy badge) with no upload, download, delete
          or preview - which is exactly why "each Client Project should support
          upload/download/delete/preview" was failing here while the Documents
          page worked. It now renders the SAME shared <ProjectDocuments/> panel,
          so both surfaces have identical capability and there is a single
          implementation to maintain. */}
      {tab === 'Documents' && <ProjectDocuments projectId={id} title="Documents" />}
    </div>
  )
}
