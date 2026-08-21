import { useEffect, useMemo, useState } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Select, StatCard, Badge, Tabs, ProgressBar,
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
  const isAdmin = hasRole(ROLES.ADMIN)
  const [vs, patchVs, , setVs] = useViewState('leave-view', { tab: isAdmin ? 'approvals' : 'mine', search: '', status: '', page: 1, limit: 8 })
  const tab = canApprove ? vs.tab : 'mine'
  const setTab = (v) => patchVs({ tab: v, page: 1 })
  const params = { search: vs.search, status: vs.status, page: vs.page, limit: vs.limit }
  const setParams = (next) => setVs((s) => ({ ...s, ...(typeof next === 'function' ? next({ search: s.search, status: s.status, page: s.page, limit: s.limit }) : next) }))
  const [applyOpen, setApplyOpen] = useState(false)
  const [hourlyOpen, setHourlyOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkId = searchParams.get('request')
  const { data: deepLinkedRequest, isError: deepLinkError } = useQuery({
    queryKey: ['leave-request', deepLinkId],
    queryFn: () => leaveApi.get(deepLinkId),
    enabled: Boolean(deepLinkId),
  })
  useEffect(() => {
    if (deepLinkedRequest) setDetail(deepLinkedRequest)
  }, [deepLinkedRequest])
  useEffect(() => {
    if (!deepLinkError) return
    toast.error('That leave request is not available to you.')
    setSearchParams((p) => { p.delete('request'); return p }, { replace: true })
  }, [deepLinkError, setSearchParams])
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
  const { data: hourlyBalance } = useQuery({
    queryKey: ['leave-hourly-balance'],
    queryFn: () => leaveApi.hourlyBalance(),
    enabled: !isAdmin,
  })

  const { data: myAll } = useQuery({
    queryKey: ['leave-mine-all'],
    queryFn: () => leaveApi.myRequests({ limit: 1000 }),
    enabled: !isAdmin,
  })
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
    qc.invalidateQueries({ queryKey: ['leave-hourly-balance'] })
  }

  const applyMut = useMutation({
    mutationFn: (values) => leaveApi.apply({ ...values, employee: user?.name, department: user?.department, empCode: user?.empCode }),
    onSuccess: (_r, values) => {
      toast.success('Leave request submitted')
      setApplyOpen(false)
      invalidate()
      notify({
        type: 'leave',
        title: 'Leave request submitted',
        body: `${user?.name || 'You'} requested ${values?.type || 'leave'}${values?.days ? ` (${values.days} day${values.days > 1 ? 's' : ''})` : ''} — awaiting approval.`,
        sender: user?.name,
        link: '/attendance/leave',
        priority: 'normal',
      })
    },
    onError: () => toast.error('Could not submit request'),
  })

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
        link: '/attendance/leave',
        priority: 'normal',
      })
    },
    onError: (err) => toast.error(
      err?.response?.data?.message || err?.message || 'Could not submit request'
    ),
  })

  const decisionMut = useMutation({
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
        link: '/attendance/leave',
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

  const deptMax = useMemo(
    () => Math.max(1, ...((stats?.byDepartment || []).map((d) => d.value || 0))),
    [stats],
  )

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

      {!isAdmin && <div className="mb-4"><BalanceCards balances={balances} /></div>}

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
        onClose={() => {
          setDetail(null)
          if (deepLinkId) setSearchParams((p) => { p.delete('request'); return p }, { replace: true })
        }}
        canApprove={canApprove && isApprovals}
        busy={decisionMut.isPending}
        onApprove={(r) => setDecision({ action: 'approve', request: r })}
        onReject={(r) => setDecision({ action: 'reject', request: r })}
      />

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
