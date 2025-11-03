import dayjs from 'dayjs'
import type { Dispatch, SetStateAction } from 'react'
import {
  createTaskAndLog,
  deleteTaskLogById,
  fetchGroupTasks,
  moveTaskLog,
  setTaskLog,
  type TaskGroup,
} from '../api'
import confirmAsync from '../components/confirmAsync'

export interface ParsedTaskInput {
  task: string
  extraInfo?: string
}

/**
 * Parse input of the form "Task name (extra info)" into its components.
 * Falls back to treating the entire string as the task when parentheses
 * are missing or unbalanced.
 */
export const parseTaskWithExtraInfo = (taskText: string): ParsedTaskInput => {
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

/**
 * Shared utility to create a new task and add it to a specific date
 * Used by both TodoGroupTable and TodoKanbanView
 */
export async function createTaskAndAddToGroup(
  groupId: number,
  taskText: string,
  date: string,
  done: boolean,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
): Promise<void> {
  if (!groupId || !taskText.trim()) return

  try {
    const { task: taskName, extraInfo } = parseTaskWithExtraInfo(
      taskText.trim(),
    )

    const { task, log } = await createTaskAndLog(
      groupId,
      taskName,
      date,
      done,
      {
        defaultExtraInfo: extraInfo || null,
        extraInfo: extraInfo || null,
      },
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
  } catch (err) {
    throw new Error(`Failed to create task: ${(err as Error).message}`)
  }
}

/**
 * Shared utility to add existing task or create new task
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 *
 * @param taskText - Input text that may contain task name and optional extra info
 * @param date - Date for the task log
 * @param done - Whether the task is marked as done
 * @param groupId - Group ID
 * @param allTasks - All available tasks to check against
 * @param onTaskDataChange - State setter for task data
 * @param addExistingTask - Optional custom function to add existing task (for optimized implementations)
 */
export async function addOrCreateTask(
  taskText: string,
  date: string,
  done: boolean,
  groupId: number,
  allTasks: Array<{
    id: number
    task: string
    defaultExtraInfo?: string | null
  }>,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
  addExistingTask?: (
    taskId: number,
    date: string,
    done: boolean,
    extraInfo?: string,
  ) => Promise<void>,
): Promise<void> {
  if (!groupId || !taskText.trim()) return

  const { task: taskName, extraInfo: inputExtraInfo } = parseTaskWithExtraInfo(
    taskText.trim(),
  )
  const existingTask = allTasks.find(
    (t) => t.task.toLowerCase() === taskName.toLowerCase(),
  )

  if (existingTask) {
    // Task exists - add it
    const extraInfoToUse =
      inputExtraInfo || existingTask.defaultExtraInfo || undefined

    if (addExistingTask) {
      // Use custom implementation (e.g., TodoGroupTable's optimized addTaskToCell)
      await addExistingTask(existingTask.id, date, done, extraInfoToUse)
    } else {
      // Default implementation - direct setTaskLog
      const log = await setTaskLog(existingTask.id, date, done, extraInfoToUse)

      // Update local state
      onTaskDataChange((prev) => {
        const copy = [...prev]
        if (!copy[0]) return copy
        const group = { ...copy[0] }
        const existingIdx = group.tasks.findIndex(
          (t) => t.id === existingTask.id,
        )

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
          // Shouldn't happen but handle gracefully
          group.tasks = [
            ...group.tasks,
            {
              id: existingTask.id,
              task: existingTask.task,
              defaultExtraInfo: existingTask.defaultExtraInfo,
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
    }
  } else {
    // Task doesn't exist - create it
    await createTaskAndAddToGroup(
      groupId,
      taskText,
      date,
      done,
      onTaskDataChange,
    )
  }
}

/**
 * Shared utility to handle task selection from input field
 * Checks if task exists and either:
 * - Adds existing task using setTaskLog
 * - Creates new task using createTaskAndAddToGroup
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 */
export async function handleTaskSelection(
  selectedTask: {
    id: number
    task: string
    defaultExtraInfo?: string | null
  } | null,
  inputValue: string,
  date: string,
  done: boolean,
  groupId: number,
  allTasks: Array<{
    id: number
    task: string
    defaultExtraInfo?: string | null
  }>,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
  addExistingTask?: (
    taskId: number,
    date: string,
    done: boolean,
    extraInfo?: string,
  ) => Promise<void>,
): Promise<void> {
  if (!groupId) return

  // If no task was selected from dropdown, check if input matches an existing task
  if (!selectedTask && inputValue) {
    await addOrCreateTask(
      inputValue,
      date,
      done,
      groupId,
      allTasks,
      onTaskDataChange,
      addExistingTask,
    )
    return
  }

  // Task was selected from dropdown - add it
  if (!selectedTask) return

  const { extraInfo: inputExtraInfo } = parseTaskWithExtraInfo(inputValue)
  const extraInfoToUse =
    inputExtraInfo || selectedTask.defaultExtraInfo || undefined

  if (addExistingTask) {
    // Use custom implementation
    await addExistingTask(selectedTask.id, date, done, extraInfoToUse)
  } else {
    // Default implementation
    const log = await setTaskLog(selectedTask.id, date, done, extraInfoToUse)

    // Update local state
    onTaskDataChange((prev) => {
      const copy = [...prev]
      if (!copy[0]) return copy
      const group = { ...copy[0] }
      const existingIdx = group.tasks.findIndex((t) => t.id === selectedTask.id)

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
        // Shouldn't happen but handle gracefully
        group.tasks = [
          ...group.tasks,
          {
            id: selectedTask.id,
            task: selectedTask.task,
            defaultExtraInfo: selectedTask.defaultExtraInfo,
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
  }
}

/**
 * Shared utility to copy task to clipboard with fallback for older browsers
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 */
export async function copyTaskToClipboard(
  taskName: string,
  extraInfo?: string,
): Promise<void> {
  let textToCopy = taskName
  if (extraInfo && extraInfo.trim().length > 0) {
    textToCopy += ` (${extraInfo})`
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
}

/**
 * Shared utility to delete a task log with optional confirmation
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 *
 * @param logId - The log ID to delete
 * @param date - The date of the task (for confirmation message)
 * @param groupId - The group ID to refresh after deletion
 * @param onTaskDataChange - State setter to update task data
 * @param skipConfirmation - Whether to skip confirmation dialog (default: false for non-today dates)
 */
export async function deleteTaskLog(
  logId: number,
  date: string,
  groupId: number,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
  skipConfirmation = false,
): Promise<void> {
  if (!groupId) return

  const currentDate = dayjs().format('YYYY-MM-DD')

  // Only show confirmation if deleting from a date other than today (unless skipConfirmation is true)
  if (!skipConfirmation && date !== currentDate) {
    const confirmed = await confirmAsync({
      title: 'Confirm delete',
      message: `Remove this task from ${dayjs(date).format('DD-MMM-YY')}? This will delete the record for that day.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      maxWidth: '480px',
    })
    if (!confirmed) return
  }

  try {
    await deleteTaskLogById(logId)
    const updated = await fetchGroupTasks(groupId)
    if (updated) onTaskDataChange([updated])
  } catch (err) {
    console.error('Error deleting task:', err)
    throw err
  }
}

/**
 * Shared utility to process task input that may be JSON or multi-line plain text
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 *
 * @param inputText - Raw input text (may be JSON array or multi-line text)
 * @param date - Date for the task logs
 * @param done - Whether tasks should be marked as done
 * @param groupId - Group ID
 * @param allTasks - All available tasks to check against
 * @param onTaskDataChange - State setter for task data
 * @param addExistingTask - Optional custom function to add existing task
 * @returns True if processed as JSON, false if processed as plain text
 */
export async function processTaskInput(
  inputText: string,
  date: string,
  done: boolean,
  groupId: number,
  allTasks: Array<{
    id: number
    task: string
    defaultExtraInfo?: string | null
  }>,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
  addExistingTask?: (
    taskId: number,
    date: string,
    done: boolean,
    extraInfo?: string,
    logId?: number,
  ) => Promise<void>,
): Promise<boolean> {
  // Try parsing as JSON first
  try {
    const parsed = JSON.parse(inputText)
    if (Array.isArray(parsed)) {
      // Handle JSON array format
      const idByName = new Map(
        allTasks.map((t) => [t.task.toLowerCase(), t.id]),
      )

      for (const raw of parsed) {
        if (!raw || typeof raw !== 'object') continue
        const obj = raw as Record<string, unknown>
        let id: number | undefined

        if (typeof obj.taskId === 'number') {
          id = obj.taskId
        } else if (
          typeof obj.task === 'string' &&
          idByName.has(obj.task.toLowerCase())
        ) {
          id = idByName.get(obj.task.toLowerCase())
        }

        if (id) {
          const extraInfo =
            typeof obj.extraInfo === 'string' ? obj.extraInfo : undefined
          const logId = typeof obj.logId === 'number' ? obj.logId : undefined

          if (addExistingTask) {
            await addExistingTask(id, date, done, extraInfo, logId)
          } else {
            await setTaskLog(id, date, done, extraInfo, logId)
          }
        }
      }
      return true // Processed as JSON
    }
  } catch {
    // Not JSON, continue with plain text processing
  }

  // Handle plain text (multi-line or single line)
  const lines = inputText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (!groupId) return false

  for (const line of lines) {
    await addOrCreateTask(
      line,
      date,
      done,
      groupId,
      allTasks,
      onTaskDataChange,
      addExistingTask,
    )
  }
  return false // Processed as plain text
}

/**
 * Shared utility to handle adding a pinned task from drag-and-drop
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 *
 * @param date - The date to add the task to
 * @param targetLogId - The target log ID to position relative to (-1 for end of list)
 * @param position - Position relative to target ('before' or 'after')
 * @param isDoneColumn - Whether the target is in the done column
 * @param pin - The pinned task data (taskId and optional extraInfo)
 * @param groupId - The group ID
 * @param onTaskDataChange - State setter to update task data
 * @param addExistingTask - Optional custom function to add existing task (for optimized implementations)
 */
export async function handleAddFromPin(
  date: string,
  targetLogId: number,
  position: 'before' | 'after',
  isDoneColumn: boolean,
  pin: { taskId: number; extraInfo?: string },
  groupId: number,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
  addExistingTask?: (
    taskId: number,
    date: string,
    done: boolean,
    extraInfo?: string,
  ) => Promise<void>,
): Promise<void> {
  try {
    // 1) Create/add the log for this task at the end of the target column
    if (addExistingTask) {
      await addExistingTask(pin.taskId, date, isDoneColumn, pin.extraInfo)
    } else {
      await setTaskLog(pin.taskId, date, isDoneColumn, pin.extraInfo)
    }

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
    throw err
  }
}

/**
 * Shared utility to reorder/move a task log
 * Used by TodoGroupTable, TodoCalendarView, and TodoKanbanView
 *
 * @param groupId - The group ID to refresh after reordering
 * @param sourceLogId - The log ID being moved
 * @param targetDate - The target date
 * @param sourceDate - The source date
 * @param targetLogId - The target log ID to position relative to (-1 for end of list)
 * @param position - Position relative to target ('before' or 'after')
 * @param targetDone - The target done status
 * @param onTaskDataChange - State setter to update task data
 */
export async function reorderTaskLog(
  groupId: number,
  sourceLogId: number,
  targetDate: string,
  sourceDate: string,
  targetLogId: number,
  position: 'before' | 'after',
  targetDone: boolean,
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>,
): Promise<void> {
  if (!groupId) return

  try {
    await moveTaskLog({
      logId: sourceLogId,
      fromDate: sourceDate,
      toDate: targetDate,
      toDone: targetDone,
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
    throw err
  }
}
