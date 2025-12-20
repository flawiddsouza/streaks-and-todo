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
import { fetchGroupTasks, setTaskLog, type TaskGroup } from '../../api'
import { formatTaskWithExtraInfo } from '../../helpers'
import {
  copyTaskToClipboard,
  deleteTaskLog,
  expandTasksForDropdown,
  type FlatTask,
  filterTasksByQuery,
  getFlatTaskKey,
  getTasksForDisplay,
  handleAddFromPin,
  handleTaskSelection,
  processTaskInput,
  reorderTaskLog,
} from '../../utils/task-utils'
import './TodoCalendarView.css'

// Dropdown menu component for task actions
function TaskActionsMenu({
  onEdit,
  onDelete,
  onCopy,
}: {
  onEdit: () => void
  onDelete: () => void
  onCopy: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className="calendar-task-menu" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className="calendar-task-menu-btn"
        title="More actions"
      >
        ⋮
      </button>
      {isOpen && (
        <div className="calendar-task-menu-dropdown">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCopy()
              setIsOpen(false)
            }}
            className="calendar-task-menu-item"
          >
            <span className="menu-item-icon">📋</span>
            <span>Copy</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
              setIsOpen(false)
            }}
            className="calendar-task-menu-item"
          >
            <span className="menu-item-icon">✎</span>
            <span>Edit</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
              setIsOpen(false)
            }}
            className="calendar-task-menu-item delete"
          >
            <span className="menu-item-icon">🗑</span>
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

interface TodoCalendarViewProps {
  taskData: TaskGroup[]
  loading: boolean
  error: string | null
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
  groupId?: number
  filterQuery?: string
}

interface DayData {
  date: string
  isCurrentMonth: boolean
  isToday: boolean
  doneTasks: {
    taskId: number
    task: string
    extraInfo?: string
    logId: number
    sortOrder: number
  }[]
  todoTasks: {
    taskId: number
    task: string
    extraInfo?: string
    logId: number
    sortOrder: number
  }[]
  note: string
}

// Draggable task item component
function DraggableTaskItem({
  task,
  date,
  isEditing,
  editValue,
  displayText,
  isDone,
  onToggle,
  onDelete,
  onCopy,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onReorder,
}: {
  task: {
    taskId: number
    task: string
    extraInfo?: string
    logId: number
    sortOrder: number
  }
  date: string
  isEditing: boolean
  editValue: string
  displayText: string
  isDone: boolean
  onToggle: () => void
  onDelete: () => void
  onCopy: () => void
  onEdit: () => void
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
}) {
  const taskRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggedOver, setIsDraggedOver] = useState(false)
  const [menuCloseSignal, setMenuCloseSignal] = useState(0)

  useEffect(() => {
    if (isEditing) return
    const element = taskRef.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'task-item',
          logId: task.logId,
          taskId: task.taskId,
          task: task.task,
          extraInfo: task.extraInfo,
          sortOrder: task.sortOrder,
          sourceDate: date,
        }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          if (!nativeSetDragImage) return

          // Create a clean preview of just this task
          const preview = element.cloneNode(true) as HTMLElement
          preview.style.width = `${element.offsetWidth}px`
          preview.style.position = 'absolute'
          preview.style.top = '-9999px'
          preview.style.left = '-9999px'

          // Hide the actions in the preview
          const actions = preview.querySelector(
            '.calendar-task-actions',
          ) as HTMLElement
          if (actions) {
            actions.style.display = 'none'
          }

          document.body.appendChild(preview)

          nativeSetDragImage(preview, 0, 0)

          // Clean up after drag preview is captured
          requestAnimationFrame(() => {
            document.body.removeChild(preview)
          })
        },
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          return (
            source.data.type === 'task-item' && source.data.logId !== task.logId
          )
        },
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false)
          const sourceLogId = source.data.logId as number
          const sourceDate = source.data.sourceDate as string
          if (sourceLogId === task.logId) return
          onReorder(date, sourceDate, sourceLogId, task.logId, 'before', isDone)
        },
      }),
    )
  }, [task, date, isDone, isEditing, onReorder])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Element is interactive for drag-and-drop and menu closing
    <div
      ref={taskRef}
      key={task.logId}
      className={`calendar-task-item ${isDone ? 'done' : ''} ${isDragging ? 'dragging' : ''} ${isDraggedOver ? 'drag-over' : ''}`}
      style={
        isDragging ? { opacity: 0.5, cursor: 'grabbing' } : { cursor: 'grab' }
      }
      onMouseLeave={() => setMenuCloseSignal((prev) => prev + 1)}
    >
      <input
        type="checkbox"
        checked={isDone}
        onChange={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        onClick={(e) => e.stopPropagation()}
        className="calendar-task-checkbox"
      />
      {isEditing ? (
        <div className="calendar-task-edit">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditSave()
              if (e.key === 'Escape') onEditCancel()
            }}
            onBlur={onEditSave}
            onClick={(e) => e.stopPropagation()}
            className="calendar-task-edit-input"
            placeholder="Extra info (optional)"
            spellCheck={false}
            ref={(input) => input?.focus()}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEditSave()
            }}
            className="calendar-task-btn save"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEditCancel()
            }}
            className="calendar-task-btn cancel"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <span className="calendar-task-text">{displayText}</span>
          <TaskActionsMenu
            onEdit={onEdit}
            onDelete={onDelete}
            onCopy={onCopy}
            key={menuCloseSignal}
          />
        </>
      )}
    </div>
  )
}

// Drop zone for reordering tasks (appears between tasks)
function DropZone({
  date,
  targetLogId,
  position,
  isDone,
  onReorder,
  onAddFromPin,
}: {
  date: string
  targetLogId: number
  position: 'before' | 'after'
  isDone: boolean
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
}) {
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
            isDone,
          )
          return
        }
        if (source.data.type === 'pin-item' && onAddFromPin) {
          const taskId = source.data.taskId as number
          const extraInfo =
            (source.data.extraInfo as string | undefined) || undefined
          onAddFromPin(date, targetLogId, position, isDone, {
            taskId,
            extraInfo,
          })
        }
      },
    })
  }, [date, targetLogId, position, isDone, onReorder, onAddFromPin])

  return (
    <div
      ref={dropRef}
      className={`calendar-drop-zone ${isActive ? 'calendar-drop-zone-active' : ''}`}
      data-position={position}
    />
  )
}

// Simple task input component
function TaskInput({
  date,
  done,
  availableTasks,
  onTaskSelect,
  groupId,
  onTaskDataChange,
}: {
  date: string
  done: boolean
  availableTasks: FlatTask[]
  onTaskSelect: (
    task: FlatTask | null,
    inputValue: string,
    date: string,
    done: boolean,
    reset: () => void,
  ) => Promise<void>
  groupId?: number
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
}) {
  const [inputValue, setInputValue] = useState('')
  const menuRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
      requestAnimationFrame(updatePos)
      window.addEventListener('resize', updatePos)
      window.addEventListener('scroll', updatePos, true)
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
    }
  }, [menuOpen])

  const handleKeyDown = async (
    e: React.KeyboardEvent<HTMLInputElement>,
  ): Promise<void> => {
    // Stop all key events from bubbling to parent button
    e.stopPropagation()

    if (e.key === 'Enter') {
      const trimmedValue = inputValue.trim()
      if (!trimmedValue || !groupId) {
        if (!trimmedValue) {
          return
        }
        // groupId not available, fall back to regular selection
        e.preventDefault()
        onTaskSelect(null, inputValue, date, done, () => setInputValue(''))
        return
      }

      // Try parsing as JSON first (new feature for pasted task data)
      try {
        const parsed = JSON.parse(trimmedValue)
        if (Array.isArray(parsed)) {
          e.preventDefault()
          await processTaskInput(
            trimmedValue,
            date,
            done,
            groupId,
            availableTasks,
            onTaskDataChange,
          )
          setInputValue('')
          return
        }
      } catch {
        // Not JSON, continue with normal processing
      }

      // Regular task selection/creation
      e.preventDefault()
      onTaskSelect(null, inputValue, date, done, () => setInputValue(''))
    }
  }

  return (
    <Downshift<FlatTask>
      inputValue={inputValue}
      onInputValueChange={(v) => setInputValue(v)}
      onSelect={(selected) =>
        onTaskSelect(selected, inputValue, date, done, () => setInputValue(''))
      }
      selectedItem={null}
      itemToString={(item) => (item ? item.task : '')}
      onStateChange={(changes: StateChangeOptions<FlatTask>) => {
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
        const _menuProps = getMenuProps(
          {},
          { suppressRefError: true },
        ) as unknown
        const dsRef = (
          _menuProps as {
            ref?:
              | ((el: HTMLUListElement | null) => void)
              | { current: HTMLUListElement | null }
              | null
          }
        ).ref
        const restMenuProps = _menuProps as Record<string, unknown>

        const combinedMenuRef = (el: HTMLUListElement | null) => {
          menuRef.current = el
          if (typeof dsRef === 'function') dsRef(el)
          else if (dsRef && 'current' in dsRef) {
            ;(dsRef as { current: HTMLUListElement | null }).current = el
          }
        }

        const filteredTasks = filterTasksByQuery(availableTasks, inputValue)

        return (
          <div className="calendar-task-input-wrap">
            <input
              {...getInputProps({
                placeholder: 'Add task...',
                className: 'calendar-task-input',
                onClick: (e: React.MouseEvent) => e.stopPropagation(),
                onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (isOpen && highlightedIndex != null && e.key === 'Enter') {
                    return // Let Downshift handle selection
                  }
                  handleKeyDown(e)
                },
                onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  e.stopPropagation()
                },
                onKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  e.stopPropagation()
                },
                spellCheck: false,
              })}
              ref={inputRef}
            />
            {isOpen && menuPos && filteredTasks.length > 0
              ? createPortal(
                  <ul
                    {...(restMenuProps as JSX.IntrinsicElements['ul'])}
                    ref={combinedMenuRef}
                    className="calendar-combobox-menu"
                    style={{
                      position: 'absolute',
                      top: menuPos.top,
                      left: menuPos.left,
                      width: menuPos.width,
                      maxHeight: 200,
                      overflow: 'auto',
                      zIndex: 2000,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      background: 'white',
                      borderRadius: 4,
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                    }}
                  >
                    {filteredTasks.map((item, index) => (
                      <li
                        {...getItemProps({ item, index })}
                        key={getFlatTaskKey(item)}
                        className={
                          highlightedIndex === index ? 'highlighted' : ''
                        }
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          backgroundColor:
                            highlightedIndex === index ? '#f0f0f0' : 'white',
                        }}
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
        )
      }}
    </Downshift>
  )
}

export default function TodoCalendarView({
  taskData,
  loading,
  error,
  onTaskDataChange,
  groupId,
  filterQuery = '',
}: TodoCalendarViewProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [currentMonth, setCurrentMonth] = useState(dayjs())
  const [currentWeek, setCurrentWeek] = useState(dayjs())
  const [editingTask, setEditingTask] = useState<{
    taskId: number
    date: string
    logId: number
    extraInfo: string
  } | null>(null)
  const [editValue, setEditValue] = useState('')
  const calendarGridRef = useRef<HTMLDivElement>(null)
  const todayCellRef = useRef<HTMLDivElement>(null)

  // Scroll to today when view changes or loads, or reset to top if today isn't visible
  // biome-ignore lint/correctness/useExhaustiveDependencies: We intentionally want to scroll when viewMode, currentMonth, or currentWeek changes
  useEffect(() => {
    // Use setTimeout to ensure the DOM has updated
    setTimeout(() => {
      if (todayCellRef.current) {
        // Today is in the current view - scroll to it
        todayCellRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'start',
        })
      } else if (calendarGridRef.current) {
        // Today is not in the current view - reset to top
        calendarGridRef.current.scrollTop = 0
      }
    }, 100)
  }, [viewMode, currentMonth, currentWeek])

  // Expanded tasks for dropdown suggestions (tasks with multi-line defaultExtraInfo get multiple entries)
  const dropdownTasks = useMemo(
    () => expandTasksForDropdown(taskData),
    [taskData],
  )

  // Non-expanded tasks for building display lists (prevents duplicate rendering)
  const displayTasks = useMemo(() => getTasksForDisplay(taskData), [taskData])

  const dateNoteMap = useMemo(() => {
    const groupNotesArr = taskData[0]?.notes || []
    const map = new Map<string, string>()
    for (const note of groupNotesArr) {
      map.set(note.date, note.note)
    }
    return map
  }, [taskData])

  // Generate calendar days for the current month or week
  const calendarDays = useMemo(() => {
    let startDate: dayjs.Dayjs
    let endDate: dayjs.Dayjs

    if (viewMode === 'week') {
      // Week view: show 7 days from Sunday to Saturday
      startDate = currentWeek.startOf('week')
      endDate = currentWeek.endOf('week')
    } else {
      // Month view: show full calendar grid
      const startOfMonth = currentMonth.startOf('month')
      const endOfMonth = currentMonth.endOf('month')
      startDate = startOfMonth.startOf('week')
      endDate = endOfMonth.endOf('week')
    }

    const days: DayData[] = []
    let current = startDate

    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      const dateStr = current.format('YYYY-MM-DD')
      const isCurrentMonth =
        viewMode === 'week' || current.month() === currentMonth.month()
      const isToday = current.isSame(dayjs(), 'day')

      const doneTasks: DayData['doneTasks'] = []
      const todoTasks: DayData['todoTasks'] = []

      displayTasks.forEach((task) => {
        const records = task.records.filter((record) => record.date === dateStr)
        records.forEach((record) => {
          const taskItem = {
            taskId: task.id,
            task: task.task,
            extraInfo: record.extraInfo,
            logId: record.id,
            sortOrder: record.sortOrder,
          }

          if (record.done) {
            doneTasks.push(taskItem)
          } else {
            todoTasks.push(taskItem)
          }
        })
      })

      // Sort tasks by sortOrder
      doneTasks.sort((a, b) => a.sortOrder - b.sortOrder)
      todoTasks.sort((a, b) => a.sortOrder - b.sortOrder)

      // Apply filtering if filterQuery is provided
      let include = true
      if (filterQuery.trim()) {
        const query = filterQuery.toLowerCase().trim()
        include =
          doneTasks.some(
            (t) =>
              t.task.toLowerCase().includes(query) ||
              t.extraInfo?.toLowerCase().includes(query),
          ) ||
          todoTasks.some(
            (t) =>
              t.task.toLowerCase().includes(query) ||
              t.extraInfo?.toLowerCase().includes(query),
          ) ||
          dateNoteMap.get(dateStr)?.toLowerCase().includes(query) ||
          false
      }

      if (include || !filterQuery.trim()) {
        days.push({
          date: dateStr,
          isCurrentMonth,
          isToday,
          doneTasks,
          todoTasks,
          note: dateNoteMap.get(dateStr) || '',
        })
      }

      current = current.add(1, 'day')
    }

    return days
  }, [
    viewMode,
    currentMonth,
    currentWeek,
    displayTasks,
    dateNoteMap,
    filterQuery,
  ])

  const toggleTaskRecord = useCallback(
    async (taskId: number, date: string, logId: number) => {
      if (!groupId) return

      try {
        const task = displayTasks.find((t) => t.id === taskId)
        if (!task) return

        const record = task.records.find((r) => r.id === logId)
        if (!record) return

        const newDone = !record.done

        await setTaskLog(taskId, date, newDone, record.extraInfo || null, logId)

        const updated = await fetchGroupTasks(groupId)
        if (updated) onTaskDataChange([updated])
      } catch (err) {
        console.error('Error toggling task:', err)
        alert((err as Error).message)
      }
    },
    [displayTasks, groupId, onTaskDataChange],
  )

  const deleteTask = useCallback(
    async (logId: number, date: string) => {
      if (!groupId) return

      try {
        await deleteTaskLog(logId, date, groupId, onTaskDataChange)
      } catch (err) {
        alert((err as Error).message)
      }
    },
    [groupId, onTaskDataChange],
  )

  const handleEditTask = useCallback(
    (taskId: number, date: string, logId: number, currentExtraInfo: string) => {
      setEditingTask({ taskId, date, logId, extraInfo: currentExtraInfo })
      setEditValue(currentExtraInfo || '')
    },
    [],
  )

  const handleEditSave = useCallback(async () => {
    if (!editingTask || !groupId) return

    try {
      const task = displayTasks.find((t) => t.id === editingTask.taskId)
      if (!task) return

      const record = task.records.find((r) => r.id === editingTask.logId)
      if (!record) return

      await setTaskLog(
        editingTask.taskId,
        editingTask.date,
        record.done,
        editValue.trim() || null,
        editingTask.logId,
      )

      const updated = await fetchGroupTasks(groupId)
      if (updated) onTaskDataChange([updated])

      setEditingTask(null)
      setEditValue('')
    } catch (err) {
      console.error('Error saving edit:', err)
      alert((err as Error).message)
    }
  }, [editingTask, editValue, groupId, onTaskDataChange, displayTasks])

  const handleEditCancel = useCallback(() => {
    setEditingTask(null)
    setEditValue('')
  }, [])

  const handleTaskSelect = useCallback(
    async (
      selectedTask: FlatTask | null,
      inputValue: string,
      date: string,
      done: boolean,
      reset: () => void,
    ) => {
      if (!groupId) return

      try {
        await handleTaskSelection(
          selectedTask,
          inputValue,
          date,
          done,
          groupId,
          dropdownTasks,
          onTaskDataChange,
        )
        reset()
      } catch (err) {
        console.error('Error handling task selection:', err)
        alert((err as Error).message)
      }
    },
    [groupId, onTaskDataChange, dropdownTasks],
  )

  const handleTaskReorder = useCallback(
    async (
      targetDate: string,
      sourceDate: string,
      sourceLogId: number,
      targetLogId: number,
      position: 'before' | 'after',
      targetDone?: boolean,
    ) => {
      if (!groupId) return

      try {
        await reorderTaskLog(
          groupId,
          sourceLogId,
          targetDate,
          sourceDate,
          targetLogId,
          position,
          Boolean(targetDone),
          onTaskDataChange,
        )
      } catch (err) {
        console.error('Error reordering tasks:', err)
      }
    },
    [groupId, onTaskDataChange],
  )

  // Handle dropping a pinned task into a cell list. If dropped relative to a specific
  // task (targetLogId != -1), create the log and then reorder to the desired position.
  const handleAddFromPinCallback = useCallback(
    async (
      date: string,
      targetLogId: number,
      position: 'before' | 'after',
      isDoneColumn: boolean,
      pin: { taskId: number; extraInfo?: string },
    ) => {
      if (!groupId) return
      await handleAddFromPin(
        date,
        targetLogId,
        position,
        isDoneColumn,
        pin,
        groupId,
        onTaskDataChange,
      )
    },
    [groupId, onTaskDataChange],
  )

  const goToPreviousMonth = () => {
    if (viewMode === 'week') {
      setCurrentWeek(currentWeek.subtract(1, 'week'))
    } else {
      setCurrentMonth(currentMonth.subtract(1, 'month'))
    }
  }

  const goToNextMonth = () => {
    if (viewMode === 'week') {
      setCurrentWeek(currentWeek.add(1, 'week'))
    } else {
      setCurrentMonth(currentMonth.add(1, 'month'))
    }
  }

  const goToToday = () => {
    const today = dayjs()
    setCurrentMonth(today)
    setCurrentWeek(today)
  }

  if (loading) {
    return (
      <div className="calendar-container loading-container">
        Loading task data...
      </div>
    )
  }

  if (error) {
    return (
      <div className="calendar-container error-container">
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
    <div className="calendar-container">
      <div className="calendar-header">
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={goToPreviousMonth}
        >
          ← Previous
        </button>
        <h2 className="calendar-title">
          {viewMode === 'week'
            ? `Week of ${currentWeek.startOf('week').format('MMM D, YYYY')}`
            : currentMonth.format('MMMM YYYY')}
        </h2>
        <button type="button" className="calendar-nav-btn" onClick={goToToday}>
          Today
        </button>
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={goToNextMonth}
        >
          Next →
        </button>
        <div className="calendar-view-toggle">
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
            onClick={() => setViewMode('month')}
          >
            Month
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
        </div>
      </div>

      <div className="calendar-content-wrapper">
        <div className="calendar-weekday-headers">
          <div className="calendar-weekday-header">Sunday</div>
          <div className="calendar-weekday-header">Monday</div>
          <div className="calendar-weekday-header">Tuesday</div>
          <div className="calendar-weekday-header">Wednesday</div>
          <div className="calendar-weekday-header">Thursday</div>
          <div className="calendar-weekday-header">Friday</div>
          <div className="calendar-weekday-header">Saturday</div>
        </div>

        <div className="calendar-grid" ref={calendarGridRef}>
          {calendarDays.map((day) => {
            // Render empty placeholder for days not in current month (month view only)
            if (viewMode === 'month' && !day.isCurrentMonth) {
              return (
                <div
                  key={day.date}
                  className="calendar-day other-month empty-slot"
                />
              )
            }

            return (
              <div
                key={day.date}
                ref={day.isToday ? todayCellRef : null}
                className={`calendar-day ${day.isCurrentMonth ? '' : 'other-month'} ${day.isToday ? 'today' : ''}`}
              >
                <div className="calendar-day-header">
                  <span className="calendar-day-number">
                    {dayjs(day.date).format('D')}
                  </span>
                  {(day.doneTasks.length > 0 || day.todoTasks.length > 0) && (
                    <span className="calendar-day-count">
                      {day.doneTasks.length + day.todoTasks.length}
                    </span>
                  )}
                </div>

                <div className="calendar-day-content">
                  {/* TODO tasks section */}
                  <div className="calendar-task-section">
                    <div className="calendar-section-title">TODO</div>
                    {day.todoTasks.length === 0 ? (
                      <DropZone
                        date={day.date}
                        targetLogId={-1}
                        position="after"
                        isDone={false}
                        onReorder={handleTaskReorder}
                        onAddFromPin={handleAddFromPinCallback}
                      />
                    ) : (
                      day.todoTasks.map((task, index) => {
                        const isEditing =
                          editingTask?.logId === task.logId &&
                          editingTask?.date === day.date
                        const displayText = formatTaskWithExtraInfo(
                          task.task,
                          task.extraInfo,
                        ).text

                        return (
                          <div key={`${task.logId}-${day.date}`}>
                            {index === 0 && (
                              <DropZone
                                date={day.date}
                                targetLogId={task.logId}
                                position="before"
                                isDone={false}
                                onReorder={handleTaskReorder}
                                onAddFromPin={handleAddFromPinCallback}
                              />
                            )}

                            <DraggableTaskItem
                              task={task}
                              date={day.date}
                              isEditing={isEditing}
                              editValue={editValue}
                              displayText={displayText}
                              isDone={false}
                              onToggle={() =>
                                toggleTaskRecord(
                                  task.taskId,
                                  day.date,
                                  task.logId,
                                )
                              }
                              onDelete={() => deleteTask(task.logId, day.date)}
                              onCopy={() =>
                                copyTaskToClipboard(task.task, task.extraInfo)
                              }
                              onEdit={() =>
                                handleEditTask(
                                  task.taskId,
                                  day.date,
                                  task.logId,
                                  task.extraInfo || '',
                                )
                              }
                              onEditChange={setEditValue}
                              onEditSave={handleEditSave}
                              onEditCancel={handleEditCancel}
                              onReorder={handleTaskReorder}
                            />

                            <DropZone
                              date={day.date}
                              targetLogId={task.logId}
                              position="after"
                              isDone={false}
                              onReorder={handleTaskReorder}
                              onAddFromPin={handleAddFromPinCallback}
                            />
                          </div>
                        )
                      })
                    )}

                    <TaskInput
                      date={day.date}
                      done={false}
                      availableTasks={dropdownTasks}
                      onTaskSelect={handleTaskSelect}
                      groupId={groupId}
                      onTaskDataChange={onTaskDataChange}
                    />
                  </div>

                  {/* DONE tasks section */}
                  <div className="calendar-task-section">
                    <div className="calendar-section-title">DONE</div>
                    {day.doneTasks.length === 0 ? (
                      <DropZone
                        date={day.date}
                        targetLogId={-1}
                        position="after"
                        isDone={true}
                        onReorder={handleTaskReorder}
                        onAddFromPin={handleAddFromPinCallback}
                      />
                    ) : (
                      day.doneTasks.map((task, index) => {
                        const isEditing =
                          editingTask?.logId === task.logId &&
                          editingTask?.date === day.date
                        const displayText = formatTaskWithExtraInfo(
                          task.task,
                          task.extraInfo,
                        ).text

                        return (
                          <div key={`${task.logId}-${day.date}`}>
                            {index === 0 && (
                              <DropZone
                                date={day.date}
                                targetLogId={task.logId}
                                position="before"
                                isDone={true}
                                onReorder={handleTaskReorder}
                                onAddFromPin={handleAddFromPinCallback}
                              />
                            )}

                            <DraggableTaskItem
                              task={task}
                              date={day.date}
                              isEditing={isEditing}
                              editValue={editValue}
                              displayText={displayText}
                              isDone={true}
                              onToggle={() =>
                                toggleTaskRecord(
                                  task.taskId,
                                  day.date,
                                  task.logId,
                                )
                              }
                              onDelete={() => deleteTask(task.logId, day.date)}
                              onCopy={() =>
                                copyTaskToClipboard(task.task, task.extraInfo)
                              }
                              onEdit={() =>
                                handleEditTask(
                                  task.taskId,
                                  day.date,
                                  task.logId,
                                  task.extraInfo || '',
                                )
                              }
                              onEditChange={setEditValue}
                              onEditSave={handleEditSave}
                              onEditCancel={handleEditCancel}
                              onReorder={handleTaskReorder}
                            />

                            <DropZone
                              date={day.date}
                              targetLogId={task.logId}
                              position="after"
                              isDone={true}
                              onReorder={handleTaskReorder}
                              onAddFromPin={handleAddFromPinCallback}
                            />
                          </div>
                        )
                      })
                    )}

                    <TaskInput
                      date={day.date}
                      done={true}
                      availableTasks={dropdownTasks}
                      onTaskSelect={handleTaskSelect}
                      groupId={groupId}
                      onTaskDataChange={onTaskDataChange}
                    />
                  </div>

                  {day.note && (
                    <div className="calendar-note">
                      <strong>Note:</strong> {day.note}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
