import Modal from './Modal'
import './ManageGroupModal.css'
import { useEffect, useMemo, useState } from 'react'
import { type ApiStreak, fetchAllStreaks, type TaskGroup } from '../api'

interface ManageTasksModalProps {
  isOpen: boolean
  onClose: () => void
  group: TaskGroup | null
  onSaveTask: (
    taskId: number,
    fields: {
      task?: string
      defaultExtraInfo?: string | null
      streakId?: number | null
    },
  ) => Promise<void>
}

export default function ManageTasksModal({
  isOpen,
  onClose,
  group,
  onSaveTask,
}: ManageTasksModalProps) {
  type TaskDraft = {
    task: string
    defaultExtraInfo: string
    streakId: number | null
  }
  type TaskDrafts = Record<number, TaskDraft>

  const [drafts, setDrafts] = useState<TaskDrafts>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [allStreaks, setAllStreaks] = useState<ApiStreak[]>([])

  useEffect(() => {
    if (!group) return
    setDrafts((prev) => {
      const next: TaskDrafts = {}
      for (const t of group.tasks) {
        const existing = prev[t.id]
        next[t.id] = {
          task: existing?.task ?? t.task,
          defaultExtraInfo:
            existing?.defaultExtraInfo ?? (t.defaultExtraInfo || ''),
          streakId: existing?.streakId ?? t.streakId ?? null,
        }
      }
      return next
    })
  }, [group])

  useEffect(() => {
    fetchAllStreaks()
      .then(setAllStreaks)
      .catch(() => setAllStreaks([]))
  }, [])

  const tasks = useMemo(() => {
    const list = group?.tasks ?? []
    // Client-side alphabetical order by task name (case-insensitive)
    return [...list].sort((a, b) =>
      a.task.localeCompare(b.task, undefined, { sensitivity: 'base' }),
    )
  }, [group])

  if (!group) return null

  const updateDraft = (taskId: number, patch: Partial<TaskDraft>) => {
    setDrafts((d) => ({ ...d, [taskId]: { ...d[taskId], ...patch } }))
  }

  const handleChange = (
    taskId: number,
    key: 'task' | 'defaultExtraInfo',
    value: string,
  ) => updateDraft(taskId, { [key]: value } as Partial<TaskDraft>)

  const handleStreakChange = (taskId: number, streakId: number | null) =>
    updateDraft(taskId, { streakId })

  const handleSave = async (taskId: number) => {
    const draft = drafts[taskId]
    if (!draft) return

    setSaving((s) => ({ ...s, [taskId]: true }))
    try {
      const trimmedTask = draft.task.trim()
      const trimmedExtra = draft.defaultExtraInfo.trim()
      await onSaveTask(taskId, {
        task: trimmedTask,
        defaultExtraInfo: trimmedExtra === '' ? null : trimmedExtra,
        streakId: draft.streakId,
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
              <div style={{ flex: 2 }}>
                <select
                  value={drafts[t.id]?.streakId ?? ''}
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? null : Number(e.target.value)
                    handleStreakChange(t.id, val)
                  }}
                  className="streak-name-input"
                  style={{ width: '100%' }}
                >
                  <option value="">No streak linked</option>
                  {allStreaks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
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
