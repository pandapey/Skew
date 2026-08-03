import { useMemo, useState } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  FiPlus, FiCheck, FiX, FiClock, FiCalendar, FiInbox, FiBarChart2, FiGift, FiEye, FiWatch,
  FiAlertCircle,
} from 'react-icons/fi'
import { leaveApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { useNotifications } from '@/features/notifications/NotificationContext'
import {
  PageHeader, Card, CardHeader, Button, DataTable, Pagination, SearchInput,
  Select, StatCard, Badge, Tabs, Loader, ProgressBar,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { ApplyLeaveModal } from '@/features/leave/ApplyLeaveModal'
import { ApplyHourlyPermissionModal } from '@/features/leave/ApplyHourlyPermissionModal'
import { BalanceCards } from '@/features/leave/BalanceCards'
import { RequestDetail } from '@/features/leave/RequestDetail'
import { DecisionDialog } from '@/components/DecisionDialog'
import { LEAVE_STATUS, LEAVE_STATUS_TONE, LEAVE_APPROVE_ROLES, formatHours } from '@/features/leave/constants'
import { useDebounce } from '@/hooks/useDebounce'
import { formatDate } from '@/utils'

// Phase 5.1 (Task 3): one-click comment presets, mirroring the Task Review
// workflow this dialog is modelled on. Local to the page like TaskReview's own
// presets — they are page copy, not shared business logic.
const APPROVE_PRESETS = ['Approved.', 'Approved due to medical emergency.', 'Approved. Please submit documents.']
const REJECT_PRESETS = ['Rejected because insufficient leave balance.', 'Rejected because project deadline.']

const exportCols = [
  { header: 'Employee', accessor: 'employee' }, { header: 'Type', accessor: 'type' },
  { header: 'From', accessor: 'from' }, { header: 'To', accessor: 'to' },
  { header: 'Days', accessor: 'days' }, { header: 'Status', accessor: 'status' },
]

export default function Leave() {
  const { user, hasRole } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { notify } = useNotifications()
  const canApprove = hasRole(LEAVE_APPROVE_ROLES)
  // Phase 5.7 (Task 6): Admin does not request leave — it approves and
  // monitors. Apply Leave, My Leave, Leave Balance and the personal leave
  // history are removed for Admin only; every other role is untouched. The
  // approval workflow itself is SHARED, not duplicated: Admin reuses the exact
  // same decisionMut / DecisionDialog / RequestDetail path below.
  const isAdmin = hasRole(ROLES.ADMIN)

  // Phase 5.7 (Task 7): persist active tab + table filters so Back restores them.
  const [vs, patchVs, , setVs] = useViewState('leave-view', { tab: isAdmin ? 'approvals' : 'mine', search: '', status: '', page: 1, limit: 8 })
  // Phase 6.9 (Task 19) ROOT CAUSE FIX: "Insufficient Permission" on the
  // Employee Leave page was NOT a Route Guard, Sidebar, Permission Matrix,
  // authorize(), or Role Mapping defect - all of those correctly admit
  // Employees to /leave and its personal endpoints (/leave/me, /leave/
  // balances, /leave/holidays, /leave/apply). The real defect was a
  // QUERY/API MISMATCH: useViewState (hooks/useViewState.js) persists the
  // active tab in sessionStorage keyed ONLY by pathname, not by user or role.
  // If an approver (Admin/HR/Manager) had the Approvals tab selected in this
  // browser tab/session and a different user then authenticates as an
  // Employee (shared machine, or a role change without a hard reload), `vs.
  // tab` resurrects as 'approvals' for a role that cannot approve. The page
  // then queried leaveApi.query() -> GET /leave/requests, which the backend's
  // authorize('Admin','HR','Manager') correctly rejects with 403 "Forbidden:
  // insufficient permissions" - RBAC was enforcing the rule correctly, but
  // the frontend was resolving a stale/foreign tab value into a request the
  // current role was never meant to make, and surfacing the resulting 403 as
  // a hard error on a page the employee otherwise has every right to use.
  // Fix: clamp the EFFECTIVE tab to one the current role can actually use;
  // employees can never resolve to 'approvals' regardless of what is
  // persisted, so they can only ever query their own requests. HR/Manager/
  // Admin (canApprove === true) are completely unaffected.
  const tab = canApprove ? vs.tab : 'mine'
  const setTab = (v) => patchVs({ tab: v, page: 1 })
  const params = { search: vs.search, status: vs.status, page: vs.page, limit: vs.limit }
  const setParams = (next) => setVs((s) => ({ ...s, ...(typeof next === 'function' ? next({ search: s.search, status: s.status, page: s.page, limit: s.limit }) : next) }))
  const [applyOpen, setApplyOpen] = useState(false)
  // Phase 5.5 (Task 4): hourly permission apply modal.
  const [hourlyOpen, setHourlyOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  // Phase 5.1 (Tasks 2 & 3): holds the pending decision while the mandatory
  // comment is collected: { action: 'approve' | 'reject', request }.
  const [decision, setDecision] = useState(null)
  const debounced = useDebounce(params.search)

  const isApprovals = tab === 'approvals'
  const queryParams = { ...params, search: debounced }

  const { data, isLoading } = useQuery({
    queryKey: [isApprovals ? 'leave-all' : 'leave-mine', queryParams],
    queryFn: () => (isApprovals ? leaveApi.query(queryParams) : leaveApi.myRequests(queryParams)),
    placeholderData: keepPreviousData,
  })
  const { data: balances = [] } = useQuery({ queryKey: ['leave-balances'], queryFn: leaveApi.balances, enabled: !isAdmin })
  const { data: stats } = useQuery({ queryKey: ['leave-stats'], queryFn: leaveApi.stats, enabled: canApprove })
  const { data: holidays = [] } = useQuery({ queryKey: ['leave-holidays'], queryFn: leaveApi.holidays })
  // Phase 5.5 (Task 4): the monthly permission allowance is DERIVED server-side
  // from the requests themselves, so this is always the authoritative figure
  // rather than a client-side tally that could drift.
  const { data: hourlyBalance } = useQuery({
    queryKey: ['leave-hourly-balance'],
    queryFn: () => leaveApi.hourlyBalance(),
    enabled: !isAdmin,
  })

  // Employee-specific counts derived from the authenticated user's OWN requests
  // (leaveApi.myRequests -> /leave/me, scoped to req.user). Approvers keep the
  // org-wide leaveApi.stats view (#9, #15).
  // Phase 6.12 (TASK 4): `enabled` widened from `!canApprove` to `!isAdmin`.
  // This SAME query now also feeds the inline overlapping-dates check inside
  // <ApplyLeaveModal/>, and the Apply Leave button is shown to every non-Admin
  // role - so an HR/Manager applying for their OWN leave needs the list too,
  // otherwise they would still receive the server 422 as a toast. It is a
  // self-scoped read (leaveApi.myRequests -> GET /leave/me, scoped to req.user),
  // so no additional data is exposed to anyone.
  const { data: myAll } = useQuery({
    queryKey: ['leave-mine-all'],
    queryFn: () => leaveApi.myRequests({ limit: 1000 }),
    enabled: !isAdmin,
  })
  // The employee's own requests, reused as-is for the inline overlap check.
  const myRequests = myAll?.data ?? []
  const myStats = useMemo(() => {
    const list = myRequests
    const count = (s) => list.filter((r) => r.status === s).length
    return {
      total: list.length,
      pending: count('Pending'),
      approved: count('Approved'),
      rejected: count('Rejected'),
      cancelled: count('Cancelled'),
    }
  }, [myAll])

  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['leave-all'] })
    qc.invalidateQueries({ queryKey: ['leave-mine'] })
    qc.invalidateQueries({ queryKey: ['leave-balances'] })
    qc.invalidateQueries({ queryKey: ['leave-stats'] })
    // Approving/rejecting/cancelling an hourly permission changes the derived
    // monthly allowance, so it has to be refetched alongside the day balances.
    qc.invalidateQueries({ queryKey: ['leave-hourly-balance'] })
  }

  const applyMut = useMutation({
    mutationFn: (values) => leaveApi.apply({ ...values, employee: user?.name, department: user?.department, empCode: user?.empCode }),
    onSuccess: (_r, values) => {
      toast.success('Leave request submitted')
      setApplyOpen(false)
      invalidate()
      // Real notification: a leave request now awaits approval.
      notify({
        type: 'leave',
        title: 'Leave request submitted',
        body: `${user?.name || 'You'} requested ${values?.type || 'leave'}${values?.days ? ` (${values.days} day${values.days > 1 ? 's' : ''})` : ''} — awaiting approval.`,
        sender: user?.name,
        link: '/leave',
        priority: 'normal',
      })
    },
    onError: () => toast.error('Could not submit request'),
  })

  // Phase 5.5 (Task 4): posts to /leave/hourly-permission. Kept separate from
  // applyMut because the payload and success copy differ, but it reuses the
  // SAME invalidate() and notification helpers.
  const applyHourlyMut = useMutation({
    mutationFn: (values) => leaveApi.applyHourly(values),
    onSuccess: (_r, values) => {
      toast.success('Hourly permission request submitted')
      setHourlyOpen(false)
      invalidate()
      notify({
        type: 'leave',
        title: 'Hourly permission requested',
        body: `${user?.name || 'You'} requested ${values.hours}h of permission on ${values.date} \u2014 awaiting approval.`,
        sender: user?.name,
        link: '/leave',
        priority: 'normal',
      })
    },
    // Surface the server's real message (allowance exhausted, attendance
    // already recorded, etc.) instead of a generic failure string.
    onError: (err) => toast.error(
      err?.response?.data?.message || err?.message || 'Could not submit request'
    ),
  })

  const decisionMut = useMutation({
    // Phase 5.1 (Task 2) ROOT CAUSE FIX: this previously called
    // leaveApi.approve(id) / reject(id) with NO comment argument. The API
    // signature is (id, comment), so the request body serialised to {} and the
    // service's mandatory-comment rule (Phase 4, enforced at the service layer)
    // correctly answered 422 — which surfaced as "Action failed". The comment is
    // now collected by DecisionDialog and passed through, so the validation is
    // SATISFIED rather than bypassed.
    mutationFn: ({ id, action, comment }) => (
      action === 'approve' ? leaveApi.approve(id, comment) : leaveApi.reject(id, comment)
    ),
    onSuccess: (_r, v) => {
      // Notification-style feedback (email-ready on backend).
      toast.success(v.action === 'approve' ? 'Leave approved — employee notified' : 'Leave rejected — employee notified')
      // Real notification for the affected employee.
      notify({
        type: 'leave',
        title: v.action === 'approve' ? 'Leave approved' : 'Leave rejected',
        body: v.employee
          ? `${v.employee}'s leave request was ${v.action === 'approve' ? 'approved' : 'rejected'}.`
          : `A leave request was ${v.action === 'approve' ? 'approved' : 'rejected'}.`,
        sender: user?.name,
        link: '/leave',
        priority: 'normal',
      })
      setDetail(null); setDecision(null); invalidate()
    },
    // Surface the server's actual message (e.g. an expired request, or an
    // insufficient balance) instead of a generic string that hides the reason.
    onError: (err) => toast.error(
      err?.response?.data?.message || err?.message || 'Action failed'
    ),
  })

  const cancelMut = useMutation({
    mutationFn: (id) => leaveApi.cancel(id),
    onSuccess: () => { toast.success('Request cancelled'); invalidate() },
  })

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const columns = [
    ...(isApprovals ? [{ key: 'employee', header: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.department}</p></div> }] : []),
    { key: 'type', header: 'Type', render: (r) => <Badge tone="accent">{r.typeCode || r.type}</Badge> },
    { key: 'from', header: 'From', render: (r) => formatDate(r.from) },
    { key: 'to', header: 'To', render: (r) => formatDate(r.to) },
    // Phase 5.5 (Task 4): hourly permissions are stored with days: 0, so a raw
    // "Days" figure would read as 0 and look like a bug. Render the request's
    // actual duration in its own unit instead.
    { key: 'days', header: 'Duration', render: (r) => (
      r.requestKind === 'Hourly Permission'
        ? formatHours(r.hours)
        : `${r.days} day${r.days === 1 ? '' : 's'}`
    ) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={LEAVE_STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: '_actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button className="rounded-lg p-2 hover:bg-accent/10 hover:text-accent" onClick={() => setDetail(r)} aria-label="View"><FiEye /></button>
        {canApprove && isApprovals && r.status === 'Pending' && (
          <>
            <button className="rounded-lg p-2 text-success hover:bg-success/10" onClick={() => setDecision({ action: 'approve', request: r })} aria-label="Approve"><FiCheck /></button>
            <button className="rounded-lg p-2 text-danger hover:bg-danger/10" onClick={() => setDecision({ action: 'reject', request: r })} aria-label="Reject"><FiX /></button>
          </>
        )}
        {!isApprovals && r.status === 'Pending' && (
          <button className="rounded-lg p-2 text-danger hover:bg-danger/10" onClick={() => cancelMut.mutate(r.id)} aria-label="Cancel">Cancel</button>
        )}
      </div>
    ) },
  ]

  // Phase 5.7 (Task 6): largest department total, used to scale the department
  // summary bars. Guarded with `|| 1` so an empty/zero dataset cannot divide by
  // zero and render NaN%.
  const deptMax = useMemo(
    () => Math.max(1, ...((stats?.byDepartment || []).map((d) => d.value || 0))),
    [stats],
  )

  // Phase 5.7 (Task 6): no "My Requests" tab for Admin — the table IS the
  // approval queue.
  //
  // Phase 6.21 (TASK 3) ROOT CAUSE - the stray "My Requests" control left of
  // the Employee's search box:
  //   This list is a TAB SWITCHER between the user's own requests and the
  //   approval queue. An Employee cannot approve anything, so `canApprove` is
  //   false and the second entry is never pushed - leaving a one-item tab bar
  //   whose only tab is already the permanently active view. It could not
  //   switch to anything and did nothing when clicked; it was pure decoration
  //   occupying the left of the filter row.
  //   The fix is therefore at the cause: a switcher is only rendered when
  //   there is something to switch BETWEEN (see `showTabs` at the filter row).
  //   Nothing about the data path changes - `tab` is still forced to 'mine'
  //   for non-approvers further up, so the same ['leave-mine'] query, the same
  //   leaveApi.myRequests call and the same backend routes are used. Approver
  //   roles keep the full two-tab bar exactly as before.
  const tabs = isAdmin ? [] : [{ key: 'mine', label: 'My Requests' }]
  if (canApprove) tabs.push({ key: 'approvals', label: `${isAdmin ? 'Approval Queue' : 'Approvals'}${stats?.pending ? ` (${stats.pending})` : ''}` })
  const showTabs = tabs.length > 1

  return (
    <div>
      <PageHeader
        title="Leave Management"
        subtitle={isAdmin
          ? 'Approve requests and monitor organization-wide leave.'
          : 'Apply for leave, track approvals and manage balances.'}
        actions={
          <>
            {canApprove && <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate('/leave/reports')}>Reports</Button>}
            {canApprove && <Button variant="ghost" icon={FiCalendar} onClick={() => navigate('/leave/types')}>Leave Types</Button>}
            {!canApprove && <Button variant="ghost" icon={FiBarChart2} onClick={() => navigate('/leave/my-report')}>Report</Button>}
            {!isAdmin && <Button variant="ghost" icon={FiWatch} onClick={() => setHourlyOpen(true)}>Hourly Permission</Button>}
            {!isAdmin && <Button icon={FiPlus} onClick={() => setApplyOpen(true)}>Apply Leave</Button>}
          </>
        }
      />

      {/* Balances — personal entitlement, so hidden for Admin (Task 6). */}
      {!isAdmin && <div className="mb-4"><BalanceCards balances={balances} /></div>}

      {/*
        Phase 5.5 (Task 4): monthly hourly-permission allowance. Rendered
        beside the day balances because an employee thinks of it as just
        another entitlement, even though it is tracked in hours and derived
        rather than stored.
      */}
      {!isAdmin && hourlyBalance && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FiWatch className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Hourly Permission</p>
                <p className="text-xs text-muted">Resets monthly · no carry forward · {hourlyBalance.month}</p>
              </div>
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-xs text-muted">Allowance</p>
                <p className="text-lg font-semibold">{formatHours(hourlyBalance.allowance)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted">Used</p>
                <p className="text-lg font-semibold text-warning">{formatHours(hourlyBalance.used)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted">Remaining</p>
                <p className={`text-lg font-semibold ${hourlyBalance.remaining > 0 ? 'text-success' : 'text-danger'}`}>
                  {formatHours(hourlyBalance.remaining)}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs — Admin: approval-centric (Task 6); approvers: org-wide; employees: self-only */}
      {isAdmin ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Pending Approvals" value={stats?.pending ?? '—'} icon={FiClock} tone="warning" />
            <StatCard label="Approved Today" value={stats?.todayApproved ?? '—'} icon={FiCheck} tone="success" />
            <StatCard label="Rejected Today" value={stats?.todayRejected ?? '—'} icon={FiX} tone="danger" />
            <StatCard label="Expired Requests" value={stats?.expired ?? '—'} icon={FiAlertCircle} tone="accent" />
            <StatCard label="On Leave Today" value={stats?.onLeaveToday ?? '—'} icon={FiCalendar} />
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Department summary — approved leave days per department */}
            <Card>
              <CardHeader title="Department Summary" subtitle="Approved leave days by department" />
              <div className="space-y-3">
                {(stats?.byDepartment || []).map((d) => (
                  <div key={d.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{d.name || 'Unassigned'}</span>
                      <span className="text-xs text-muted">{d.value} days</span>
                    </div>
                    <ProgressBar value={Math.round((d.value / deptMax) * 100)} />
                  </div>
                ))}
                {!(stats?.byDepartment || []).length && (
                  <p className="text-sm text-muted">No approved leave recorded yet.</p>
                )}
              </div>
            </Card>

            {/* Analytics — status split, type mix and 6-month trend */}
            <Card>
              <CardHeader title="Leave Analytics" subtitle="Status split, leave-type mix and recent trend" />
              <div className="mb-3 flex flex-wrap gap-2">
                {(stats?.byStatus || []).map((s) => (
                  <Badge key={s.name} tone={LEAVE_STATUS_TONE[s.name]}>{s.name}: {s.value}</Badge>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {(stats?.byType || []).map((t) => (
                  <Badge key={t.name} tone="primary">{t.name}: {t.value}</Badge>
                ))}
              </div>
              <div className="space-y-2">
                {(stats?.monthlyTrend || []).map((m) => (
                  <div key={m.month} className="flex items-center justify-between rounded-xl border border-app p-2.5 text-sm">
                    <span className="font-medium">{m.month}</span>
                    <span className="text-xs text-muted">
                      <span className="text-success">{m.approved ?? 0} approved</span>
                      {' · '}
                      <span className="text-danger">{m.rejected ?? 0} rejected</span>
                    </span>
                  </div>
                ))}
                {!(stats?.monthlyTrend || []).length && (
                  <p className="text-sm text-muted">Not enough history for a trend yet.</p>
                )}
              </div>
            </Card>
          </div>
        </>
      ) : canApprove ? (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Requests" value={stats?.total ?? '—'} icon={FiInbox} />
          <StatCard label="Pending" value={stats?.pending ?? '—'} icon={FiClock} tone="warning" />
          <StatCard label="Approved" value={stats?.approved ?? '—'} icon={FiCheck} tone="success" />
          <StatCard label="Rejected" value={stats?.rejected ?? '—'} icon={FiX} tone="danger" />
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="My Requests" value={myStats.total} icon={FiInbox} />
          <StatCard label="Pending" value={myStats.pending} icon={FiClock} tone="warning" />
          <StatCard label="Approved" value={myStats.approved} icon={FiCheck} tone="success" />
          <StatCard label="Rejected" value={myStats.rejected} icon={FiX} tone="danger" />
          <StatCard label="Cancelled" value={myStats.cancelled} icon={FiX} tone="accent" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              {showTabs && (
                <Tabs items={tabs} value={tab} onChange={(t) => { setTab(t); setParams((p) => ({ ...p, page: 1 })) }} />
              )}
              {/* `flex-1` already makes this group absorb the freed space, so
                  the search/filter/export row simply fills the width instead of
                  leaving a gap where the switcher used to be. */}
              <div className="flex flex-1 gap-2 sm:justify-end">
                <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="sm:max-w-[200px]" />
                <Select className="sm:w-36" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
                  options={[{ value: '', label: 'All Status' }, ...LEAVE_STATUS.map((s) => ({ value: s, label: s }))]} />
                <ExportMenu rows={rows} columns={exportCols} filename="leave-requests" title="Leave Requests" />
              </div>
            </div>

            <DataTable columns={columns} data={rows} loading={isLoading} onRowClick={setDetail} empty="No leave requests found" />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{data?.total || 0} requests</p>
              <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
            </div>
          </Card>
        </div>

        {/* Holidays */}
        <Card>
          <CardHeader title="Holiday Calendar" action={<FiGift className="text-muted" />} />
          <div className="space-y-2">
            {holidays.slice(0, 7).map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border border-app p-2.5">
                <div><p className="text-sm font-medium">{h.name}</p><p className="text-xs text-muted">{formatDate(h.date)} · {h.day}</p></div>
                <Badge tone="primary">{h.type}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Apply flows are not mounted at all for Admin (Task 6). */}
      {/* Phase 6.9 (TASK 2): `holidays` is the SAME ['leave-holidays'] query the
          page already loads for the holiday list below - it is now also handed
          to the form so Company Holiday breaches are shown inline instead of as
          a server-error toast. No extra fetch, no new endpoint. */}
      {/* Phase 6.12 (TASK 4): `myRequests` is the SAME ['leave-mine-all'] query
          this page already runs - it is passed down so the overlapping-dates
          rule can be reported inline instead of arriving as a toast from the
          server's 422. No new query, no new endpoint. */}
      {!isAdmin && <ApplyLeaveModal open={applyOpen} onClose={() => setApplyOpen(false)} onSubmit={(v) => applyMut.mutate(v)} balances={balances} holidays={holidays} myRequests={myRequests} loading={applyMut.isPending} />}

      {!isAdmin && <ApplyHourlyPermissionModal
        open={hourlyOpen}
        onClose={() => setHourlyOpen(false)}
        onSubmit={(values) => applyHourlyMut.mutate(values)}
        balance={hourlyBalance}
        loading={applyHourlyMut.isPending}
      />}

      <RequestDetail
        request={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        canApprove={canApprove && isApprovals}
        busy={decisionMut.isPending}
        onApprove={(r) => setDecision({ action: 'approve', request: r })}
        onReject={(r) => setDecision({ action: 'reject', request: r })}
      />

      {/*
        Phase 5.1 (Task 3): mandatory approve/reject comment, using the SAME
        shared DecisionDialog as the project Task Review workflow rather than a
        second bespoke modal. The summary lists Employee, Leave Type, Dates,
        Days and Reason so the approver has the full context in front of them.
        Only <span> elements are used inside the summary because DecisionDialog
        renders `subject` inside a <p>, where block elements would be invalid.
      */}
      <DecisionDialog
        open={!!decision}
        action={decision?.action}
        title={decision?.action === 'reject' ? 'Reject Leave Request' : 'Approve Leave Request'}
        subject={decision?.request ? (
          <span className="block space-y-1">
            <span className="block"><span className="text-muted">Employee:</span> <strong>{decision.request.employee}</strong></span>
            <span className="block"><span className="text-muted">Leave Type:</span> {decision.request.type}</span>
            <span className="block">
              <span className="text-muted">Dates:</span> {formatDate(decision.request.from)}
              {decision.request.from !== decision.request.to ? ` ${'\u2192'} ${formatDate(decision.request.to)}` : ''}
              {decision.request.halfDay ? ` (${decision.request.halfDaySession})` : ''}
            </span>
            <span className="block"><span className="text-muted">Days:</span> {decision.request.days}</span>
            <span className="block"><span className="text-muted">Reason:</span> {decision.request.reason || '\u2014'}</span>
          </span>
        ) : ''}
        suggestions={decision?.action === 'reject' ? REJECT_PRESETS : APPROVE_PRESETS}
        busy={decisionMut.isPending}
        onClose={() => setDecision(null)}
        onConfirm={(comment) => decisionMut.mutate({
          id: decision.request.id,
          action: decision.action,
          comment,
          employee: decision.request.employee,
        })}
      />
    </div>
  )
}
