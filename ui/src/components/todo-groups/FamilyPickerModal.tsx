import { useState } from 'react'
import {
  type ApiFamilyFill,
  type ApiTaskFamily,
  createTaskFamily,
  previewCreateTaskFamily,
} from '../../api'
import Modal from '../shared/Modal'
import LinkAndFillConfirmModal from './LinkAndFillConfirmModal'

interface FamilyPickerModalProps {
  taskId: number
  taskName: string
  currentExtraInfo: string | null
  currentStreakId: number | null
  allFamilies: ApiTaskFamily[]
  onPicked: (familyId: number) => Promise<void>
  onCreated: (family: ApiTaskFamily) => void
  onClose: () => void
}

export default function FamilyPickerModal({
  taskId,
  taskName,
  currentExtraInfo,
  currentStreakId,
  allFamilies,
  onPicked,
  onCreated,
  onClose,
}: FamilyPickerModalProps) {
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingFills, setPendingFills] = useState<ApiFamilyFill[] | null>(null)

  const handlePickExisting = async (family: ApiTaskFamily) => {
    setSaving(true)
    try {
      await onPicked(family.id)
      onClose()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const performCreate = async (withFill: boolean) => {
    setSaving(true)
    try {
      const { family } = await createTaskFamily({
        name: newName.trim(),
        namePattern: newPattern.trim() || null,
        defaultExtraInfo: currentExtraInfo,
        streakId: currentStreakId,
        taskId,
        withFill,
      })
      onCreated(family)
      onClose()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
      setPendingFills(null)
    }
  }

  const handleCreateNew = async () => {
    if (!newName.trim()) return
    if (currentStreakId == null) {
      await performCreate(false)
      return
    }
    setSaving(true)
    try {
      const fills = await previewCreateTaskFamily({
        taskId,
        streakId: currentStreakId,
      })
      if (fills.length === 0) {
        await performCreate(false)
      } else {
        setPendingFills(fills)
        setSaving(false)
      }
    } catch (err) {
      alert((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Link "${taskName}" to family`}
      maxWidth="420px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {allFamilies.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              Existing families
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allFamilies.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="btn btn-secondary"
                  style={{ textAlign: 'left' }}
                  onClick={() => handlePickExisting(f)}
                  disabled={saving}
                >
                  {f.name}
                  {f.namePattern && (
                    <span
                      style={{
                        marginLeft: 8,
                        opacity: 0.6,
                        fontSize: 12,
                      }}
                    >
                      ({f.namePattern})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!creatingNew ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreatingNew(true)}
          >
            + New family...
          </button>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: '1px solid #eee',
              paddingTop: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500 }}>New family</div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Family name"
              className="streak-name-input"
              style={{ width: '100%' }}
              // biome-ignore lint/a11y/noAutofocus: intentional focus on modal open
              autoFocus
              spellCheck={false}
            />
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="Name pattern (optional, e.g. improve *)"
              className="streak-name-input"
              style={{ width: '100%' }}
              spellCheck={false}
            />
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Will use this task's current extra info and streak as the family's
              values.
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setCreatingNew(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateNew}
                disabled={saving || !newName.trim()}
              >
                {saving ? 'Creating...' : 'Create & link'}
              </button>
            </div>
          </div>
        )}
      </div>
      {pendingFills && (
        <LinkAndFillConfirmModal
          isOpen={true}
          title={`Create "${newName.trim()}" and link "${taskName}"`}
          fills={pendingFills}
          onCancel={() => setPendingFills(null)}
          onLinkOnly={() => performCreate(false)}
          onLinkAndFill={() => performCreate(true)}
        />
      )}
    </Modal>
  )
}
