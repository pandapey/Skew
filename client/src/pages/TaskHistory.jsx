import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FiClock, FiFilter, FiRotateCcw, FiMessageSquare, FiChevronDown, FiChevronRight,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import {
  PageHeader, Card, Badge, Select, Input, Button, Loader, EmptyState,
} from '@/components/ui'
import {
  TASK_EVENT_TONE, SUBMISSION_STATUSES, ASSIGNMENT_STATUS_TONE,
  TASK_STATUS_TONE, PRIORITY_TONE,
} from '@/features/projects/constants'
import { useViewState } from '@/hooks/useViewState'

// Phase 5.5 (Task 5): Project Task History.
//
// ONE page serves BOTH required audiences, because they are the same view at a
// different scope and duplicating it would mean two components drifting apart:
//   * Employee            -> "My Task History", their own assigned work
//   * Lead/Manager/Admin/HR -> pick a project, see every task in it
//
// The scope decision is made SERVER-SIDE in projectService.taskHistory() from
// req.user, so this page cannot leak another employee's history even if the
// filters are tampered with in the browser. The "Only my tasks" switch is a
// convenience for privileged users, not a security boundary.

const EMPTY_FILTERS = { project: '', status: '', from: '', to: '', mine: false }

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// One row of the vertical timeline. `from`/`to` are only populated for
// transitions that actually moved the task between people, so the handover
// line is rendered conditionally rather than showing empty arrows.
function TimelineEntry({ entry, last }) {
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />}
      <span className="relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-card bg-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TASK_EVENT_TONE[entry.event] || 'default'}>{entry.event}</Badge>
          <span className="text-sm font-medium">{entry.by}</span>
          <span className="text-xs text-muted">{formatDateTime(entry.at)}</span>
        </div>
        {(entry.from || entry.to) && (
          <p className="mt-1 text-xs text-muted">
            {entry.from ? `${entry.from} \u2192 ` : 'Assigned to '}{entry.to || '\u2014'}
          </p>
        )}
        {entry.comment && (
          <p className="mt-1 rounded-lg bg-muted/10 px-2.5 py-1.5 text-sm">{entry.comment}</p>
        )}
      </div>
    </li>
  )
}

// Phase 5.5 (Task 7): `open` is owned by the PAGE, not by this card, so an
// expanded timeline survives navigating away and coming back. Keeping it in
// local state here would reset every card on remount.
function TaskCard({ task, open, onToggle }) {
  const Chevron = open ? FiChevronDown : FiChevronRight

  // Review and submission comments already live in their own collections; they
  // are shown BESIDE the timeline rather than merged into it so each kind of
  // comment keeps exactly one source of truth.
  const extraComments = [
    ...(task.submissionComments || []).map((c) => ({ ...c, kind: 'Submission' })),
    ...(task.reviewComments || []).map((c) => ({ ...c, kind: `Review \u00b7 ${c.status}` })),
    ...(task.comments || []).map((c) => ({ by: c.by, comment: c.body, at: c.at, kind: c.viaClientPortal ? 'Client' : 'Comment' })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  return (
    <Card className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={open}
      >
        <Chevron className="mt-1 h-4 w-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{task.title}</p>
            <Badge tone={TASK_STATUS_TONE[task.status] || 'default'}>{task.status}</Badge>
            <Badge tone={ASSIGNMENT_STATUS_TONE[task.assignmentStatus] || 'default'}>
              {task.assignmentStatus || 'Assigned'}
            </Badge>
            {task.priority && <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted">
            {task.projectName || 'Unknown project'}
            {task.assignee ? ` \u00b7 ${task.assignee}` : ''}
            {task.dueDate ? ` \u00b7 due ${task.dueDate}` : ''}
            {` \u00b7 ${(task.timeline || []).length} event${(task.timeline || []).length === 1 ? '' : 's'}`}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-4 border-t pt-4">
          {(task.timeline || []).length === 0 ? (
            // Tasks created before Phase 5.5 have no recorded events. Saying so
            // is better than rendering a blank panel that looks broken.
            <p className="text-sm text-muted">
              No timeline events recorded for this task yet.
            </p>
          ) : (
            <ol className="list-none">
              {task.timeline.map((e, i) => (
                <TimelineEntry key={e.id || i} entry={e} last={i === task.timeline.length - 1} />
              ))}
            </ol>
          )}

          {extraComments.length > 0 && (
            <div className="mt-2 border-t pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <FiMessageSquare className="h-3.5 w-3.5" /> Comments
              </p>
              <ul className="space-y-2">
                {extraComments.map((c, i) => (
                  <li key={i} className="rounded-lg bg-muted/10 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.by}</span>
                      <Badge tone="default">{c.kind}</Badge>
                      <span className="text-xs text-muted">{formatDateTime(c.at)}</span>
                    </div>
                    <p className="mt-1 text-sm">{c.comment}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function TaskHistory() {
  // Phase 5.5 (Task 7): filters, search and expanded rows persist per route,
  // so returning to this page restores the same view rather than a reset one.
  // Without this, restoring the scroll position would be meaningless because
  // the underlying list would have changed.
  const [filters, patchFilters, resetFilters] = useViewState('filters', EMPTY_FILTERS)
  const [expanded, patchExpanded] = useViewState('expanded', {})
  const set = (key) => (e) => {
    const value = e?.target?.type === 'checkbox' ? e.target.checked : (e?.target?.value ?? e)
    patchFilters({ [key]: value })
  }

  // Reuses the existing scoped project list, so the dropdown can only ever
  // offer projects the caller is already allowed to see.
  const projectsQuery = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.all(),
  })

  // Empty strings are stripped so the server sees an absent filter rather than
  // an empty one, which would otherwise match nothing.
  const params = useMemo(() => {
    const p = {}
    if (filters.project) p.project = filters.project
    if (filters.status) p.status = filters.status
    if (filters.from) p.from = filters.from
    if (filters.to) p.to = filters.to
    if (filters.mine) p.mine = 'true'
    return p
  }, [filters])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['task-history', params],
    queryFn: () => projectApi.taskHistory(params),
  })

  const rows = Array.isArray(data) ? data : []
  const projectOptions = useMemo(() => ([
    { value: '', label: 'All projects' },
    ...(projectsQuery.data || []).map((p) => ({ value: p.id, label: p.name })),
  ]), [projectsQuery.data])

  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  return (
    <div>
      <PageHeader
        title="Task History"
        subtitle="Complete timeline of every task: assignment, acceptance, submission, review and completion."
        icon={FiClock}
        actions={dirty ? (
          <Button variant="ghost" icon={FiRotateCcw} onClick={resetFilters}>
            Reset filters
          </Button>
        ) : null}
      />

      <Card className="mb-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <FiFilter className="h-3.5 w-3.5" /> Filters
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Project"
            value={filters.project}
            onChange={set('project')}
            options={projectOptions}
            loading={projectsQuery.isLoading}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={set('status')}
            options={[
              { value: '', label: 'All statuses' },
              ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
        </div>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-primary"
            checked={filters.mine}
            onChange={set('mine')}
          />
          Only tasks assigned to me
        </label>
        <p className="mt-2 text-xs text-muted">
          Date filters match when an event happened, not when the task was created, so long-running tasks still appear.
        </p>
      </Card>

      {isLoading ? (
        <Loader />
      ) : isError ? (
        <EmptyState
          title="Could not load task history"
          description={error?.response?.data?.message || error?.message || 'Please try again.'}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No task history found"
          description={dirty
            ? 'No tasks match these filters. Try widening the date range or clearing the project filter.'
            : 'Task events are recorded from Phase 5.5 onward. Assign, submit or review a task to build its timeline.'}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {rows.length} task{rows.length === 1 ? '' : 's'}
          </p>
          {rows.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              open={!!expanded[t.id]}
              onToggle={() => patchExpanded({ [t.id]: !expanded[t.id] })}
            />
          ))}
        </>
      )}
    </div>
  )
}
