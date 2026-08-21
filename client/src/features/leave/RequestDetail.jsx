import { FiCheck, FiClock, FiX, FiFileText, FiMessageSquare } from 'react-icons/fi'
import { Modal, Badge, Button } from '@/components/ui'
import { LEAVE_STATUS_TONE, formatDays } from './constants'
import { formatDate } from '@/utils'

const STAGE_ICON = { Applied: FiFileText, 'Manager Review': FiClock, Approved: FiCheck, Rejected: FiX, Cancelled: FiX }

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(value)} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function RequestDetail({ request, open, onClose, canApprove, onApprove, onReject, busy }) {
  if (!request) return null
  const isPending = request.status === 'Pending'
  const decision = request.decision

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Leave Request"
      size="lg"
      footer={
        canApprove && isPending ? (
          <>
            <Button variant="danger" icon={FiX} loading={busy} onClick={() => onReject(request)}>Reject</Button>
            <Button variant="success" icon={FiCheck} loading={busy} onClick={() => onApprove(request)}>Approve</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        )
      }
    >
      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Employee', request.employee], ['Type', request.type],
          ['Duration', request.halfDay
            ? `${formatDays(request.days)} (${request.halfDaySession || 'Half Day'})`
            : formatDays(request.days)],
          ['Status', <Badge key="s" tone={LEAVE_STATUS_TONE[request.status]}>{request.status}</Badge>],
          ['From', formatDate(request.from)], ['To', formatDate(request.to)],
          ['Department', request.department], ['Applied', formatDate(request.appliedAt)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>

      {request.sundaysExcluded > 0 && (
        <div className="mb-5 rounded-xl border border-app bg-primary/5 p-3 text-sm">
          {request.sundaysExcluded} Sunday{request.sundaysExcluded > 1 ? 's' : ''} within this range
          {' '}were treated as company holidays and not deducted from the balance.
        </div>
      )}

      <div className="mb-5 rounded-xl border border-app p-3">
        <p className="text-xs text-muted">Reason</p>
        <p className="text-sm">{request.reason}</p>
      </div>

      {decision?.comment && (
        <div
          className={`mb-5 rounded-xl border p-3 ${decision.action === 'Approved' ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'}`}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <FiMessageSquare aria-hidden="true" />
              {decision.action} Comment
            </p>
            <span className="text-xs text-muted">{formatDateTime(decision.at)}</span>
          </div>
          <p className="text-sm">{decision.comment}</p>
          <p className="mt-1 text-xs text-muted">by {decision.by}</p>
        </div>
      )}

      {/* Approval workflow timeline */}
      <h4 className="mb-3 text-sm font-semibold">Approval Workflow</h4>
      <div className="relative space-y-4 border-l-2 border-app pl-5">
        {(request.workflow || []).map((step, i) => {
          const Icon = STAGE_ICON[step.stage] || FiClock
          const tone = step.stage === 'Approved' ? 'text-success' : step.stage === 'Rejected' ? 'text-danger' : 'text-primary'
          return (
            <div key={i} className="relative">
              <span className={`absolute -left-[27px] flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] ring-2 ring-app ${tone}`}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{step.stage}</p>
                <span className="text-xs text-muted">{formatDateTime(step.at)}</span>
              </div>
              <p className="text-xs text-muted">{step.note} · by {step.by}</p>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
