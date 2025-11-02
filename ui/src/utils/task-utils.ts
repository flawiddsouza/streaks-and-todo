import type { Dispatch, SetStateAction } from 'react'
import { createTaskAndLog, type TaskGroup } from '../api'

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
