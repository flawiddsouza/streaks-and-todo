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
  createTaskAndLog,
  deleteTaskLog,
  fetchGroupTasks,
  moveTaskLog,
  setTaskLog,
  type TaskGroup,
  updateGroupNote,
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

interface DropZoneProps {
  date: string
  targetTaskId: number
  position: 'before' | 'after'
  isDoneColumn: boolean
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceTaskId: number,
    targetTaskId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
}

function DropZone({
  date,
  targetTaskId,
  position,
  isDoneColumn,
  onReorder,
}: DropZoneProps) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const element = dropRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        return (
          source.data.type === 'task-item' &&
          source.data.taskId !== targetTaskId
        )
      },
      onDragEnter: () => setIsActive(true),
      onDragLeave: () => setIsActive(false),
      onDrop: ({ source }) => {
        setIsActive(false)
        const sourceTaskId = source.data.taskId as number
        const sourceDate = source.data.sourceDate as string
        onReorder(
          date,
          sourceDate,
          sourceTaskId,
          targetTaskId,
          position,
          isDoneColumn,
        )
      },
    })
  }, [date, targetTaskId, position, isDoneColumn, onReorder])

  return (
    <div
      ref={dropRef}
      className={`drop-zone ${isActive ? 'drop-zone-active' : ''}`}
      data-position={position}
    />
  )
}

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
    targetDate: string,
    sourceDate: string,
    sourceTaskId: number,
    targetTaskId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
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
            source.data.taskId !== taskLog.taskId
          )
        },
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false)
          const sourceTaskId = source.data.taskId as number
          const sourceDate = source.data.sourceDate as string

          if (sourceTaskId === taskLog.taskId) return

          // Handle cross-date/cross-column drops via the enhanced onReorder
          onReorder(date, sourceDate, sourceTaskId, taskLog.taskId, 'before')
        },
      }),
    )
  }, [taskLog, date, onReorder])

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

interface TaskColumnProps {
  tasks: TaskItem[]
  date: string
  availableTasks: FlatTask[]
  placeholder: string
  onTaskSelect: (
    task: FlatTask | null,
    inputValue: string,
    reset: () => void,
  ) => void
  onEnter: (inputValue: string, reset: () => void) => void
  onToggle: (taskId: number, date: string) => void
  onDelete: (taskId: number, date: string) => void
  onCopy: (taskLog: TaskItem) => void
  onEdit: (taskId: number, date: string, currentExtraInfo: string) => void
  editingTask: { taskId: number; date: string; extraInfo: string } | null
  onEditChange: (value: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceTaskId: number,
    targetTaskId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  isDone: boolean
  onPastePinned: (
    date: string,
    done: boolean,
    availableTasks: FlatTask[],
  ) => void
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
}: TaskColumnProps) {
  const [inputValue, setInputValue] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={listRef} className="todo-list">
      {tasks.length === 0 ? (
        // Empty list - single drop zone
        <DropZone
          date={date}
          targetTaskId={-1}
          position="after"
          isDoneColumn={isDone}
          onReorder={onReorder}
        />
      ) : (
        tasks.map((taskLog, index) => {
          const isEditing =
            editingTask?.taskId === taskLog.taskId && editingTask?.date === date
          return (
            <div key={`${taskLog.taskId}-${date}-${taskLog.sortOrder}`}>
              {/* Drop zone before the first item */}
              {index === 0 && (
                <DropZone
                  date={date}
                  targetTaskId={taskLog.taskId}
                  position="before"
                  isDoneColumn={isDone}
                  onReorder={onReorder}
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
              />

              {/* Drop zone after each item */}
              <DropZone
                date={date}
                targetTaskId={taskLog.taskId}
                position="after"
                isDoneColumn={isDone}
                onReorder={onReorder}
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
      >
        {({
          getInputProps,
          getItemProps,
          getMenuProps,
          isOpen,
          highlightedIndex,
        }) => (
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
                      item.task
                        .toLowerCase()
                        .includes(inputValue.toLowerCase()),
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
            <button
              type="button"
              className="task-action-btn copy-task-btn paste-pinned-btn"
              onClick={() => onPastePinned(date, isDone, availableTasks)}
              title="Paste pinned tasks from clipboard"
            >
              📥
            </button>
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
  // Input state is now managed locally inside TaskColumn to avoid caret jumps
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
        const log = await setTaskLog(taskId, date, done, extraInfo)

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
            const idx = records.findIndex((r) => r.date === date)
            if (idx >= 0) {
              const updated = [...records]
              updated[idx] = {
                ...updated[idx],
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              }
              return updated
            }
            return [
              ...records,
              {
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
            const idx = recs.findIndex((r) => r.date === date)
            if (idx >= 0) {
              recs[idx] = {
                ...recs[idx],
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              }
            } else {
              recs.push({
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
        // Use single endpoint to update extraInfo without reordering
        const log = await setTaskLog(
          taskId,
          date /* done unchanged */,
          (() => {
            const loc = taskLookup.get(taskId)
            if (!loc) return true
            const rec = taskData[loc.groupIndex].tasks[
              loc.taskIndex
            ].records.find((r) => r.date === date)
            return rec?.done ?? true
          })(),
          newExtraInfo,
        )

        const taskLocation = taskLookup.get(taskId)
        if (!taskLocation) return
        const { groupIndex, taskIndex } = taskLocation
        onTaskDataChange((prev) =>
          updateTaskData(prev, groupIndex, taskIndex, (records) => {
            const updated = [...records]
            const idx = updated.findIndex((r) => r.date === date)
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
    async (
      targetDate: string,
      sourceDate: string,
      sourceTaskId: number,
      targetTaskId: number,
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
          if (targetTaskId !== -1 && targetCell) {
            finalTargetDone = targetCell.doneTasks.some(
              (t) => t.taskId === targetTaskId,
            )
          } else {
            // fallback: infer from source column on that date
            const sameDate = sourceDate === targetDate
            if (sameDate && targetCell) {
              const inDone = targetCell.doneTasks.some(
                (t) => t.taskId === sourceTaskId,
              )
              finalTargetDone = inDone
            } else {
              finalTargetDone = false
            }
          }
        }

        // Single API to move
        await moveTaskLog({
          taskId: sourceTaskId,
          fromDate: sourceDate,
          toDate: targetDate,
          toDone: Boolean(finalTargetDone),
          targetTaskId: targetTaskId === -1 ? undefined : targetTaskId,
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
            await addTaskToCell(id, date, done, extraInfo)
          }
        }
      } catch (err) {
        console.error('Error pasting pinned tasks:', err)
        alert('Failed to paste pinned tasks')
      }
    },
    [addTaskToCell, dateRows],
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
                  placeholder=""
                  isDone={true}
                  onPastePinned={(date, done, avail) =>
                    handlePastePinned(date, done, avail)
                  }
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
                  onDelete={deleteTaskRecord}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onReorder={handleTaskReorder}
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
                  onDelete={deleteTaskRecord}
                  onCopy={copyTaskToClipboard}
                  onEdit={handleEditTask}
                  editingTask={editingTask}
                  onEditChange={handleEditChange}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
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
