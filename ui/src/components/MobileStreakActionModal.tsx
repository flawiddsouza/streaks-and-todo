import dayjs from 'dayjs'
import type { Dispatch, SetStateAction } from 'react'
import type { MobileModalState } from '../hooks/useMobileStreakInteraction'
import Modal from './Modal'

interface MobileStreakActionModalProps {
  state: MobileModalState
  noteDraft: string
  setNoteDraft: Dispatch<SetStateAction<string>>
  error: string | null
  saving: boolean
  onClose: () => void
  onConfirm: () => void
  onRemove: () => void
}

export default function MobileStreakActionModal({
  state,
  noteDraft,
  setNoteDraft,
  error,
  saving,
  onClose,
  onConfirm,
  onRemove,
}: MobileStreakActionModalProps) {
  if (!state.isOpen) return null

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={state.done ? 'Update streak entry' : 'Mark streak done'}
      maxWidth="420px"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 'bold' }}>{state.streakName}</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted, #555)' }}>
            {dayjs(state.date).format('dddd, DD-MMM-YY')}
          </div>
        </div>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span>Note (optional)</span>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={saving}
            style={{ resize: 'vertical' }}
          />
        </label>
        {error && (
          <div style={{ color: '#c7372f', fontSize: '0.9rem' }}>{error}</div>
        )}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          {state.done && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onRemove}
              disabled={saving}
              style={{ marginRight: 'auto' }}
            >
              Remove mark
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={saving}
          >
            {state.done ? 'Save' : 'Mark done'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
