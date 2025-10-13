import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import dayjs from 'dayjs'
import Downshift, { type StateChangeOptions } from 'downshift'
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { TableVirtuoso, type TableVirtuosoHandle } from 'react-virtuoso'
import {
  createTaskAndLog,
  deleteTaskLogById,
  fetchGroupTasks,
  moveTaskLog,
  setTaskLog,
  type TaskGroup,
  type TaskRecord,
  updateGroupNote,
} from '../api'
import confirmAsync from './confirmAsync'
import './TodoGroupTable.css'
import { formatTaskWithExtraInfo } from '../helpers'

interface TodoGroupTableProps {
  taskData: TaskGroup[]
  loading: boolean
  error: string | null
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
  groupId?: number
  filterQuery?: string
  onFilteredCountChange?: (count: number) => void
}

interface TaskLog {
  taskId: number
  task: string
  extraInfo?: string
  sortOrder: number
  logId: number
}

interface FlatTask {
  id: number
  task: string
  groupName: string
  defaultExtraInfo?: string | null
  records: TaskRecord[]
}

const generateDateRange = (dates: string[]): string[] => {
  const today = dayjs()

  if (dates.length === 0) {
    const dateArray = []
    for (let i = 6; i >= 0; i--) {
      dateArray.push(today.subtract(i, 'day').format('YYYY-MM-DD'))
    }
    return dateArray
  }

  const sortedDates = [...dates].sort()
  const startDate = dayjs(sortedDates[0])
  const endDate = dayjs().isAfter(dayjs(sortedDates[sortedDates.length - 1]))
    ? dayjs()
    : dayjs(sortedDates[sortedDates.length - 1])

  const sevenDaysAgo = today.subtract(6, 'day')
  const actualStartDate = startDate.isBefore(sevenDaysAgo)
    ? startDate
    : sevenDaysAgo

  const allDates: string[] = []
  let iterDate = actualStartDate
  while (iterDate.isBefore(endDate) || iterDate.isSame(endDate)) {
    allDates.push(iterDate.format('YYYY-MM-DD'))
    iterDate = iterDate.add(1, 'day')
  }
  return allDates
}

const updateTaskData = (
  prevData: TaskGroup[],
  groupIndex: number,
  taskIndex: number,
  updater: (
    records: TaskGroup['tasks'][number]['records'],
  ) => TaskGroup['tasks'][number]['records'],
): TaskGroup[] => {
  const newData = [...prevData]
  const targetGroup = { ...newData[groupIndex] }
  const targetTasks = [...targetGroup.tasks]
  const targetTask = { ...targetTasks[taskIndex] }

  targetTask.records = updater(targetTask.records)
  targetTasks[taskIndex] = targetTask
  targetGroup.tasks = targetTasks
  newData[groupIndex] = targetGroup

  return newData
}

const buildTaskLookup = (taskData: TaskGroup[]) => {
  const lookup = new Map<number, { groupIndex: number; taskIndex: number }>()
  taskData.forEach((group, groupIndex) => {
    group.tasks.forEach((task, taskIndex) => {
      lookup.set(task.id, { groupIndex, taskIndex })
    })
  })
  return lookup
}

// getOrCreateTask helper removed; new flow uses createTaskAndLog in one call

export const parseTaskWithExtraInfo = (
  taskText: string,
): { task: string; extraInfo?: string } => {
  const trimmed = taskText.trim()
  if (!trimmed.includes('(')) {
    return { task: trimmed }
  }

  let depth = 0
  let closingIndex = -1

  for (let idx = trimmed.length - 1; idx >= 0; idx -= 1) {
    const char = trimmed[idx]
    if (char === ')') {
      if (closingIndex === -1) {
        closingIndex = idx
      }
      depth += 1
      continue
    }

    if (char === '(' && closingIndex !== -1) {
      depth -= 1
      if (depth === 0) {
        const task = trimmed.slice(0, idx).trim()
        const extraInfo = trimmed.slice(idx + 1, closingIndex).trim()

        if (task) {
          if (extraInfo) {
            return { task, extraInfo }
          }
          return { task }
        }
      }
    }
  }

  if (trimmed.indexOf(')') === -1) {
    const openIndex = trimmed.lastIndexOf('(')
    if (openIndex >= 0) {
      const task = trimmed.slice(0, openIndex).trim()
      const extraInfo = trimmed.slice(openIndex + 1).trim()

      if (task) {
        if (extraInfo) {
          return { task, extraInfo }
        }
        return { task }
      }
    }
  }

  return { task: trimmed }
}

interface DropZoneProps {
  date: string
  targetLogId: number
  position: 'before' | 'after'
  isDoneColumn: boolean
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  onAddFromPin?: (
    date: string,
    targetLogId: number,
    position: 'before' | 'after',
    isDoneColumn: boolean,
    pin: { taskId: number; extraInfo?: string },
  ) => void
}

function DropZone({
  date,
  targetLogId,
  position,
  isDoneColumn,
  onReorder,
  onAddFromPin,
}: DropZoneProps) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const element = dropRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        if (source.data.type === 'task-item') {
          return source.data.logId !== targetLogId
        }
        if (source.data.type === 'pin-item') {
          // Allow dropping pin items anywhere
          return true
        }
        return false
      },
      onDragEnter: () => setIsActive(true),
      onDragLeave: () => setIsActive(false),
      onDrop: ({ source }) => {
        setIsActive(false)
        if (source.data.type === 'task-item') {
          const sourceLogId = source.data.logId as number
          const sourceDate = source.data.sourceDate as string
          onReorder(
            date,
            sourceDate,
            sourceLogId,
            targetLogId,
            position,
            isDoneColumn,
          )
          return
        }
        if (source.data.type === 'pin-item' && onAddFromPin) {
          const taskId = source.data.taskId as number
          const extraInfo =
            (source.data.extraInfo as string | undefined) || undefined
          onAddFromPin(date, targetLogId, position, isDoneColumn, {
            taskId,
            extraInfo,
          })
        }
      },
    })
  }, [date, targetLogId, position, isDoneColumn, onReorder, onAddFromPin])

  return (
    <div
      ref={dropRef}
      className={`drop-zone ${isActive ? 'drop-zone-active' : ''}`}
      data-position={position}
    />
  )
}

interface TaskItemProps {
  taskLog: TaskLog
  date: string
  onToggle: (taskId: number, date: string, logId: number) => void
  onDelete: (logId: number, date: string) => void
  onCopy: (taskLog: TaskLog) => void
  onEdit: (
    taskId: number,
    date: string,
    logId: number,
    currentExtraInfo: string,
  ) => void
  isEditing: boolean
  editValue: string
  onEditChange: (value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  filterQuery?: string
}

function TaskItemComponent({
  taskLog,
  date,
  onToggle,
  onDelete,
  onCopy,
  onEdit,
  isEditing,
  editValue,
  onEditChange,
  onEditSave,
  onEditCancel,
  onReorder,
  filterQuery = '',
}: TaskItemProps) {
  const dragRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  // Helper function to highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text

    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
      'gi',
    )
    const parts = text.split(regex)

    return parts.map((part, index) => {
      if (regex.test(part)) {
        return (
          <mark
            key={`match-${part}-${Date.now()}-${index}`}
            style={{ backgroundColor: '#ffef9c', color: '#000' }}
          >
            {part}
          </mark>
        )
      }
      return <span key={`text-${part}-${Date.now()}-${index}`}>{part}</span>
    })
  }

  useEffect(() => {
    if (isEditing) return
    const element = dragRef.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'task-item',
          taskId: taskLog.taskId,
          logId: taskLog.logId,
          task: taskLog.task,
          extraInfo: taskLog.extraInfo,
          sortOrder: taskLog.sortOrder,
          sourceDate: date,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          return (
            source.data.type === 'task-item' &&
            source.data.logId !== taskLog.logId
          )
        },
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false)
          const sourceLogId = source.data.logId as number
          const sourceDate = source.data.sourceDate as string
          if (sourceLogId === taskLog.logId) return
          onReorder(date, sourceDate, sourceLogId, taskLog.logId, 'before')
        },
      }),
    )
  }, [taskLog, date, onReorder, isEditing])

  if (isEditing) {
    return (
      <div className="todo-item">
        <input
          type="text"
          className="task-edit-input"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onEditSave()
            } else if (e.key === 'Escape') {
              onEditCancel()
            }
          }}
          onBlur={onEditSave}
          placeholder="Extra info (optional)"
          spellCheck={false}
          ref={(input) => input?.focus()}
        />
      </div>
    )
  }

  return (
    <div
      ref={dragRef}
      className={`todo-item ${isDragging ? 'dragging' : ''} ${isDraggedOver ? 'drag-over' : ''}`}
      style={{ cursor: 'grab' }}
    >
      <button
        type="button"
        className="todo-text"
        onClick={() => onToggle(taskLog.taskId, date, taskLog.logId)}
      >
        {(() => {
          const { text } = formatTaskWithExtraInfo(
            taskLog.task,
            taskLog.extraInfo,
          )

          if (filterQuery.trim()) {
            return highlightText(text, filterQuery.trim())
          }

          return text
        })()}
      </button>
      <button
        type="button"
        className="task-action-btn copy-task-btn"
        onClick={(e) => {
          e.stopPropagation()
          onCopy(taskLog)
        }}
        title="Copy task to clipboard"
      >
        📋
      </button>
      <button
        type="button"
        className="task-action-btn edit-task-btn"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(taskLog.taskId, date, taskLog.logId, taskLog.extraInfo || '')
        }}
        title="Edit extra info"
      >
        ✏️
      </button>
      <button
        type="button"
        className="task-action-btn delete-task-btn"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(taskLog.logId ?? -1, date)
        }}
        title="Remove task from this day"
      >
        ×
      </button>
    </div>
  )
}

interface TaskColumnProps {
  tasks: TaskLog[]
  date: string
  availableTasks: FlatTask[]
  placeholder: string
  onTaskSelect: (
    task: FlatTask | null,
    inputValue: string,
    reset: () => void,
  ) => void
  onEnter: (inputValue: string, reset: () => void) => void
  onToggle: (taskId: number, date: string, logId: number) => void
  onDelete: (logId: number, date: string) => void
  onCopy: (taskLog: TaskLog) => void
  onEdit: (
    taskId: number,
    date: string,
    logId: number,
    currentExtraInfo: string,
  ) => void
  editingTask: {
    taskId: number
    date: string
    logId: number
    extraInfo: string
  } | null
  onEditChange: (value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  isDone: boolean
  onPastePinned: (
    date: string,
    done: boolean,
    availableTasks: FlatTask[],
  ) => void
  onAddFromPin: (
    date: string,
    targetLogId: number,
    position: 'before' | 'after',
    isDoneColumn: boolean,
    pin: { taskId: number; extraInfo?: string },
  ) => void
  filterQuery?: string
}

function TaskColumn({
  tasks,
  date,
  availableTasks,
  placeholder,
  onTaskSelect,
  onEnter,
  onToggle,
  onDelete,
  onCopy,
  onEdit,
  editingTask,
  onEditChange,
  onEditSave,
  onEditCancel,
  onReorder,
  isDone,
  onPastePinned,
  onAddFromPin,
  filterQuery = '',
}: TaskColumnProps) {
  const [inputValue, setInputValue] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // input ref so we can anchor the portal menu to its position
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  useEffect(() => {
    const updatePos = () => {
      const el = inputRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }

    if (menuOpen) {
      // position immediately and on next frames to ensure layout settled
      requestAnimationFrame(updatePos)
      // also update on scroll/resize
      window.addEventListener('resize', updatePos)
      window.addEventListener('scroll', updatePos, true)
      // Focus first menu item for keyboard users if available
      requestAnimationFrame(() => {
        const menu = menuRef.current
        if (menu) {
          const first = menu.querySelector('li') as HTMLElement | null
          first?.focus()
        }
      })
    }

    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      // don't clear menuPos here; keep it for a frame if closed
    }
  }, [menuOpen])

  return (
    <div ref={listRef} className="todo-list">
      {tasks.length === 0 ? (
        // Empty list - single drop zone
        <DropZone
          date={date}
          targetLogId={-1}
          position="after"
          isDoneColumn={isDone}
          onReorder={onReorder}
          onAddFromPin={onAddFromPin}
        />
      ) : (
        tasks.map((taskLog, index) => {
          const isEditing = editingTask?.logId === taskLog.logId
          return (
            <div key={`${taskLog.logId}-${date}`}>
              {/* Drop zone before the first item */}
              {index === 0 && (
                <DropZone
                  date={date}
                  targetLogId={taskLog.logId}
                  position="before"
                  isDoneColumn={isDone}
                  onReorder={onReorder}
                  onAddFromPin={onAddFromPin}
                />
              )}

              <TaskItemComponent
                taskLog={taskLog}
                date={date}
                onToggle={onToggle}
                onDelete={onDelete}
                onCopy={onCopy}
                onEdit={onEdit}
                isEditing={isEditing}
                editValue={editingTask?.extraInfo || ''}
                onEditChange={onEditChange}
                onEditSave={onEditSave}
                onEditCancel={onEditCancel}
                onReorder={onReorder}
                filterQuery={filterQuery}
              />

              {/* Drop zone after each item */}
              <DropZone
                date={date}
                targetLogId={taskLog.logId}
                position="after"
                isDoneColumn={isDone}
                onReorder={onReorder}
                onAddFromPin={onAddFromPin}
              />
            </div>
          )
        })
      )}

      <Downshift<FlatTask>
        inputValue={inputValue}
        onInputValueChange={(v) => setInputValue(v)}
        onSelect={(selected) =>
          onTaskSelect(selected, inputValue, () => setInputValue(''))
        }
        selectedItem={null}
        itemToString={(item) => (item ? item.task : '')}
        onStateChange={(changes: StateChangeOptions<FlatTask>) => {
          // Track menu open state so we can ensure visibility
          if (changes.isOpen !== undefined) {
            setMenuOpen(Boolean(changes.isOpen))
          }
        }}
      >
        {({
          getInputProps,
          getItemProps,
          getMenuProps,
          isOpen,
          highlightedIndex,
        }) => {
          // When rendering the Downshift menu into a portal we must suppress
          // Downshift's ref validation because the element will be mounted
          // outside the React tree where Downshift is rendered.
          const _menuProps = getMenuProps(
            {},
            { suppressRefError: true },
          ) as unknown

          // Extract Downshift's ref (must be passed explicitly — spreading
          // props does not apply the special `ref` prop) and the rest of props.
          const dsRef = (
            _menuProps as {
              ref?:
                | ((el: HTMLUListElement | null) => void)
                | { current: HTMLUListElement | null }
                | null
            }
          ).ref
          const restMenuProps = _menuProps as Record<string, unknown>

          // Create a combined ref that updates our local menuRef and forwards
          // to Downshift's ref (function or ref object). Use HTMLUListElement
          // for correct typing.
          const combinedMenuRef = (el: HTMLUListElement | null) => {
            menuRef.current = el
            if (typeof dsRef === 'function') dsRef(el)
            else if (dsRef && 'current' in dsRef) {
              ;(dsRef as { current: HTMLUListElement | null }).current = el
            }
          }

          return (
            <div className="todo-input-wrap">
              <div className="todo-input-inner">
                <input
                  {...getInputProps({
                    placeholder,
                    className: 'todo-combobox-input',
                    enterKeyHint: 'enter',
                    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Home' || e.key === 'End') {
                        // biome-ignore lint/suspicious/noExplicitAny: type is not correct, preventDownshiftDefault is present
                        ;(e.nativeEvent as any).preventDownshiftDefault = true
                      }
                      // If a Downshift item is highlighted and menu is open, let Downshift handle Enter
                      if (
                        e.key === 'Enter' &&
                        isOpen &&
                        highlightedIndex != null
                      ) {
                        return
                      }
                      if (e.key === 'Enter') {
                        onEnter(inputValue, () => setInputValue(''))
                      }
                    },
                    spellCheck: false,
                  })}
                  ref={inputRef}
                />
                {/* Render menu into a portal so it does not affect table/row layout */}
                {isOpen && menuPos
                  ? createPortal(
                      <ul
                        {...(restMenuProps as JSX.IntrinsicElements['ul'])}
                        ref={combinedMenuRef}
                        className="todo-combobox-menu"
                        style={{
                          position: 'absolute',
                          top: menuPos.top,
                          left: menuPos.left,
                          width: menuPos.width,
                          maxHeight: 280,
                          overflow: 'auto',
                          zIndex: 2000,
                          boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
                          background: 'white',
                          borderRadius: 4,
                        }}
                      >
                        {inputValue.trim() !== '' &&
                          availableTasks
                            .filter((item) =>
                              item.task
                                .toLowerCase()
                                .includes(inputValue.toLowerCase()),
                            )
                            .map((item, index) => (
                              <li
                                {...getItemProps({ item, index })}
                                key={item.id}
                                className={
                                  highlightedIndex === index
                                    ? 'highlighted'
                                    : ''
                                }
                              >
                                {item.task}
                                {item.defaultExtraInfo && (
                                  <span className="task-extra-info">
                                    {' '}
                                    ({item.defaultExtraInfo})
                                  </span>
                                )}
                              </li>
                            ))}
                      </ul>,
                      document.body,
                    )
                  : null}
              </div>
              <button
                type="button"
                className="task-action-btn copy-task-btn paste-pinned-btn"
                onClick={() => onPastePinned(date, isDone, availableTasks)}
                title="Paste pinned tasks from clipboard"
              >
                📥
              </button>
            </div>
          )
        }}
      </Downshift>
    </div>
  )
}

export default function TodoGroupTable({
  taskData,
  loading,
  error,
  onTaskDataChange,
  groupId,
  filterQuery = '',
  onFilteredCountChange,
}: TodoGroupTableProps) {
  // Input state is now managed locally inside TaskColumn to avoid caret jumps
  const [editingTask, setEditingTask] = useState<{
    taskId: number
    date: string
    logId: number
    extraInfo: string
  } | null>(null)

  const allTasks = useMemo(() => {
    return taskData.flatMap((group) =>
      group.tasks.map((task) => ({
        id: task.id,
        task: task.task,
        groupName: group.name,
        defaultExtraInfo: task.defaultExtraInfo,
        records: task.records,
      })),
    )
  }, [taskData])

  const taskLookup = useMemo(() => buildTaskLookup(taskData), [taskData])

  const dateNoteMap = useMemo(() => {
    const groupNotesArr = taskData[0]?.notes || []
    const map = new Map<string, string>()
    for (const note of groupNotesArr) {
      map.set(note.date, note.note)
    }
    return map
  }, [taskData])

  const dateRows = useMemo(() => {
    const dateSet = new Set<string>()
    allTasks.forEach((task) => {
      task.records.forEach((record) => dateSet.add(record.date))
    })
    const allDates = generateDateRange(Array.from(dateSet))

    const rows = allDates.map((date) => {
      const dayOfWeek = dayjs(date).format('dddd')
      const doneTasks: TaskLog[] = []
      const todoTasks: TaskLog[] = []

      allTasks.forEach((task) => {
        const records = task.records.filter((record) => record.date === date)
        records.forEach((record) => {
          const taskItem = {
            taskId: task.id,
            task: task.task,
            extraInfo: record.extraInfo,
            sortOrder: record.sortOrder,
            logId: record.id,
          }

          if (record.done) {
            doneTasks.push(taskItem)
          } else {
            todoTasks.push(taskItem)
          }
        })
      })

      doneTasks.sort((a, b) => a.sortOrder - b.sortOrder)
      todoTasks.sort((a, b) => a.sortOrder - b.sortOrder)

      return {
        date,
        dayOfWeek,
        doneTasks,
        todoTasks,
        count: doneTasks.length,
        note: dateNoteMap.get(date) || '',
      }
    })

    // Apply filtering if filterQuery is provided
    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase().trim()
      return rows.filter((row) => {
        // Check if any task in this day matches the filter
        const hasMatchingTask = [...row.doneTasks, ...row.todoTasks].some(
          (task) => {
            // Use the formatted text that users actually see for filtering
            const { text } = formatTaskWithExtraInfo(
              task.task,
              task.extraInfo || '',
            )
            return text.toLowerCase().includes(query)
          },
        )

        // Also check if the note contains the filter query
        const hasMatchingNote = row.note.toLowerCase().includes(query)

        return hasMatchingTask || hasMatchingNote
      })
    }

    return rows
  }, [allTasks, dateNoteMap, filterQuery])

  // Keep previous filterQuery to detect clearing of the filter
  const prevFilterRef = useRef<string>(filterQuery)

  const virtuosoRef = useRef<TableVirtuosoHandle | null>(null)

  useEffect(() => {
    const prev = prevFilterRef.current
    // If previous filter was non-empty and now it's empty, scroll to bottom
    if (prev.trim() && !filterQuery.trim()) {
      // scroll to last item (most recent date)
      const lastIndex = dateRows.length - 1
      if (lastIndex >= 0) {
        // Ensure the list has rendered before scrolling
        requestAnimationFrame(() => {
          try {
            virtuosoRef.current?.scrollToIndex({
              index: lastIndex,
              align: 'end',
            })
          } catch (err) {
            // don't break on errors
            console.error('Failed to scroll virtuoso to bottom:', err)
          }
        })
      }
    }
    prevFilterRef.current = filterQuery
  }, [filterQuery, dateRows.length])

  // Notify parent of filtered count changes
  useEffect(() => {
    if (onFilteredCountChange) {
      onFilteredCountChange(dateRows.length)
    }
  }, [dateRows.length, onFilteredCountChange])

  const updateNoteContent = useCallback(
    async (date: string, newNote: string) => {
      if (!groupId) return
      try {
        await updateGroupNote(groupId, date, newNote)
        onTaskDataChange((prevData) => {
          const newData = [...prevData]
          if (newData[0]?.notes) {
            const noteIdx = newData[0].notes.findIndex((n) => n.date === date)
            if (noteIdx >= 0) {
              newData[0].notes[noteIdx] = { date, note: newNote }
            } else {
              newData[0].notes.push({ date, note: newNote })
            }
          }
          return newData
        })
      } catch (err) {
        console.error('Error updating group note:', err)
      }
    },
    [groupId, onTaskDataChange],
  )

  const toggleTaskRecord = useCallback(
    async (taskId: number, date: string, logId: number) => {
      const taskLocation = taskLookup.get(taskId)
      if (!taskLocation) return

      try {
        const { groupIndex, taskIndex } = taskLocation
        const currentTask = taskData[groupIndex].tasks[taskIndex]
        const record = currentTask.records.find((r) => r.id === logId)
        const newDone = !(record?.done ?? false)
        const updatedLog = await setTaskLog(
          taskId,
          date,
          newDone,
          undefined,
          record?.id,
        )

        onTaskDataChange((prevData) =>
          updateTaskData(prevData, groupIndex, taskIndex, (records) => {
            const updatedRecords = [...records]
            const recordIndex = updatedRecords.findIndex(
              (r) => r.id === updatedLog.id,
            )

            if (recordIndex >= 0) {
              // Update existing record
              updatedRecords[recordIndex] = {
                ...updatedRecords[recordIndex],
                done: updatedLog.done,
                extraInfo: updatedLog.extraInfo || undefined,
                sortOrder: updatedLog.sortOrder,
              }
            } else {
              // Add new record
              updatedRecords.push({
                id: updatedLog.id,
                date: updatedLog.date,
                done: updatedLog.done,
                extraInfo: updatedLog.extraInfo || undefined,
                sortOrder: updatedLog.sortOrder,
              })
            }

            return updatedRecords
          }),
        )
      } catch (err) {
        console.error('Error toggling task record:', err)
      }
    },
    [taskLookup, taskData, onTaskDataChange],
  )

  const deleteTaskRecord = useCallback(
    async (logId: number) => {
      if (logId <= 0) {
        console.error('Invalid logId for deletion:', logId)
        return
      }

      try {
        await deleteTaskLogById(logId)

        // Remove record from local state by searching for record.id === logId
        onTaskDataChange((prevData) => {
          const newData = prevData.map((g) => ({ ...g, tasks: [...g.tasks] }))

          for (let gi = 0; gi < newData.length; gi++) {
            const group = newData[gi]
            for (let ti = 0; ti < group.tasks.length; ti++) {
              const task = { ...group.tasks[ti] }
              const recIdx = task.records.findIndex((r) => r.id === logId)
              if (recIdx >= 0) {
                const updatedRecords = [...task.records]
                updatedRecords.splice(recIdx, 1)

                if (updatedRecords.length === 0) {
                  // remove the entire task
                  group.tasks.splice(ti, 1)
                } else {
                  task.records = updatedRecords
                  group.tasks[ti] = task
                }

                newData[gi] = { ...group }
                return newData
              }
            }
          }

          // If not found locally, just return previous (server deletion succeeded)
          return prevData
        })
      } catch (err) {
        console.error('Error deleting task record:', err)
      }
    },
    [onTaskDataChange],
  )

  const addTaskToCell = useCallback(
    async (
      taskId: number,
      date: string,
      done: boolean,
      extraInfo?: string,
      logId?: number,
    ) => {
      try {
        const log = await setTaskLog(taskId, date, done, extraInfo, logId)

        // Update local state minimally without full refetch
        const taskLocation = taskLookup.get(taskId)
        if (!taskLocation) {
          if (groupId) {
            const updatedGroup = await fetchGroupTasks(groupId)
            if (updatedGroup) onTaskDataChange([updatedGroup])
          }
          return
        }
        const { groupIndex, taskIndex } = taskLocation
        onTaskDataChange((prev) =>
          updateTaskData(prev, groupIndex, taskIndex, (records) => {
            const idx =
              logId != null ? records.findIndex((r) => r.id === logId) : -1
            if (idx >= 0) {
              const updated = [...records]
              updated[idx] = {
                ...updated[idx],
                id: log.id,
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              }
              return updated
            }
            return [
              ...records,
              {
                id: log.id,
                date: log.date,
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              },
            ]
          }),
        )
      } catch (err) {
        console.error('Error adding task to cell:', err)
      }
    },
    [groupId, onTaskDataChange, taskLookup],
  )

  const handleTaskCreationAndAddition = useCallback(
    async (
      inputValue: string,
      date: string,
      done: boolean,
      setInputValue: (value: string) => void,
    ) => {
      if (!groupId || !inputValue.trim()) return

      try {
        const { task: taskName, extraInfo } = parseTaskWithExtraInfo(
          inputValue.trim(),
        )

        const { task, log } = await createTaskAndLog(
          groupId,
          taskName,
          date,
          done,
          { defaultExtraInfo: extraInfo || null, extraInfo: extraInfo || null },
        )

        // Merge into local state without full refetch
        onTaskDataChange((prev) => {
          const copy = [...prev]
          if (!copy[0]) return copy
          const group = { ...copy[0] }
          const existingIdx = group.tasks.findIndex((t) => t.id === task.id)
          if (existingIdx >= 0) {
            const t = { ...group.tasks[existingIdx] }
            const recs = [...t.records]
            const idx = recs.findIndex((r) => r.id === log.id)
            if (idx >= 0) {
              recs[idx] = {
                ...recs[idx],
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              }
            } else {
              recs.push({
                id: log.id,
                date: log.date,
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              })
            }
            t.records = recs
            group.tasks[existingIdx] = t
          } else {
            group.tasks = [
              ...group.tasks,
              {
                id: task.id,
                task: task.task,
                defaultExtraInfo: task.defaultExtraInfo,
                records: [
                  {
                    id: log.id,
                    date: log.date,
                    done: log.done,
                    extraInfo: log.extraInfo || undefined,
                    sortOrder: log.sortOrder,
                  },
                ],
              },
            ]
          }
          copy[0] = group
          return copy
        })

        setInputValue('')
      } catch (err) {
        alert(`Failed to create task: ${(err as Error).message}`)
      }
    },
    [groupId, onTaskDataChange],
  )

  // getAvailableTasks removed – suggestions should include all tasks and allow
  // multiple entries of the same task per date (duplicates allowed).

  const handleTaskSelect = useCallback(
    async (
      selectedTask: FlatTask | null,
      inputValue: string,
      date: string,
      done: boolean,
      setInputValue: (value: string) => void,
    ) => {
      if (!selectedTask && inputValue) {
        await handleTaskCreationAndAddition(
          inputValue,
          date,
          done,
          setInputValue,
        )
        return
      }

      setInputValue('')
      if (!selectedTask) return

      // Check if input has custom extra info for this task
      const { extraInfo: inputExtraInfo } = parseTaskWithExtraInfo(inputValue)
      const extraInfoToUse =
        inputExtraInfo || selectedTask.defaultExtraInfo || undefined

      await addTaskToCell(selectedTask.id, date, done, extraInfoToUse)
    },
    [handleTaskCreationAndAddition, addTaskToCell],
  )

  const handleKeyDown = useCallback(
    async (
      e: React.KeyboardEvent<HTMLInputElement>,
      inputValue: string,
      date: string,
      done: boolean,
      availableTasks: FlatTask[],
      setInputValue: (value: string) => void,
    ) => {
      if (e.key === 'Enter') {
        const trimmedValue = inputValue.trim()
        if (trimmedValue) {
          const { task: taskName, extraInfo } =
            parseTaskWithExtraInfo(trimmedValue)
          const existingTask = availableTasks.find((t) => t.task === taskName)

          if (existingTask) {
            // Add existing task with custom extra info (if provided) or default extra info
            await addTaskToCell(
              existingTask.id,
              date,
              done,
              extraInfo || existingTask.defaultExtraInfo || undefined,
            )
            setInputValue('')
          } else {
            // Create new task
            await handleTaskCreationAndAddition(
              trimmedValue,
              date,
              done,
              setInputValue,
            )
          }
        }
      }
    },
    [handleTaskCreationAndAddition, addTaskToCell],
  )

  const currentDate = dayjs().format('YYYY-MM-DD')

  const handleDeleteClick = useCallback(
    async (logId: number, date: string) => {
      if (date !== currentDate) {
        const ok = await confirmAsync({
          title: 'Confirm delete',
          message: `Remove this task from ${dayjs(date).format('DD-MMM-YY')}? This will delete the record for that day.`,
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          maxWidth: '480px',
        })
        if (!ok) return
      }
      await deleteTaskRecord(logId)
    },
    [deleteTaskRecord, currentDate],
  )

  const updateTaskExtraInfo = useCallback(
    async (
      taskId: number,
      date: string,
      logId: number,
      newExtraInfo: string,
    ) => {
      try {
        // Use single endpoint to update extraInfo without reordering. Keep done unchanged and pass logId.
        const taskLocation = taskLookup.get(taskId)
        if (!taskLocation) return
        const { groupIndex, taskIndex } = taskLocation
        const existingRec = taskData[groupIndex].tasks[taskIndex].records.find(
          (r) => r.id === logId,
        )
        const log = await setTaskLog(
          taskId,
          date,
          existingRec?.done ?? true,
          newExtraInfo,
          existingRec?.id,
        )

        onTaskDataChange((prev) =>
          updateTaskData(prev, groupIndex, taskIndex, (records) => {
            const updated = [...records]
            const idx = updated.findIndex((r) => r.id === log.id)
            if (idx >= 0) {
              updated[idx] = {
                ...updated[idx],
                extraInfo: log.extraInfo || undefined,
                // sortOrder should remain the same per server logic when done unchanged
                sortOrder: log.sortOrder,
              }
            }
            return updated
          }),
        )
      } catch (err) {
        console.error('Error updating task extra info:', err)
      }
    },
    [taskLookup, taskData, onTaskDataChange],
  )

  const handleEditTask = useCallback(
    (taskId: number, date: string, logId: number, currentExtraInfo: string) => {
      setEditingTask({ taskId, date, logId, extraInfo: currentExtraInfo })
    },
    [],
  )

  const handleEditChange = useCallback((value: string) => {
    setEditingTask((prev) => (prev ? { ...prev, extraInfo: value } : null))
  }, [])

  const handleEditSave = useCallback(async () => {
    if (!editingTask) return

    try {
      await updateTaskExtraInfo(
        editingTask.taskId,
        editingTask.date,
        editingTask.logId,
        editingTask.extraInfo,
      )
    } finally {
      setEditingTask(null)
    }
  }, [editingTask, updateTaskExtraInfo])

  const handleEditCancel = useCallback(() => {
    setEditingTask(null)
  }, [])

  const copyTaskToClipboard = useCallback(async (taskLog: TaskLog) => {
    let textToCopy = taskLog.task
    if (taskLog.extraInfo && taskLog.extraInfo.trim().length > 0) {
      textToCopy += ` (${taskLog.extraInfo})`
    }
    try {
      await navigator.clipboard.writeText(textToCopy)
    } catch (err) {
      console.error('Failed to copy task to clipboard:', err)
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = textToCopy
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }, [])

  const handleTaskReorder = useCallback(
    async (
      targetDate: string,
      sourceDate: string,
      sourceLogId: number,
      targetLogId: number,
      position: 'before' | 'after',
      targetDone?: boolean,
    ) => {
      try {
        if (!groupId) return
        // Determine target done status using current rows if not provided
        const targetCell = dateRows.find((row) => row.date === targetDate)
        let finalTargetDone: boolean | undefined = targetDone
        if (!targetCell && sourceDate === targetDate) return
        if (finalTargetDone === undefined) {
          if (targetLogId !== -1 && targetCell) {
            finalTargetDone = targetCell.doneTasks.some(
              (t) => t.logId === targetLogId,
            )
          } else {
            // fallback: infer from source column on that date
            const sameDate = sourceDate === targetDate
            if (sameDate && targetCell) {
              const inDone = targetCell.doneTasks.some(
                (t) => t.logId === sourceLogId,
              )
              finalTargetDone = inDone
            } else {
              finalTargetDone = false
            }
          }
        }

        // Single API to move
        await moveTaskLog({
          logId: sourceLogId,
          fromDate: sourceDate,
          toDate: targetDate,
          toDone: Boolean(finalTargetDone),
          targetLogId: targetLogId === -1 ? undefined : targetLogId,
          position,
        })

        // Refresh the data to reflect the new order
        const updatedGroup = await fetchGroupTasks(groupId)
        if (updatedGroup) {
          onTaskDataChange([updatedGroup])
        }
      } catch (err) {
        console.error('Error reordering tasks:', err)
      }
    },
    [groupId, onTaskDataChange, dateRows],
  )

  const handlePastePinned = useCallback(
    async (date: string, done: boolean, availableTasksForCell: FlatTask[]) => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          alert('Clipboard API not available')
          return
        }
        const text = await navigator.clipboard.readText()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          alert('Clipboard does not contain valid JSON')
          return
        }
        if (!Array.isArray(parsed)) {
          alert('Expected an array of pinned tasks')
          return
        }

        const dateRow = dateRows.find((row) => row.date === date)
        if (!dateRow) return

        // Accept objects that have taskId (preferred) or task name fallback
        const idByName = new Map(
          availableTasksForCell.map((t) => [t.task.toLowerCase(), t.id]),
        )

        // Preserve order from clipboard as provided
        for (const raw of parsed as unknown[]) {
          if (!raw || typeof raw !== 'object') continue
          const obj = raw as Record<string, unknown>
          let id: number | undefined
          const taskIdVal = obj.taskId
          const taskNameVal = obj.task
          const extraInfoVal = obj.extraInfo
          const logIdVal = obj.logId

          if (typeof taskIdVal === 'number') {
            id = taskIdVal
          } else if (
            typeof taskNameVal === 'string' &&
            idByName.has(taskNameVal.toLowerCase())
          ) {
            id = idByName.get(taskNameVal.toLowerCase())
          }

          if (id) {
            const extraInfo =
              typeof extraInfoVal === 'string' ? extraInfoVal : undefined
            const logId = typeof logIdVal === 'number' ? logIdVal : undefined
            await addTaskToCell(id, date, done, extraInfo, logId)
          }
        }
      } catch (err) {
        console.error('Error pasting pinned tasks:', err)
        alert('Failed to paste pinned tasks')
      }
    },
    [addTaskToCell, dateRows],
  )

  // Handle dropping a pinned task into a cell list. If dropped relative to a specific
  // task (targetLogId != -1), create the log and then reorder to the desired position.
  const handleAddFromPin = useCallback(
    async (
      date: string,
      targetLogId: number,
      position: 'before' | 'after',
      isDoneColumn: boolean,
      pin: { taskId: number; extraInfo?: string },
    ) => {
      try {
        // 1) Create/add the log for this task at the end of the target column
        await addTaskToCell(pin.taskId, date, isDoneColumn, pin.extraInfo)

        // 2) If a specific target item is provided, find the new log and reorder relative to it
        if (!groupId) return
        const updatedGroup = await fetchGroupTasks(groupId)
        if (!updatedGroup) return

        // Find the record we just added: last record for taskId on that date with matching done state
        const t = updatedGroup.tasks.find((t) => t.id === pin.taskId)
        const recs = (t?.records || []).filter(
          (r) => r.date === date && r.done === isDoneColumn,
        )
        const newest = recs.sort((a, b) => b.id - a.id)[0]
        if (!newest) {
          onTaskDataChange([updatedGroup])
          return
        }

        // If there is no specific target, just refresh state and return
        if (targetLogId === -1) {
          onTaskDataChange([updatedGroup])
          return
        }

        // Reorder new log relative to the target
        await moveTaskLog({
          logId: newest.id,
          fromDate: date,
          toDate: date,
          toDone: isDoneColumn,
          targetLogId,
          position,
        })

        const afterMove = await fetchGroupTasks(groupId)
        if (afterMove) onTaskDataChange([afterMove])
      } catch (err) {
        console.error('Error adding from pin:', err)
      }
    },
    [addTaskToCell, groupId, onTaskDataChange],
  )

  if (loading) {
    return (
      <div className="virtuoso-table-container loading-container">
        Loading task data...
      </div>
    )
  }

  if (error) {
    return (
      <div className="virtuoso-table-container error-container">
        <div>Error: {error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="retry-button"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="todo-table-container virtuoso-table-container">
      <TableVirtuoso
        ref={virtuosoRef}
        data={dateRows}
        initialTopMostItemIndex={dateRows.length - 1}
        increaseViewportBy={2000}
        fixedHeaderContent={() => (
          <tr className="table-header">
            <th className="header-cell header-cell-date">Date</th>
            <th className="header-cell header-cell-day">Day</th>
            <th className="header-cell header-cell-count">Count</th>
            <th className="header-cell header-cell-done">Done</th>
            <th className="header-cell header-cell-todo">TODO</th>
            <th className="header-cell header-cell-notes">Note</th>
          </tr>
        )}
        itemContent={(_index, dateRow) => {
          const isCurrentDate = dateRow.date === currentDate
          const rowBackgroundClass = isCurrentDate
            ? 'current-date-background'
            : ''

          // Show all tasks in suggestions; duplicates are allowed.
          const availableTasks = allTasks

          return (
            <>
              <td className={`table-cell date-cell ${rowBackgroundClass}`}>
                {dayjs(dateRow.date).format('DD-MMM-YY')}
              </td>
              <td className={`table-cell day-cell ${rowBackgroundClass}`}>
                {dateRow.dayOfWeek}
              </td>
              <td className={`table-cell count-cell ${rowBackgroundClass}`}>
                {dateRow.count}
              </td>
              <td className={`table-cell done-cell ${rowBackgroundClass}`}>
                <TaskColumn
                  tasks={dateRow.doneTasks}
                  date={dateRow.date}
                  availableTasks={availableTasks}
                  placeholder=""
                  isDone={true}
                  onPastePinned={(date, done, avail) =>
                    handlePastePinned(date, done, avail)
                  }
                  onAddFromPin={handleAddFromPin}
                  onTaskSelect={(selectedTask, inputValue, reset) => {
                    handleTaskSelect(
                      selectedTask,
                      inputValue,
                      dateRow.date,
                      true,
                      (_val) => {},
                    )
                    reset()
                  }}
                  onEnter={(inputValue, reset) => {
                    handleKeyDown(
                      { key: 'Enter' } as React.KeyboardEvent<HTMLInputElement>,
                      inputValue,
                      dateRow.date,
                      true,
                      availableTasks,
                      (_val) => {},
                    )
                    reset()
                  }}
                  onToggle={toggleTaskRecord}
                  onDelete={handleDeleteClick}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onReorder={handleTaskReorder}
                  filterQuery={filterQuery}
                />
              </td>
              <td className={`table-cell todo-cell ${rowBackgroundClass}`}>
                <TaskColumn
                  tasks={dateRow.todoTasks}
                  date={dateRow.date}
                  availableTasks={availableTasks}
                  placeholder=""
                  isDone={false}
                  onPastePinned={(date, done, avail) =>
                    handlePastePinned(date, done, avail)
                  }
                  onAddFromPin={handleAddFromPin}
                  onTaskSelect={(selectedTask, inputValue, reset) => {
                    handleTaskSelect(
                      selectedTask,
                      inputValue,
                      dateRow.date,
                      false,
                      (_val) => {},
                    )
                    reset()
                  }}
                  onEnter={(inputValue, reset) => {
                    handleKeyDown(
                      { key: 'Enter' } as React.KeyboardEvent<HTMLInputElement>,
                      inputValue,
                      dateRow.date,
                      false,
                      availableTasks,
                      (_val) => {},
                    )
                    reset()
                  }}
                  onToggle={toggleTaskRecord}
                  onDelete={handleDeleteClick}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onReorder={handleTaskReorder}
                  filterQuery={filterQuery}
                />
              </td>
              <td className={`table-cell notes-cell ${rowBackgroundClass}`}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: This div is intentionally interactive for note editing */}
                <div
                  className="notes-editable"
                  contentEditable="plaintext-only"
                  suppressContentEditableWarning={true}
                  spellCheck={false}
                  onBlur={(e) => {
                    const newNote = e.currentTarget.textContent || ''
                    if (newNote !== dateRow.note) {
                      updateNoteContent(dateRow.date, newNote)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                >
                  {dateRow.note}
                </div>
              </td>
            </>
          )
        }}
      />
    </div>
  )
}
