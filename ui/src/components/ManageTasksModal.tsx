import type { TaskGroup } from '../api'
import Modal from './Modal'
import './ManageGroupModal.css'
import { useEffect, useMemo, useState } from 'react'

interface ManageTasksModalProps {
  isOpen: boolean
  onClose: () => void
  group: TaskGroup | null
  onSaveTask: (
    taskId: number,
    fields: { task?: string; defaultExtraInfo?: string | null },
  ) => Promise<void>
}

export default function ManageTasksModal({
  isOpen,
  onClose,
  group,
  onSaveTask,
}: ManageTasksModalProps) {
  const [drafts, setDrafts] = useState<
    Record<number, { task: string; defaultExtraInfo: string }>
  >({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!group) return
    const init: Record<number, { task: string; defaultExtraInfo: string }> = {}
    for (const t of group.tasks) {
      init[t.id] = { task: t.task, defaultExtraInfo: t.defaultExtraInfo || '' }
    }
    setDrafts(init)
  }, [group])

  const tasks = useMemo(() => {
    const list = group?.tasks ?? []
    // Client-side alphabetical order by task name (case-insensitive)
    return [...list].sort((a, b) =>
      a.task.localeCompare(b.task, undefined, { sensitivity: 'base' }),
    )
  }, [group])

  if (!group) return null

  const handleChange = (
    taskId: number,
    key: 'task' | 'defaultExtraInfo',
    value: string,
  ) => {
    setDrafts((d) => ({ ...d, [taskId]: { ...d[taskId], [key]: value } }))
  }

  const handleSave = async (taskId: number) => {
    const draft = drafts[taskId]
    if (!draft) return

    setSaving((s) => ({ ...s, [taskId]: true }))
    try {
      await onSaveTask(taskId, {
        task: draft.task.trim(),
        defaultExtraInfo:
          draft.defaultExtraInfo.trim() === ''
            ? null
            : draft.defaultExtraInfo.trim(),
      })
    } finally {
      setSaving((s) => ({ ...s, [taskId]: false }))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Manage Tasks: ${group.name}`}
      maxWidth="700px"
    >
      <div className="manage-section">
        <h3>Tasks in this group</h3>
        <div className="streak-list">
          {tasks.map((t) => (
            <div key={t.id} className="streak-item">
              <div className="streak-name" style={{ flex: 2 }}>
                <input
                  type="text"
                  value={drafts[t.id]?.task ?? ''}
                  onChange={(e) => handleChange(t.id, 'task', e.target.value)}
                  placeholder="Task name"
                  className="streak-name-input"
                />
              </div>
              <div style={{ flex: 2 }}>
                <input
                  type="text"
                  value={drafts[t.id]?.defaultExtraInfo ?? ''}
                  onChange={(e) =>
                    handleChange(t.id, 'defaultExtraInfo', e.target.value)
                  }
                  placeholder="Default extra info (optional)"
                  className="streak-name-input"
                />
              </div>
              <div className="streak-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleSave(t.id)}
                  disabled={
                    saving[t.id] ||
                    !drafts[t.id] ||
                    drafts[t.id].task.trim() === ''
                  }
                >
                  {saving[t.id] ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ))}
          {tasks.length === 0 && (
            <p className="no-streaks">No tasks in this group</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
