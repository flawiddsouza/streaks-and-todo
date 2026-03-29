import { useState } from 'react'
import {
  type ApiStreak,
  type ApiTaskFamily,
  deleteTaskFamily,
  updateTaskFamily,
} from '../../api'
import Modal from '../shared/Modal'

interface TaskFamilyEditorProps {
  family: ApiTaskFamily
  allStreaks: ApiStreak[]
  memberNames: string[]
  onClose: () => void
  onSaved: (updated: ApiTaskFamily) => void
  onDeleted: () => void
}

export default function TaskFamilyEditor({
  family,
  allStreaks,
  memberNames,
  onClose,
  onSaved,
  onDeleted,
}: TaskFamilyEditorProps) {
  const [name, setName] = useState(family.name)
  const [namePattern, setNamePattern] = useState(family.namePattern ?? '')
  const [defaultExtraInfo, setDefaultExtraInfo] = useState(
    family.defaultExtraInfo ?? '',
  )
  const [streakId, setStreakId] = useState<number | null>(family.streakId)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const updated = await updateTaskFamily(family.id, {
        name: name.trim(),
        namePattern: namePattern.trim() || null,
        defaultExtraInfo: defaultExtraInfo.trim() || null,
        streakId,
      })
      onSaved(updated)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteTaskFamily(family.id)
      onDeleted()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Family" maxWidth="480px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          Family name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="streak-name-input"
            style={{ width: '100%', marginTop: 4 }}
            spellCheck={false}
          />
        </label>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          Name pattern (optional, use * as wildcard — e.g.{' '}
          <code>improve *</code>)
          <input
            type="text"
            value={namePattern}
            onChange={(e) => setNamePattern(e.target.value)}
            className="streak-name-input"
            style={{ width: '100%', marginTop: 4 }}
            placeholder="improve *"
            spellCheck={false}
          />
        </label>

        {memberNames.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              Members
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {memberNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        <label style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          Default extra info (propagates to all members on save)
          <textarea
            value={defaultExtraInfo}
            onChange={(e) => setDefaultExtraInfo(e.target.value)}
            className="streak-name-input"
            style={{
              width: '100%',
              minHeight: 60,
              resize: 'vertical',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              marginTop: 4,
            }}
            placeholder="One item per line"
            spellCheck={false}
          />
        </label>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          Streak link (propagates to all members on save)
          <select
            value={streakId ?? ''}
            onChange={(e) =>
              setStreakId(e.target.value === '' ? null : Number(e.target.value))
            }
            className="streak-name-input"
            style={{ width: '100%', marginTop: 4 }}
          >
            <option value="">No streak linked</option>
            {allStreaks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          {confirmingDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>Delete family?</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmingDelete(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete family
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
