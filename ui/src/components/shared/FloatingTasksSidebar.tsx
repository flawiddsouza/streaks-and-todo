import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import dayjs from 'dayjs'
import Downshift, { type StateChangeOptions } from 'downshift'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TaskGroup, TaskRecord } from '../../api'
import { moveTaskLog, setTaskLog } from '../../api'
import { FLOATING_TASK_DATE } from '../../config'
import { formatTaskWithExtraInfo } from '../../helpers'
import {
  addOrCreateTask,
  copyTaskToClipboard,
  deleteTaskLog,
  processTaskInput,
  reorderTaskLog,
} from '../../utils/task-utils'
import DatePickerDialog from './DatePickerDialog'
import './FloatingTasksSidebar.css'

interface FloatingTask {
  taskId: number
  task: string
  extraInfo?: string
  logId: number
  sortOrder: number
}

interface FloatingTasksSidebarProps {
  taskData: TaskGroup[]
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
  groupId?: number
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

interface FlatTask {
  id: number
  task: string
  groupName: string
  defaultExtraInfo?: string | null
  records: TaskRecord[]
}

const updateTaskData = (
  prevData: TaskGroup[],
  groupIndex: number,
  taskIndex: number,
  updateRecords: (records: TaskRecord[]) => TaskRecord[],
): TaskGroup[] => {
  const updated = [...prevData]
  const group = { ...updated[groupIndex] }
  const tasks = [...group.tasks]
  const task = { ...tasks[taskIndex] }
  task.records = updateRecords(task.records)
  tasks[taskIndex] = task
  group.tasks = tasks
  updated[groupIndex] = group
  return updated
}

// Drop zone component for reordering
function DropZone({
  targetLogId,
  position,
  onReorder,
}: {
  targetLogId: number
  position: 'before' | 'after'
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
  ) => void
}) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  useEffect(() => {
    const element = dropRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        return source.data.type === 'task-item'
      },
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: ({ source }) => {
        setIsDraggedOver(false)
        const sourceLogId = source.data.logId as number
        const sourceDate = source.data.sourceDate as string

        onReorder(
          FLOATING_TASK_DATE,
          sourceDate,
          sourceLogId,
          targetLogId,
          position,
        )
      },
    })
  }, [targetLogId, position, onReorder])

  return (
    <div
      ref={dropRef}
      className={`floating-drop-zone ${isDraggedOver ? 'drop-zone-active' : ''}`}
    />
  )
}

// Individual task item with drag support
function FloatingTaskItem({
  task,
  onCopy,
  onEdit,
  onDelete,
  onSchedule,
  isEditing,
  editValue,
  onEditChange,
  onEditSave,
  onEditCancel,
  onReorder,
}: {
  task: FloatingTask
  onCopy: (task: FloatingTask) => void
  onEdit: (
    taskId: number,
    date: string,
    logId: number,
    currentExtraInfo: string,
  ) => void
  onDelete: (logId: number) => void
  onSchedule: (logId: number, taskId: number) => void
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
  ) => void
}) {
  const dragRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  useEffect(() => {
    const element = dragRef.current
    if (!element || isEditing) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'task-item',
          taskId: task.taskId,
          logId: task.logId,
          task: task.task,
          extraInfo: task.extraInfo,
          sortOrder: task.sortOrder,
          sourceDate: FLOATING_TASK_DATE,
        }),
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
          onReorder(
            FLOATING_TASK_DATE,
            sourceDate,
            sourceLogId,
            task.logId,
            'before',
          )
        },
      }),
    )
  }, [task, onReorder, isEditing])

  if (isEditing) {
    return (
      <div className="floating-task-item todo-item">
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

  const { text } = formatTaskWithExtraInfo(task.task, task.extraInfo)

  return (
    <div
      ref={dragRef}
      className={`floating-task-item todo-item ${isDragging ? 'dragging' : ''} ${isDraggedOver ? 'drag-over' : ''}`}
      style={{ cursor: 'grab' }}
    >
      <span className="floating-task-text todo-text">{text}</span>
      <button
        type="button"
        className="task-action-btn schedule-task-btn"
        onClick={(e) => {
          e.stopPropagation()
          onSchedule(task.logId, task.taskId)
        }}
        title="Schedule task"
      >
        📅
      </button>
      <button
        type="button"
        className="task-action-btn copy-task-btn"
        onClick={(e) => {
          e.stopPropagation()
          onCopy(task)
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
          onEdit(
            task.taskId,
            FLOATING_TASK_DATE,
            task.logId,
            task.extraInfo || '',
          )
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
          onDelete(task.logId)
        }}
        title="Remove task from floating list"
      >
        ×
      </button>
    </div>
  )
}

export default function FloatingTasksSidebar({
  taskData,
  onTaskDataChange,
  groupId,
  collapsed,
  onCollapsedChange,
}: FloatingTasksSidebarProps) {
  const isControlled = collapsed !== undefined
  const [internalCollapsed, setInternalCollapsed] = useState(true)
  const actualCollapsed = isControlled ? collapsed : internalCollapsed
  const setCollapsedValue = useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalCollapsed(value)
      }
      onCollapsedChange?.(value)
    },
    [isControlled, onCollapsedChange],
  )
  const [editingTask, setEditingTask] = useState<{
    taskId: number
    date: string
    logId: number
    extraInfo: string
  } | null>(null)
  const [schedulingTask, setSchedulingTask] = useState<{
    logId: number
    taskId: number
  } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const menuRef = useRef<HTMLUListElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const [isHeaderDraggedOver, setIsHeaderDraggedOver] = useState(false)

  // Extract floating tasks
  const floatingTasks = useMemo(() => {
    const tasks: FloatingTask[] = []
    for (const group of taskData) {
      for (const task of group.tasks) {
        for (const record of task.records) {
          if (record.date === FLOATING_TASK_DATE && !record.done) {
            tasks.push({
              taskId: task.id,
              task: task.task,
              extraInfo: record.extraInfo,
              logId: record.id,
              sortOrder: record.sortOrder || 0,
            })
          }
        }
      }
    }
    return tasks.sort((a, b) => a.sortOrder - b.sortOrder)
  }, [taskData])

  // Build task lookup for quick access
  const taskLookup = useMemo(() => {
    const map = new Map<
      number,
      {
        groupIndex: number
        taskIndex: number
        task: (typeof taskData)[0]['tasks'][0]
      }
    >()
    taskData.forEach((group, groupIndex) => {
      group.tasks.forEach((task, taskIndex) => {
        map.set(task.id, { groupIndex, taskIndex, task })
      })
    })
    return map
  }, [taskData])

  // Get all available tasks for autocomplete
  const allTasks: FlatTask[] = useMemo(() => {
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

  const addTaskToCell = useCallback(
    async (taskId: number, date: string, done: boolean, extraInfo?: string) => {
      const taskLocation = taskLookup.get(taskId)
      if (!taskLocation) return

      const { groupIndex, taskIndex } = taskLocation
      const log = await setTaskLog(taskId, date, done, extraInfo)

      onTaskDataChange((prev) =>
        updateTaskData(prev, groupIndex, taskIndex, (records) => {
          const existingIdx = records.findIndex((r) => r.id === log.id)
          const newRecord: TaskRecord = {
            id: log.id,
            date: log.date,
            done: log.done,
            extraInfo: log.extraInfo || undefined,
            sortOrder: log.sortOrder,
          }

          if (existingIdx >= 0) {
            const updated = [...records]
            updated[existingIdx] = newRecord
            return updated
          }
          return [...records, newRecord]
        }),
      )
    },
    [taskLookup, onTaskDataChange],
  )

  const handleTaskSelect = useCallback(
    async (selectedTask: FlatTask | null, inputValue: string) => {
      if (!groupId) return
      if (!selectedTask) return

      // The inputValue might contain extra info after the task name
      // e.g., "Task name (extra info)" or "Task name"
      await addOrCreateTask(
        inputValue.trim() || selectedTask.task,
        FLOATING_TASK_DATE,
        false,
        groupId,
        allTasks,
        onTaskDataChange,
        addTaskToCell,
      )
      setInputValue('')
    },
    [groupId, allTasks, onTaskDataChange, addTaskToCell],
  )

  const handleKeyDown = useCallback(
    async (inputValue: string) => {
      if (!groupId) return

      const trimmed = inputValue.trim()
      if (!trimmed) return

      await processTaskInput(
        trimmed,
        FLOATING_TASK_DATE,
        false,
        groupId,
        allTasks,
        onTaskDataChange,
        addTaskToCell,
      )
      setInputValue('')
    },
    [groupId, allTasks, onTaskDataChange, addTaskToCell],
  )

  const handleCopy = useCallback((task: FloatingTask) => {
    copyTaskToClipboard(task.task, task.extraInfo)
  }, [])

  const handleEdit = useCallback(
    (taskId: number, date: string, logId: number, currentExtraInfo: string) => {
      setEditingTask({ taskId, date, logId, extraInfo: currentExtraInfo })
    },
    [],
  )

  const handleEditChange = useCallback((value: string) => {
    setEditingTask((prev) => (prev ? { ...prev, extraInfo: value } : null))
  }, [])

  const updateTaskExtraInfo = useCallback(
    async (
      taskId: number,
      date: string,
      logId: number,
      newExtraInfo: string,
    ) => {
      try {
        const taskLocation = taskLookup.get(taskId)
        if (!taskLocation) return
        const { groupIndex, taskIndex } = taskLocation
        const existingRec = taskData[groupIndex].tasks[taskIndex].records.find(
          (r) => r.id === logId,
        )
        const log = await setTaskLog(
          taskId,
          date,
          existingRec?.done ?? false,
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

  const handleDelete = useCallback(
    async (logId: number) => {
      if (!groupId) return

      try {
        await deleteTaskLog(
          logId,
          FLOATING_TASK_DATE,
          groupId,
          onTaskDataChange,
          true,
        )
      } catch (err) {
        console.error('Error deleting floating task:', err)
      }
    },
    [groupId, onTaskDataChange],
  )

  const handleSchedule = useCallback((logId: number, taskId: number) => {
    setSchedulingTask({ logId, taskId })
  }, [])

  const handleScheduleConfirm = useCallback(
    async (selectedDate: string) => {
      if (!schedulingTask || !groupId) return

      try {
        // Move the task from floating to the selected date
        await moveTaskLog({
          logId: schedulingTask.logId,
          fromDate: FLOATING_TASK_DATE,
          toDate: selectedDate,
          toDone: false,
        })

        // Refresh the task data
        const taskLocation = taskLookup.get(schedulingTask.taskId)
        if (taskLocation) {
          const { groupIndex, taskIndex } = taskLocation
          onTaskDataChange((prev) =>
            updateTaskData(prev, groupIndex, taskIndex, (records) => {
              return records.map((r) =>
                r.id === schedulingTask.logId
                  ? { ...r, date: selectedDate }
                  : r,
              )
            }),
          )
        }
      } catch (err) {
        console.error('Error scheduling task:', err)
      } finally {
        setSchedulingTask(null)
      }
    },
    [schedulingTask, groupId, taskLookup, onTaskDataChange],
  )

  const handleScheduleCancel = useCallback(() => {
    setSchedulingTask(null)
  }, [])

  const handleReorder = useCallback(
    async (
      targetDate: string,
      sourceDate: string,
      sourceLogId: number,
      targetLogId: number,
      position: 'before' | 'after',
    ) => {
      if (!groupId) return
      // targetDone is always false for floating tasks
      await reorderTaskLog(
        groupId,
        sourceLogId,
        targetDate,
        sourceDate,
        targetLogId,
        position,
        false, // targetDone - floating tasks are always not done
        onTaskDataChange,
      )
    },
    [groupId, onTaskDataChange],
  )

  // Update menu position
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

  // Monitor drag state to hide input during drag
  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === 'task-item') {
          setIsDragging(true)
        }
      },
      onDrop: () => setIsDragging(false),
    })
  }, [])

  // Set up drop target on header to add task to end of list
  useEffect(() => {
    const element = headerRef.current
    if (!element || actualCollapsed) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        return source.data.type === 'task-item'
      },
      onDragEnter: () => setIsHeaderDraggedOver(true),
      onDragLeave: () => setIsHeaderDraggedOver(false),
      onDrop: ({ source }) => {
        setIsHeaderDraggedOver(false)
        const sourceLogId = source.data.logId as number
        const sourceDate = source.data.sourceDate as string

        // Add to end of list
        const targetLogId =
          floatingTasks.length > 0
            ? floatingTasks[floatingTasks.length - 1].logId
            : -1

        handleReorder(
          FLOATING_TASK_DATE,
          sourceDate,
          sourceLogId,
          targetLogId,
          'after',
        )
      },
    })
  }, [actualCollapsed, floatingTasks, handleReorder])

  if (actualCollapsed) {
    return (
      <div className="floating-sidebar collapsed">
        <button
          type="button"
          className="floating-sidebar-toggle"
          onClick={() => setCollapsedValue(false)}
          title="Expand floating tasks"
        >
          <span className="floating-sidebar-title-vertical">
            FLOATING TASKS
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="floating-sidebar">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Header click for collapsing */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Header is intentionally clickable */}
      <div
        ref={headerRef}
        className={`floating-sidebar-header ${isHeaderDraggedOver ? 'header-drag-over' : ''}`}
        onClick={() => setCollapsedValue(true)}
        style={{ cursor: 'pointer' }}
        title="Click to collapse"
      >
        <h3 className="floating-sidebar-title">Floating Tasks</h3>
        <button
          type="button"
          className="floating-sidebar-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setCollapsedValue(true)
          }}
          title="Collapse sidebar"
        >
          ◀
        </button>
      </div>
      <div className="floating-sidebar-content">
        <div className="floating-task-list">
          {floatingTasks.length === 0 ? (
            <DropZone
              targetLogId={-1}
              position="after"
              onReorder={handleReorder}
            />
          ) : (
            floatingTasks.map((task, index) => {
              const isEditing = editingTask?.logId === task.logId
              return (
                <div key={`${task.logId}-${FLOATING_TASK_DATE}`}>
                  {index === 0 && (
                    <DropZone
                      targetLogId={task.logId}
                      position="before"
                      onReorder={handleReorder}
                    />
                  )}
                  <FloatingTaskItem
                    task={task}
                    onCopy={handleCopy}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onSchedule={handleSchedule}
                    isEditing={isEditing}
                    editValue={editingTask?.extraInfo || ''}
                    onEditChange={handleEditChange}
                    onEditSave={handleEditSave}
                    onEditCancel={handleEditCancel}
                    onReorder={handleReorder}
                  />
                  <DropZone
                    targetLogId={task.logId}
                    position="after"
                    onReorder={handleReorder}
                  />
                </div>
              )
            })
          )}
        </div>
        {!isDragging && (
          <div className="floating-sidebar-input">
            <Downshift<FlatTask>
              inputValue={inputValue}
              onInputValueChange={(v) => setInputValue(v)}
              onSelect={(selected) => handleTaskSelect(selected, inputValue)}
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
                    ;(dsRef as { current: HTMLUListElement | null }).current =
                      el
                  }
                }

                return (
                  <div className="floating-input-wrap">
                    <div className="floating-input-inner">
                      <input
                        {...getInputProps({
                          className: 'floating-task-input',
                          enterKeyHint: 'enter',
                          onKeyDown: (
                            e: React.KeyboardEvent<HTMLInputElement>,
                          ) => {
                            if (e.key === 'Home' || e.key === 'End') {
                              // biome-ignore lint/suspicious/noExplicitAny: type is not correct, preventDownshiftDefault is present
                              ;(e.nativeEvent as any).preventDownshiftDefault =
                                true
                            }
                            if (
                              e.key === 'Enter' &&
                              isOpen &&
                              highlightedIndex != null
                            ) {
                              return
                            }
                            if (e.key === 'Enter') {
                              handleKeyDown(inputValue)
                            }
                          },
                          spellCheck: false,
                        })}
                        ref={inputRef}
                      />
                      {isOpen && menuPos
                        ? createPortal(
                            <ul
                              {...(restMenuProps as JSX.IntrinsicElements['ul'])}
                              ref={combinedMenuRef}
                              className="floating-combobox-menu"
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
                                allTasks
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
                  </div>
                )
              }}
            </Downshift>
          </div>
        )}
        <div className="floating-empty-drop-area">
          <DropZone
            targetLogId={
              floatingTasks.length > 0
                ? floatingTasks[floatingTasks.length - 1].logId
                : -1
            }
            position="after"
            onReorder={handleReorder}
          />
        </div>
      </div>
      {schedulingTask && (
        <DatePickerDialog
          onSelectDate={handleScheduleConfirm}
          onCancel={handleScheduleCancel}
          initialDate={dayjs().format('YYYY-MM-DD')}
        />
      )}
    </div>
  )
}
