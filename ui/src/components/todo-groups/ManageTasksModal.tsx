import Modal from '../shared/Modal'
import '../shared/ManageGroupModal.css'
import { useEffect, useMemo, useState } from 'react'
import {
  type ApiStreak,
  fetchAllStreaks,
  fillMissingStreaksForTask,
  type TaskGroup,
} from '../../api'

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
  const [filling, setFilling] = useState<Record<number, boolean>>({})
  const [fillResult, setFillResult] = useState<{
    taskId: number
    items: { date: string; task: string }[]
  } | null>(null)
  const [allStreaks, setAllStreaks] = useState<ApiStreak[]>([])
  const [filter, setFilter] = useState<string>('')

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
    const normalizedFilter = filter.trim().toLowerCase()
    const filtered = normalizedFilter
      ? list.filter((t) => {
          const name = (t.task || '').toLowerCase()
          const extra = (t.defaultExtraInfo || '').toLowerCase()
          return (
            name.includes(normalizedFilter) || extra.includes(normalizedFilter)
          )
        })
      : list

    // Client-side alphabetical order by task name (case-insensitive)
    return [...filtered].sort((a, b) =>
      a.task.localeCompare(b.task, undefined, { sensitivity: 'base' }),
    )
  }, [group, filter])

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
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Manage Tasks: ${group.name}`}
        maxWidth="700px"
      >
        <div className="manage-section">
          <h3>Tasks in this group</h3>
          <div style={{ marginBottom: 8 }}>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tasks by name or extra info..."
              className="streak-name-input"
              style={{ width: '100%' }}
              spellCheck="false"
            />
          </div>
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
                  {t.streakId != null && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginRight: 8 }}
                      onClick={async () => {
                        try {
                          setFilling((s) => ({ ...s, [t.id]: true }))
                          const added = await fillMissingStreaksForTask(t.id)
                          setFillResult({ taskId: t.id, items: added })
                        } catch (err) {
                          alert((err as Error).message)
                        } finally {
                          setFilling((s) => ({ ...s, [t.id]: false }))
                        }
                      }}
                      disabled={filling[t.id]}
                    >
                      {filling[t.id] ? 'Filling...' : 'Fill'}
                    </button>
                  )}
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
      {fillResult && (
        <Modal
          isOpen={true}
          onClose={() => setFillResult(null)}
          title={`Added streak entries for task #${fillResult?.taskId ?? ''}`}
        >
          <div>
            {fillResult?.items?.length === 0 ? (
              <p>No missing streak entries were needed.</p>
            ) : (
              <div>
                <p>Added the following dates:</p>
                <ul>
                  {fillResult?.items?.map((it) => (
                    <li key={it.date}>{`${it.date} — ${it.task}`}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setFillResult(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
