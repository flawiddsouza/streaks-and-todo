import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import dayjs from 'dayjs'
import Downshift from 'downshift'
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import {
  createTaskForGroup,
  deleteTaskLog,
  fetchGroupTasks,
  setTaskLog,
  type TaskGroup,
  updateGroupNote,
  updateTaskLogNote,
  updateTaskLogsOrder,
} from '../api'
import './TodoGroupTable.css'

interface TodoGroupTableProps {
  taskData: TaskGroup[]
  loading: boolean
  error: string | null
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
  groupId?: number
}

interface TaskItem {
  taskId: number
  task: string
  extraInfo?: string
  sortOrder: number
}

interface FlatTask {
  id: number
  task: string
  groupName: string
  defaultExtraInfo?: string | null
  records: Array<{
    date: string
    done: boolean
    extraInfo?: string
    sortOrder: number
  }>
}

// Helper: render a task label with optional substitution.
// If the task name contains the placeholder and extraInfo is provided, substitute it; otherwise leave as-is.
// Returns the formatted text and a flag indicating if substitution occurred.
const formatTaskWithExtraInfo = (
  taskName: string,
  extraInfo?: string,
): { text: string; usedSubstitution: boolean } => {
  const TOKENS = ['$x']
  if (!extraInfo) return { text: taskName, usedSubstitution: false }

  let text = taskName
  let used = false
  for (const t of TOKENS) {
    if (text.includes(t)) {
      text = text.split(t).join(extraInfo)
      used = true
    }
  }
  return { text, usedSubstitution: used }
}

const generateDateRange = (dates: string[]): string[] => {
  const today = dayjs()

  if (dates.length === 0) {
    // When no data exists, show the last 7 days so user can start working
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

  // Ensure we always show at least the last 7 days
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

const getOrCreateTask = async (
  groupId: number,
  taskName: string,
  defaultExtraInfo: string | undefined,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
): Promise<TaskGroup['tasks'][number] | null> => {
  try {
    let updatedGroup = await fetchGroupTasks(groupId)
    if (!updatedGroup) return null

    let found = updatedGroup.tasks.find((t) => t.task === taskName)

    if (!found) {
      await createTaskForGroup(groupId, taskName, defaultExtraInfo)
      updatedGroup = await fetchGroupTasks(groupId)
      if (!updatedGroup) return null

      found = updatedGroup.tasks.find((t) => t.task === taskName)
    }

    onTaskDataChange([updatedGroup])
    return found || null
  } catch (err) {
    console.error('Error getting or creating task:', err)
    return null
  }
}

const parseTaskWithExtraInfo = (
  taskText: string,
): { task: string; extraInfo?: string } => {
  const match = taskText.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (match) {
    return {
      task: match[1].trim(),
      extraInfo: match[2].trim(),
    }
  }
  return { task: taskText.trim() }
}

// Task Item Component
interface TaskItemProps {
  taskLog: TaskItem
  date: string
  onToggle: (taskId: number, date: string) => void
  onDelete: (taskId: number, date: string) => void
  onCopy: (taskLog: TaskItem) => void
  onEdit: (taskId: number, date: string, currentExtraInfo: string) => void
  isEditing: boolean
  editValue: string
  onEditChange: (value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onReorder: (
    date: string,
    taskLogs: { taskId: number; sortOrder: number }[],
  ) => void
  allTasksInCell: TaskItem[]
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
  allTasksInCell,
}: TaskItemProps) {
  const dragRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  useEffect(() => {
    const element = dragRef.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'task-item',
          taskId: taskLog.taskId,
          sortOrder: taskLog.sortOrder,
          date,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          return (
            source.data.type === 'task-item' &&
            source.data.date === date &&
            source.data.taskId !== taskLog.taskId
          )
        },
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false)
          const sourceTaskId = source.data.taskId as number

          if (sourceTaskId === taskLog.taskId) return

          // Create new sort order array
          const updatedTasks = [...allTasksInCell]
          const sourceIndex = updatedTasks.findIndex(
            (t) => t.taskId === sourceTaskId,
          )
          const targetIndex = updatedTasks.findIndex(
            (t) => t.taskId === taskLog.taskId,
          )

          if (sourceIndex === -1 || targetIndex === -1) return

          // Remove source item and insert at target position
          const [movedItem] = updatedTasks.splice(sourceIndex, 1)
          updatedTasks.splice(targetIndex, 0, movedItem)

          // Update sort orders
          const reorderedTasks = updatedTasks.map((task, index) => ({
            taskId: task.taskId,
            sortOrder: index + 1,
          }))

          onReorder(date, reorderedTasks)
        },
      }),
    )
  }, [taskLog, date, onReorder, allTasksInCell])

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
        onClick={() => onToggle(taskLog.taskId, date)}
      >
        {(() => {
          const { text, usedSubstitution } = formatTaskWithExtraInfo(
            taskLog.task,
            taskLog.extraInfo,
          )
          return (
            <>
              {text}
              {!usedSubstitution &&
                taskLog.extraInfo &&
                taskLog.extraInfo.trim().length > 0 && (
                  <span className="task-extra-info">
                    {' '}
                    ({taskLog.extraInfo})
                  </span>
                )}
            </>
          )
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
          onEdit(taskLog.taskId, date, taskLog.extraInfo || '')
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
          onDelete(taskLog.taskId, date)
        }}
        title="Remove task from this day"
      >
        ×
      </button>
    </div>
  )
}

// Task Column Component
interface TaskColumnProps {
  tasks: TaskItem[]
  date: string
  availableTasks: FlatTask[]
  inputValue: string
  placeholder: string
  onInputChange: (value: string) => void
  onTaskSelect: (task: FlatTask | null) => void
  onToggle: (taskId: number, date: string) => void
  onDelete: (taskId: number, date: string) => void
  onCopy: (taskLog: TaskItem) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEdit: (taskId: number, date: string, currentExtraInfo: string) => void
  editingTask: { taskId: number; date: string; extraInfo: string } | null
  onEditChange: (value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onReorder: (
    date: string,
    taskLogs: { taskId: number; sortOrder: number }[],
  ) => void
}

function TaskColumn({
  tasks,
  date,
  availableTasks,
  inputValue,
  placeholder,
  onInputChange,
  onTaskSelect,
  onToggle,
  onDelete,
  onCopy,
  onKeyDown,
  onEdit,
  editingTask,
  onEditChange,
  onEditSave,
  onEditCancel,
  onReorder,
}: TaskColumnProps) {
  return (
    <div className="todo-list">
      {tasks.map((taskLog) => {
        const isEditing =
          editingTask?.taskId === taskLog.taskId && editingTask?.date === date
        return (
          <TaskItemComponent
            key={`${taskLog.taskId}-${date}-${taskLog.sortOrder}`}
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
            allTasksInCell={tasks}
          />
        )
      })}

      <Downshift
        inputValue={inputValue}
        onInputValueChange={onInputChange}
        onSelect={onTaskSelect}
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
          <div>
            <input
              {...getInputProps({
                placeholder,
                className: 'todo-combobox-input',
                onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  // If a Downshift item is highlighted and menu is open, let Downshift handle Enter
                  if (e.key === 'Enter' && isOpen && highlightedIndex != null) {
                    return
                  }
                  onKeyDown(e)
                },
                spellCheck: false,
              })}
            />
            <ul
              {...getMenuProps()}
              className="todo-combobox-menu"
              style={{ position: 'absolute', left: 0, right: 0 }}
            >
              {isOpen &&
                inputValue.trim() !== '' &&
                availableTasks
                  .filter((item) =>
                    item.task.toLowerCase().includes(inputValue.toLowerCase()),
                  )
                  .map((item, index) => (
                    <li
                      {...getItemProps({ item, index })}
                      key={item.id}
                      className={
                        highlightedIndex === index ? 'highlighted' : ''
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
            </ul>
          </div>
        )}
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
}: TodoGroupTableProps) {
  const [todoInputValues, setTodoInputValues] = useState<
    Record<string, string>
  >({})
  const [doneInputValues, setDoneInputValues] = useState<
    Record<string, string>
  >({})
  const [editingTask, setEditingTask] = useState<{
    taskId: number
    date: string
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

    return allDates.map((date) => {
      const dayOfWeek = dayjs(date).format('dddd')
      const doneTasks: TaskItem[] = []
      const todoTasks: TaskItem[] = []

      allTasks.forEach((task) => {
        const records = task.records.filter((record) => record.date === date)
        records.forEach((record) => {
          const taskItem = {
            taskId: task.id,
            task: task.task,
            extraInfo: record.extraInfo,
            sortOrder: record.sortOrder,
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
  }, [allTasks, dateNoteMap])

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
    async (taskId: number, date: string) => {
      const taskLocation = taskLookup.get(taskId)
      if (!taskLocation) return

      try {
        const { groupIndex, taskIndex } = taskLocation
        const currentTask = taskData[groupIndex].tasks[taskIndex]
        const record = currentTask.records.find((r) => r.date === date)
        const newDone = !(record?.done ?? false)
        const updatedLog = await setTaskLog(taskId, date, newDone)

        onTaskDataChange((prevData) =>
          updateTaskData(prevData, groupIndex, taskIndex, (records) => {
            const updatedRecords = [...records]
            const recordIndex = updatedRecords.findIndex((r) => r.date === date)

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
    async (taskId: number, date: string) => {
      const taskLocation = taskLookup.get(taskId)
      if (!taskLocation) return

      try {
        await deleteTaskLog(taskId, date)
        const { groupIndex, taskIndex } = taskLocation

        onTaskDataChange((prevData) => {
          const newData = [...prevData]
          const targetGroup = { ...newData[groupIndex] }
          const targetTasks = [...targetGroup.tasks]
          const targetTask = { ...targetTasks[taskIndex] }

          // Remove the record for this date
          const updatedRecords = targetTask.records.filter(
            (r) => r.date !== date,
          )

          // If no records remain, remove the task entirely
          if (updatedRecords.length === 0) {
            targetTasks.splice(taskIndex, 1)
          } else {
            targetTask.records = updatedRecords
            targetTasks[taskIndex] = targetTask
          }

          targetGroup.tasks = targetTasks
          newData[groupIndex] = targetGroup
          return newData
        })
      } catch (err) {
        console.error('Error deleting task record:', err)
      }
    },
    [taskLookup, onTaskDataChange],
  )

  const addTaskToCell = useCallback(
    async (taskId: number, date: string, done: boolean, extraInfo?: string) => {
      try {
        await setTaskLog(taskId, date, done)
        if (extraInfo !== undefined) {
          await updateTaskLogNote(taskId, date, extraInfo)
        }

        if (groupId) {
          const updatedGroup = await fetchGroupTasks(groupId)
          if (updatedGroup) {
            onTaskDataChange([updatedGroup])
          }
        }
      } catch (err) {
        console.error('Error adding task to cell:', err)
      }
    },
    [groupId, onTaskDataChange],
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
        const task = await getOrCreateTask(
          groupId,
          taskName,
          extraInfo,
          onTaskDataChange,
        )
        if (task) {
          await addTaskToCell(task.id, date, done, extraInfo)
        }
        setInputValue('')
      } catch (err) {
        alert(`Failed to create task: ${(err as Error).message}`)
      }
    },
    [groupId, onTaskDataChange, addTaskToCell],
  )

  const getAvailableTasks = useCallback(
    (excludeTaskIds: number[]) => {
      return allTasks.filter((task) => !excludeTaskIds.includes(task.id))
    },
    [allTasks],
  )

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

  const updateTaskExtraInfo = useCallback(
    async (taskId: number, date: string, newExtraInfo: string) => {
      try {
        await updateTaskLogNote(taskId, date, newExtraInfo)

        if (groupId) {
          const updatedGroup = await fetchGroupTasks(groupId)
          if (updatedGroup) {
            onTaskDataChange([updatedGroup])
          }
        }
      } catch (err) {
        console.error('Error updating task extra info:', err)
      }
    },
    [groupId, onTaskDataChange],
  )

  const handleEditTask = useCallback(
    (taskId: number, date: string, currentExtraInfo: string) => {
      setEditingTask({ taskId, date, extraInfo: currentExtraInfo })
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
        editingTask.extraInfo,
      )
    } finally {
      setEditingTask(null)
    }
  }, [editingTask, updateTaskExtraInfo])

  const handleEditCancel = useCallback(() => {
    setEditingTask(null)
  }, [])

  const copyTaskToClipboard = useCallback(async (taskLog: TaskItem) => {
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
    async (date: string, taskLogs: { taskId: number; sortOrder: number }[]) => {
      try {
        await updateTaskLogsOrder(date, taskLogs)

        // Refresh the data to reflect the new order
        if (groupId) {
          const updatedGroup = await fetchGroupTasks(groupId)
          if (updatedGroup) {
            onTaskDataChange([updatedGroup])
          }
        }
      } catch (err) {
        console.error('Error reordering tasks:', err)
      }
    },
    [groupId, onTaskDataChange],
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

          const todoTaskIds = dateRow.todoTasks.map((t) => t.taskId)
          const doneTaskIds = dateRow.doneTasks.map((t) => t.taskId)
          const usedTaskIds = [...todoTaskIds, ...doneTaskIds]
          const availableTasks = getAvailableTasks(usedTaskIds)

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
                  inputValue={doneInputValues[dateRow.date] || ''}
                  placeholder=""
                  onInputChange={(val) =>
                    setDoneInputValues((v) => ({ ...v, [dateRow.date]: val }))
                  }
                  onTaskSelect={(selectedTask) =>
                    handleTaskSelect(
                      selectedTask,
                      doneInputValues[dateRow.date] || '',
                      dateRow.date,
                      true,
                      (val) =>
                        setDoneInputValues((v) => ({
                          ...v,
                          [dateRow.date]: val,
                        })),
                    )
                  }
                  onToggle={toggleTaskRecord}
                  onDelete={deleteTaskRecord}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onKeyDown={(e) =>
                    handleKeyDown(
                      e,
                      doneInputValues[dateRow.date] || '',
                      dateRow.date,
                      true,
                      availableTasks,
                      (val) =>
                        setDoneInputValues((v) => ({
                          ...v,
                          [dateRow.date]: val,
                        })),
                    )
                  }
                  onReorder={handleTaskReorder}
                />
              </td>
              <td className={`table-cell todo-cell ${rowBackgroundClass}`}>
                <TaskColumn
                  tasks={dateRow.todoTasks}
                  date={dateRow.date}
                  availableTasks={availableTasks}
                  inputValue={todoInputValues[dateRow.date] || ''}
                  placeholder=""
                  onInputChange={(val) =>
                    setTodoInputValues((v) => ({ ...v, [dateRow.date]: val }))
                  }
                  onTaskSelect={(selectedTask) =>
                    handleTaskSelect(
                      selectedTask,
                      todoInputValues[dateRow.date] || '',
                      dateRow.date,
                      false,
                      (val) =>
                        setTodoInputValues((v) => ({
                          ...v,
                          [dateRow.date]: val,
                        })),
                    )
                  }
                  onToggle={toggleTaskRecord}
                  onDelete={deleteTaskRecord}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onKeyDown={(e) =>
                    handleKeyDown(
                      e,
                      todoInputValues[dateRow.date] || '',
                      dateRow.date,
                      false,
                      availableTasks,
                      (val) =>
                        setTodoInputValues((v) => ({
                          ...v,
                          [dateRow.date]: val,
                        })),
                    )
                  }
                  onReorder={handleTaskReorder}
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
