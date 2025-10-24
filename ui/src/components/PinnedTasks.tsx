import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import Downshift from 'downshift'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function CopyButton({
  getText,
  title = 'Copy',
  className = '',
  style = {},
}: {
  getText: () => string
  title?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    const text = getText()
    if (navigator?.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 500)
        })
        .catch(() => {
          alert('Failed to copy to clipboard')
        })
    } else {
      alert('Clipboard API not available')
    }
  }, [getText])
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={handleCopy}
      title={title}
      disabled={copied}
    >
      {copied ? 'Copied!' : title}
    </button>
  )
}

import {
  addTaskToPinGroup,
  createPinGroup,
  deletePinGroup,
  fetchGroupTasks,
  removeTaskFromPinGroup,
  renamePinGroup,
  reorderPinGroups,
  reorderPinGroupTasks,
  type TaskGroup,
} from '../api'
import './PinnedTasks.css'
import confirmAsync from './confirmAsync'
import { parseTaskWithExtraInfo } from './TodoGroupTable'
import { formatTaskWithExtraInfo } from '../helpers'

type PinTask = {
  id: number
  taskId: number
  task: string
  extraInfo?: string | null
  sortOrder: number
}
type PinGroup = {
  id: number
  name: string
  sortOrder: number
  tasks: PinTask[]
}

interface Props {
  parentGroupId: number
  groupData: TaskGroup | null
  onRefresh: (updated: TaskGroup) => void
}

export default function PinnedTasks({
  parentGroupId,
  groupData,
  onRefresh,
}: Props) {
  const [creatingName, setCreatingName] = useState('')
  const [addingTaskInput, setAddingTaskInput] = useState<
    Record<number, string>
  >({})

  const availableTasks = useMemo(() => {
    if (!groupData) return []
    return groupData.tasks.map((t) => ({
      id: t.id,
      task: t.task,
      defaultExtraInfo: t.defaultExtraInfo || null,
    }))
  }, [groupData])

  // Only show pin tasks that still exist in availableTasks
  const availableTaskIds = useMemo(
    () => new Set(availableTasks.map((t) => t.id)),
    [availableTasks],
  )
  const pinGroups: PinGroup[] = useMemo(() => {
    if (!groupData?.pins) return []
    return groupData.pins.map((pg) => ({
      ...pg,
      tasks: pg.tasks.filter((t) => availableTaskIds.has(t.taskId)),
    }))
  }, [groupData, availableTaskIds])

  const refresh = useCallback(async () => {
    const updated = await fetchGroupTasks(parentGroupId)
    if (updated) onRefresh(updated)
  }, [parentGroupId, onRefresh])

  const handleCreatePinGroup = useCallback(async () => {
    if (!creatingName.trim()) return
    await createPinGroup(parentGroupId, creatingName.trim())
    setCreatingName('')
    await refresh()
  }, [creatingName, parentGroupId, refresh])

  const handleRenamePinGroup = useCallback(
    async (pinGroupId: number, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await renamePinGroup(pinGroupId, trimmed)
      await refresh()
    },
    [refresh],
  )

  const handleDeletePinGroup = useCallback(
    async (pinGroupId: number) => {
      const ok = await confirmAsync('Delete this pin group?')
      if (!ok) return
      await deletePinGroup(pinGroupId)
      await refresh()
    },
    [refresh],
  )

  const handleAddTask = useCallback(
    async (pinGroupId: number, inputValue: string) => {
      const trimmed = inputValue.trim()
      if (!trimmed) return

      // Parse task name and extraInfo from input (e.g., "task name (extra info)")
      const { task: taskName, extraInfo } = parseTaskWithExtraInfo(trimmed)

      const existing = availableTasks.find(
        (t) => t.task.toLowerCase() === taskName.toLowerCase(),
      )
      if (!existing) {
        alert('Create task first in the group above, then pin it here.')
        return
      }

      await addTaskToPinGroup(pinGroupId, existing.id, extraInfo || null)
      setAddingTaskInput((s) => ({ ...s, [pinGroupId]: '' }))
      await refresh()
    },
    [availableTasks, refresh],
  )

  const handleRemoveTask = useCallback(
    async (pinGroupId: number, pinId: number) => {
      await removeTaskFromPinGroup(pinGroupId, pinId)
      await refresh()
    },
    [refresh],
  )

  const DraggablePinItem = ({
    pinGroupId,
    item,
    items,
  }: {
    pinGroupId: number
    item: PinTask
    items: PinTask[]
  }) => {
    const ref = useRef<HTMLDivElement>(null)
    const [dragging, setDragging] = useState(false)
    const [over, setOver] = useState(false)

    useEffect(() => {
      const el = ref.current
      if (!el) return
      return combine(
        draggable({
          element: el,
          getInitialData: () => ({
            type: 'pin-item',
            pinId: item.id,
            taskId: item.taskId,
            sortOrder: item.sortOrder,
            pinGroupId,
            // Use pin-specific extraInfo if available, otherwise fall back to task default
            task: item.task,
            extraInfo: item.extraInfo ?? undefined,
          }),
          onDragStart: () => setDragging(true),
          onDrop: () => setDragging(false),
        }),
        dropTargetForElements({
          element: el,
          canDrop: ({ source }) =>
            source.data.type === 'pin-item' &&
            source.data.pinGroupId === pinGroupId &&
            source.data.pinId !== item.id,
          onDragEnter: () => setOver(true),
          onDragLeave: () => setOver(false),
          onDrop: async ({ source }) => {
            setOver(false)
            const sourcePinId = source.data.pinId as number
            if (sourcePinId === item.id) return
            const arr = [...items]
            const sIdx = arr.findIndex((t) => t.id === sourcePinId)
            const tIdx = arr.findIndex((t) => t.id === item.id)
            if (sIdx === -1 || tIdx === -1) return
            const [moved] = arr.splice(sIdx, 1)
            arr.splice(tIdx, 0, moved)
            const payload = arr.map((t, i) => ({
              pinId: t.id,
              sortOrder: i,
            }))
            await reorderPinGroupTasks(pinGroupId, payload)
            await refresh()
          },
        }),
      )
    }, [item, pinGroupId, items])

    return (
      <div
        ref={ref}
        className={`pin-task ${dragging ? 'dragging' : ''} ${over ? 'drag-over' : ''}`}
      >
        <span className="pin-task-text">
          {formatTaskWithExtraInfo(item.task, item.extraInfo || undefined).text}
        </span>
        <CopyButton
          className="pin-group-btn"
          style={{ padding: '0 4px', fontSize: 12 }}
          title="Copy"
          getText={() =>
            JSON.stringify(
              [
                {
                  taskId: item.taskId,
                  task: item.task,
                  sortOrder: item.sortOrder,
                  extraInfo: item.extraInfo ?? null,
                },
              ],
              null,
              2,
            )
          }
        />
        <button
          className="pin-remove"
          type="button"
          onClick={() => handleRemoveTask(pinGroupId, item.id)}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="pinned-section">
      {/* Pin group list with drag-reorder */}
      {pinGroups.map((pg, idx) => (
        <PinGroupRow
          key={pg.id}
          group={pg}
          index={idx}
          onRename={handleRenamePinGroup}
          onDelete={handleDeletePinGroup}
          onReorder={async (from, to) => {
            if (from === to) return
            const arr = [...pinGroups]
            const [moved] = arr.splice(from, 1)
            arr.splice(to, 0, moved)
            const payload = arr.map((g, i) => ({
              pinGroupId: g.id,
              sortOrder: i,
            }))
            await reorderPinGroups(parentGroupId, payload)
            await refresh()
          }}
        >
          <div className="pin-items">
            {pg.tasks.map((it) => (
              <DraggablePinItem
                key={`${pg.id}-${it.id}`}
                pinGroupId={pg.id}
                item={it}
                items={pg.tasks}
              />
            ))}
          </div>
          <Downshift<{ id: number; task: string }>
            inputValue={addingTaskInput[pg.id] || ''}
            onInputValueChange={(v) =>
              setAddingTaskInput((s) => ({ ...s, [pg.id]: v }))
            }
            onSelect={(selected: { id: number; task: string } | null) => {
              const text = selected
                ? selected.task
                : addingTaskInput[pg.id] || ''
              handleAddTask(pg.id, text)
            }}
            selectedItem={null}
            itemToString={(item) => (item ? item.task : '')}
          >
            {({
              getInputProps,
              getItemProps,
              getMenuProps,
              isOpen,
              highlightedIndex,
            }) => (
              <div className="pin-input-wrap">
                <input
                  {...getInputProps({
                    placeholder: 'Add task to this pinned group…',
                    className: 'pin-input',
                    // Prevent double firing: if a Downshift item is highlighted, let Downshift's
                    // own Enter handling trigger onSelect. Only manually add when there's no
                    // highlighted suggestion (free text enter case).
                    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') {
                        const hasHighlighted =
                          isOpen &&
                          highlightedIndex != null &&
                          highlightedIndex > -1
                        if (hasHighlighted) {
                          // Let Downshift handle selecting the highlighted item.
                          return
                        }
                        e.preventDefault()
                        handleAddTask(pg.id, addingTaskInput[pg.id] || '')
                      }
                    },
                    spellCheck: false,
                  })}
                />
                <ul {...getMenuProps()} className="pin-menu">
                  {isOpen &&
                    (addingTaskInput[pg.id] || '').trim() !== '' &&
                    availableTasks
                      // Filter by the query
                      .filter((t) =>
                        t.task
                          .toLowerCase()
                          .includes(
                            (addingTaskInput[pg.id] || '').toLowerCase(),
                          ),
                      )
                      .map((t, index) => (
                        <li
                          key={t.id}
                          {...getItemProps({
                            item: t as { id: number; task: string },
                            index,
                          })}
                          className={
                            highlightedIndex === index ? 'highlighted' : ''
                          }
                        >
                          {t.task}
                          {t.defaultExtraInfo &&
                            t.defaultExtraInfo.trim() !== '' && (
                              <> ({t.defaultExtraInfo})</>
                            )}
                        </li>
                      ))}
                </ul>
              </div>
            )}
          </Downshift>
        </PinGroupRow>
      ))}

      <div className="pin-create">
        <input
          type="text"
          value={creatingName}
          placeholder="New pinned group name…"
          onChange={(e) => setCreatingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreatePinGroup()
          }}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCreatePinGroup}
        >
          Add pinned group
        </button>
      </div>
    </div>
  )
}

function PinGroupRow({
  group,
  index,
  onRename,
  onDelete,
  onReorder,
  children,
}: {
  group: PinGroup
  index: number
  onRename: (pinGroupId: number, name: string) => Promise<void>
  onDelete: (pinGroupId: number) => Promise<void>
  onReorder: (fromIndex: number, toIndex: number) => Promise<void>
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(group.name)
  const [dragOver, setDragOver] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(
        `Streaks-&-Todo_PinGroupCollapsed_${group.id}`,
      )
      return stored ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(
        `Streaks-&-Todo_PinGroupCollapsed_${group.id}`,
        JSON.stringify(isCollapsed),
      )
    } catch {
      // ignore
    }
  }, [isCollapsed, group.id])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: 'pin-group', id: group.id, index }),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === 'pin-group' && source.data.id !== group.id,
        onDragEnter: () => setDragOver(true),
        onDragLeave: () => setDragOver(false),
        onDrop: async ({ source }) => {
          setDragOver(false)
          if (source.data.type !== 'pin-group') return
          const from = source.data.index as number
          const to = index
          await onReorder(from, to)
        },
      }),
    )
  }, [group.id, index, onReorder])

  useEffect(() => {
    setName(group.name)
  }, [group.name])

  return (
    <div
      ref={ref}
      className={`pin-group pin-group-row ${dragOver ? 'drag-over' : ''}`}
    >
      <div className="pin-group-header">
        <button
          type="button"
          className="pin-group-collapse"
          onClick={() => setIsCollapsed((c: boolean) => !c)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <input
          className="pin-group-title"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setName(group.name)
              e.currentTarget.blur()
            }
          }}
          onBlur={async () => {
            const trimmed = name.trim()
            if (!trimmed) {
              setName(group.name)
              return
            }
            if (trimmed !== group.name) {
              try {
                await onRename(group.id, trimmed)
              } catch (err) {
                alert((err as Error).message)
                setName(group.name)
              }
            }
          }}
          spellCheck={false}
        />
        <div className="pin-group-actions">
          <CopyButton
            className="pin-group-btn"
            title="Copy"
            getText={() =>
              JSON.stringify(
                group.tasks.map((t) => ({
                  taskId: t.taskId,
                  task: t.task,
                  sortOrder: t.sortOrder,
                  extraInfo: t.extraInfo ?? null,
                })),
                null,
                2,
              )
            }
          />
          <button
            className="pin-group-btn"
            type="button"
            onClick={() => onDelete(group.id)}
          >
            Delete
          </button>
        </div>
      </div>
      {!isCollapsed && children}
    </div>
  )
}
