import Modal from '../shared/Modal'
import '../shared/ManageGroupModal.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type ApiStreak,
  type ApiTaskFamily,
  addTaskToFamily,
  fetchAllStreaks,
  fetchTaskFamilies,
  fillMissingStreaksForTask,
  removeTaskFromFamily,
  type TaskGroup,
} from '../../api'
import { type AppEvent, onEvent } from '../../events'
import FamilyPickerModal from './FamilyPickerModal'
import TaskFamilyEditor from './TaskFamilyEditor'

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
  const [allFamilies, setAllFamilies] = useState<ApiTaskFamily[]>([])
  const [editingFamily, setEditingFamily] = useState<ApiTaskFamily | null>(null)
  const [linkingFamilyForTaskId, setLinkingFamilyForTaskId] = useState<
    number | null
  >(null)
  const [confirmingRemoveTaskId, setConfirmingRemoveTaskId] = useState<
    number | null
  >(null)
  const [filter, setFilter] = useState<string>('')
  const [expandedFields, setExpandedFields] = useState<Record<number, boolean>>(
    {},
  )
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const justExpandedIdRef = useRef<number | null>(null)
  const justCollapsedIdRef = useRef<number | null>(null)

  // Focus the right element and move cursor to end when field expands or collapses.
  // expandedFields is the trigger: the new textarea/input is only in the DOM after this state changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expandedFields is used as a DOM-sync trigger, not read directly
  useLayoutEffect(() => {
    const expandedId = justExpandedIdRef.current
    if (expandedId !== null) {
      justExpandedIdRef.current = null
      const textarea = textareaRefs.current[expandedId]
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
    }
    const collapsedId = justCollapsedIdRef.current
    if (collapsedId !== null) {
      justCollapsedIdRef.current = null
      const input = inputRefs.current[collapsedId]
      if (input) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    }
  }, [expandedFields])

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
    setExpandedFields((prev) => {
      const next = { ...prev }
      for (const t of group.tasks) {
        if ((t.defaultExtraInfo || '').includes('\n') && !prev[t.id]) {
          next[t.id] = true
        }
      }
      return next
    })
  }, [group])

  useEffect(() => {
    const load = () => {
      Promise.all([fetchAllStreaks(), fetchTaskFamilies()])
        .then(([streaks, families]) => {
          setAllStreaks(streaks)
          setAllFamilies(families)
        })
        .catch(() => {
          setAllStreaks([])
          setAllFamilies([])
        })
    }

    load()

    const unsub = onEvent((evt: AppEvent) => {
      if (
        evt.type === 'streaks.changed' ||
        evt.type === 'task.families.changed'
      ) {
        load()
      }
    })

    return () => unsub()
  }, [])

  const tasks = useMemo(() => {
    const list = (group?.tasks ?? []).filter((t) => !t.isOneOff)
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

  const handleSave = async (taskId: number, familyId: number | null) => {
    const draft = drafts[taskId]
    if (!draft) return

    setSaving((s) => ({ ...s, [taskId]: true }))
    try {
      const trimmedTask = draft.task.trim()
      if (familyId != null) {
        await onSaveTask(taskId, { task: trimmedTask })
      } else {
        const trimmedExtra = draft.defaultExtraInfo.trim()
        await onSaveTask(taskId, {
          task: trimmedTask,
          defaultExtraInfo: trimmedExtra === '' ? null : trimmedExtra,
          streakId: draft.streakId,
        })
      }
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
                  {expandedFields[t.id] ? (
                    <textarea
                      ref={(el) => {
                        textareaRefs.current[t.id] = el
                      }}
                      value={drafts[t.id]?.defaultExtraInfo ?? ''}
                      onChange={(e) => {
                        handleChange(t.id, 'defaultExtraInfo', e.target.value)
                        if (!e.target.value.includes('\n')) {
                          justCollapsedIdRef.current = t.id
                          setExpandedFields((s) => ({ ...s, [t.id]: false }))
                        }
                      }}
                      placeholder="One item per line (press Enter to add more)"
                      className="streak-name-input"
                      style={{
                        minHeight: 60,
                        resize: 'vertical',
                        width: '100%',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                      }}
                      disabled={t.familyId != null}
                    />
                  ) : (
                    <input
                      ref={(el) => {
                        inputRefs.current[t.id] = el
                      }}
                      type="text"
                      value={drafts[t.id]?.defaultExtraInfo ?? ''}
                      onChange={(e) => {
                        handleChange(t.id, 'defaultExtraInfo', e.target.value)
                        if (e.target.value.includes('\n')) {
                          justExpandedIdRef.current = t.id
                          setExpandedFields((s) => ({ ...s, [t.id]: true }))
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          justExpandedIdRef.current = t.id
                          setExpandedFields((s) => ({ ...s, [t.id]: true }))
                          handleChange(
                            t.id,
                            'defaultExtraInfo',
                            `${drafts[t.id]?.defaultExtraInfo ?? ''}\n`,
                          )
                        }
                      }}
                      placeholder="Default extra info (Enter for multi)"
                      className="streak-name-input"
                      disabled={t.familyId != null}
                    />
                  )}
                </div>
                <div style={{ flex: 2 }}>
                  {t.familyId != null ? (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {confirmingRemoveTaskId === t.id ? (
                        <>
                          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                            Remove?
                          </span>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!t.familyId) return
                              try {
                                await removeTaskFromFamily(t.familyId, t.id)
                              } catch (err) {
                                alert((err as Error).message)
                              } finally {
                                setConfirmingRemoveTaskId(null)
                              }
                            }}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setConfirmingRemoveTaskId(null)}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            title={
                              allFamilies.find((f) => f.id === t.familyId)
                                ?.name ?? 'Unknown family'
                            }
                            onClick={() =>
                              setEditingFamily(
                                allFamilies.find((f) => f.id === t.familyId) ??
                                  null,
                              )
                            }
                            style={{
                              flex: 1,
                              minWidth: 0,
                              textAlign: 'left',
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            ↗{' '}
                            {allFamilies.find((f) => f.id === t.familyId)
                              ?.name ?? 'Unknown family'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            title="Remove from family"
                            onClick={() => setConfirmingRemoveTaskId(t.id)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <select
                      value={drafts[t.id]?.streakId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '__link_family__') {
                          setLinkingFamilyForTaskId(t.id)
                          return
                        }
                        handleStreakChange(
                          t.id,
                          val === '' ? null : Number(val),
                        )
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
                      <option value="__link_family__">Link to family...</option>
                    </select>
                  )}
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
                    onClick={() => handleSave(t.id, t.familyId ?? null)}
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
      {editingFamily && (
        <TaskFamilyEditor
          family={editingFamily}
          allStreaks={allStreaks}
          memberNames={(group?.tasks ?? [])
            .filter((t) => t.familyId === editingFamily.id)
            .map((t) => t.task)}
          onClose={() => setEditingFamily(null)}
          onSaved={(updated) => {
            setAllFamilies((prev) =>
              prev.map((f) => (f.id === updated.id ? updated : f)),
            )
            setEditingFamily(null)
          }}
          onDeleted={() => {
            setAllFamilies((prev) =>
              prev.filter((f) => f.id !== editingFamily.id),
            )
            setEditingFamily(null)
          }}
        />
      )}
      {linkingFamilyForTaskId != null &&
        (() => {
          const t = (group?.tasks ?? []).find(
            (x) => x.id === linkingFamilyForTaskId,
          )
          if (!t) return null
          return (
            <FamilyPickerModal
              taskId={t.id}
              taskName={t.task}
              currentExtraInfo={drafts[t.id]?.defaultExtraInfo?.trim() || null}
              currentStreakId={drafts[t.id]?.streakId ?? null}
              allFamilies={allFamilies}
              onPicked={async (familyId) => {
                await addTaskToFamily(familyId, t.id)
                setLinkingFamilyForTaskId(null)
              }}
              onCreated={(family) => {
                setAllFamilies((prev) => [...prev, family])
                setLinkingFamilyForTaskId(null)
              }}
              onClose={() => setLinkingFamilyForTaskId(null)}
            />
          )
        })()}
    </>
  )
}
