import { useEffect, useState } from 'react'
import { FiSend, FiInfo } from 'react-icons/fi'
import { Modal, Button, Textarea, Input } from '@/components/ui'

const PRESETS = ['Completed.', 'Please review.', 'API integrated.', 'Waiting for testing.']

export function TaskSubmitModal({ open, task, onClose, onSubmit, busy }) {
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const [attachName, setAttachName] = useState('')
  const [attachUrl, setAttachUrl] = useState('')

  useEffect(() => {
    if (open) { setComment(''); setTouched(false); setAttachName(''); setAttachUrl('') }
  }, [open])

  const trimmed = comment.trim()
  const invalid = trimmed.length === 0
  // An attachment is optional, but if one is described both parts are needed.
  const attachIncomplete = Boolean(attachName.trim()) !== Boolean(attachUrl.trim())

  const confirm = () => {
    setTouched(true)
    if (invalid || attachIncomplete) return
    onSubmit({
      comment: trimmed,
      attachment: attachName.trim() && attachUrl.trim()
        ? { name: attachName.trim(), url: attachUrl.trim() }
        : undefined,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit Task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={FiSend} loading={busy} disabled={invalid || attachIncomplete} onClick={confirm}>
            Submit for Review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {task && (
          <div className="rounded-xl border border-app bg-primary/5 p-3">
            <p className="text-sm font-medium">{task.title}</p>
            <p className="text-xs text-muted">This will be sent to the project lead who assigned it.</p>
          </div>
        )}

        <div>
          <Textarea
            label="Comment"
            required
            aria-required="true"
            aria-invalid={touched && invalid}
            placeholder="Describe the work you completed…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && invalid ? 'A comment is required' : undefined}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setComment(p)}
                className="rounded-full border border-app px-3 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-app p-3">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold">
            <FiInfo aria-hidden="true" /> Attachment (optional)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="File name" value={attachName} onChange={(e) => setAttachName(e.target.value)} />
            <Input label="File URL" value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} />
          </div>
          {attachIncomplete && (
            <p className="mt-2 text-xs text-danger">Provide both a file name and a URL, or leave both empty.</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Saved to this project&apos;s Files and linked to your submission.
          </p>
        </div>
      </div>
    </Modal>
  )
}
