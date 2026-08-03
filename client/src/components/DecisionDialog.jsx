import { useEffect, useRef, useState } from 'react'
import { FiCheck, FiX } from 'react-icons/fi'
import { Modal, Button, Textarea } from '@/components/ui'

// Shared mandatory-comment dialog used wherever an approve/reject decision is
// recorded (leave approvals — Part 2, and project task review — Part 8).
//
// The comment is REQUIRED: the confirm button stays disabled until non-empty
// text is entered. The server enforces the same rule with a 422, so the
// requirement cannot be bypassed by calling the API directly.
export function DecisionDialog({
  open,
  action,            // 'approve' | 'reject'
  title,
  subject,           // short line describing what is being decided
  suggestions = [],  // optional one-click comment presets
  busy,
  onClose,
  onConfirm,
}) {
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (open) { setComment(''); setTouched(false) }
  }, [open, action])

  // Move focus into the comment box so keyboard and screen-reader users land
  // on the required field immediately.
  useEffect(() => {
    if (open) { const t = setTimeout(() => ref.current?.focus(), 50); return () => clearTimeout(t) }
  }, [open])

  const isReject = action === 'reject'
  const trimmed = comment.trim()
  const invalid = trimmed.length === 0

  const confirm = () => {
    setTouched(true)
    if (invalid) return
    onConfirm(trimmed)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || (isReject ? 'Reject Request' : 'Approve Request')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={isReject ? 'danger' : 'success'}
            icon={isReject ? FiX : FiCheck}
            loading={busy}
            disabled={invalid}
            onClick={confirm}
          >
            {isReject ? 'Confirm Reject' : 'Confirm Approve'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {subject && (
          <div className="rounded-xl border border-app bg-primary/5 p-3">
            <p className="text-sm">{subject}</p>
          </div>
        )}

        <div>
          <Textarea
            ref={ref}
            // Phase 5 (Task 8): the field is a "Reason" when rejecting and a
            // "Comment" when approving, matching the wording the brief asks
            // employees to see on the decision record. Same component, same
            // required validation, same payload field — label only.
            label={isReject ? 'Reason' : 'Comment'}
            required
            aria-required="true"
            aria-invalid={touched && invalid}
            placeholder={isReject ? 'Explain why this is being rejected…' : 'Add a note for the employee…'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && invalid ? 'A comment is required' : undefined}
          />
          <p className="mt-1 text-xs text-muted">This comment is stored with the decision and shown to the employee.</p>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setComment(s)}
                className="rounded-full border border-app px-3 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
