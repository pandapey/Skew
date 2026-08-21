import { FiAlertTriangle } from 'react-icons/fi'
import { Modal } from './Modal'
import { Button } from './Button'

// Confirmation dialog for destructive actions.
export function ConfirmDialog({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = true, loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-danger/10 text-danger">
          <FiAlertTriangle />
        </div>
        <p className="text-sm text-muted">{message || 'This action cannot be undone.'}</p>
      </div>
    </Modal>
  )
}
