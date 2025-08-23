import { useEffect, useRef } from 'react'
import Modal from './Modal'

interface ConfirmModalProps {
  isOpen: boolean
  title?: string
  message?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
  maxWidth?: string
}

export default function ConfirmModal({
  isOpen,
  title = 'Confirm',
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  maxWidth = '480px',
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      // Focus the cancel button when the modal opens to avoid leaving focus
      // on the element that triggered the modal (e.g., a delete button).
      // Use setTimeout 0 to ensure the element is mounted.
      const id = window.setTimeout(() => {
        cancelBtnRef.current?.focus()
      }, 0)
      return () => window.clearTimeout(id)
    }
    return
  }, [isOpen])

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} maxWidth={maxWidth}>
      <div>
        <div style={{ marginBottom: 12 }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
