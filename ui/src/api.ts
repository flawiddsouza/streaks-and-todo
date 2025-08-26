import { config } from './config'

const API_BASE_URL = config.apiBaseUrl

// Centralized fetch helper to ensure authentication (cookies) are sent.
// Always uses credentials: 'include' for cross-origin session cookie.
const apiFetch = (path: string, init?: RequestInit) => {
  // Allow passing full URL (fallback) but prefer relative API paths.
  const url =
    path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${API_BASE_URL}/api${path.startsWith('/') ? '' : '/'}${path}`
  return fetch(url, { credentials: 'include', ...(init || {}) })
}

export interface ApiStreakLog {
  id: number
  date: string
  streakId: number
  done: boolean
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiTaskLog {
  id: number
  date: string
  taskId: number
  extraInfo: string | null
  done: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ApiStreak {
  id: number
  name: string
  logs: ApiStreakLog[]
  sortOrder: number
  tasks?: ApiTask[]
}

export interface ApiTask {
  id: number
  groupId: number
  task: string
  defaultExtraInfo: string | null
  streakId?: number | null
  logs: ApiTaskLog[]
  groupName?: string
}

export interface ApiGroup {
  id: number
  name: string
  type: 'streaks' | 'tasks'
  sortOrder: number
}

export interface ApiStreakGroupResponse {
  group: ApiGroup
  streaks: ApiStreak[]
}

export interface ApiTaskGroupResponse {
  group: ApiGroup
  tasks: ApiTask[]
  notes?: { date: string; note: string }[]
  pins?: {
    id: number
    name: string
    sortOrder: number
    tasks: { taskId: number; task: string; sortOrder: number }[]
  }[]
}

export interface ApiGroupsResponse {
  groups: ApiGroup[]
}

export interface StreakRecord {
  date: string
  done: boolean
  note?: string
  addedByTasks?: string[]
}

export interface TaskRecord {
  id: number
  date: string
  done: boolean
  extraInfo?: string
  sortOrder: number
}

export interface StreakItem {
  id: number
  name: string
  records: StreakRecord[]
}

export interface TaskItem {
  id: number
  task: string
  defaultExtraInfo?: string | null
  streakId?: number | null
  records: TaskRecord[]
}

export interface StreakGroup {
  id: number
  name: string
  streaks: StreakItem[]
}

export interface TaskGroup {
  id: number
  name: string
  tasks: TaskItem[]
  notes?: { date: string; note: string }[]
  pins?: {
    id: number
    name: string
    sortOrder: number
    tasks: { taskId: number; task: string; sortOrder: number }[]
  }[]
}

export const fetchGroups = async (
  type: 'streaks' | 'tasks',
): Promise<ApiGroup[]> => {
  const response = await apiFetch(`/groups?type=${type}`)
  if (!response.ok) throw new Error('Failed to fetch groups')
  const data: ApiGroupsResponse = await response.json()
  return data.groups
}

export const fetchGroupStreaks = async (
  groupId: number,
): Promise<StreakGroup | null> => {
  try {
    const response = await apiFetch(`/streak-groups/${groupId}`)
    if (!response.ok)
      throw new Error(`Failed to fetch streaks for group ${groupId}`)
    const data: ApiStreakGroupResponse = await response.json()

    return {
      id: data.group.id,
      name: data.group.name,
      streaks: data.streaks.map((streak) => ({
        id: streak.id,
        name: streak.name,
        records: streak.logs.map((log) => ({
          date: log.date,
          done: log.done,
          note: log.note || undefined,
          // if API bundled linked tasks, compute which tasks mark this date as done
          addedByTasks:
            (streak.tasks || [])
              .filter((t) => t.logs.some((l) => l.date === log.date && l.done))
              .map((t) =>
                t.groupName ? `${t.task} — ${t.groupName}` : t.task,
              ) || undefined,
        })),
      })),
    }
  } catch (err) {
    console.error(`Error fetching streaks for group ${groupId}:`, err)
    return null
  }
}

export const fetchGroupTasks = async (
  groupId: number,
): Promise<TaskGroup | null> => {
  try {
    const response = await apiFetch(`/task-groups/${groupId}`)
    if (!response.ok)
      throw new Error(`Failed to fetch tasks for group ${groupId}`)
    const data: ApiTaskGroupResponse = await response.json()

    return {
      id: data.group.id,
      name: data.group.name,
      tasks: data.tasks.map((task) => ({
        id: task.id,
        task: task.task,
        defaultExtraInfo: task.defaultExtraInfo,
        streakId: task.streakId ?? null,
        records: task.logs.map((log) => ({
          id: log.id,
          date: log.date,
          done: log.done,
          extraInfo: log.extraInfo || undefined,
          sortOrder: log.sortOrder,
        })),
      })),
      notes: data.notes || [], // pass notes array
      pins: data.pins || [],
    }
  } catch (err) {
    console.error(`Error fetching tasks for group ${groupId}:`, err)
    return null
  }
}

// Pin groups API
export const createPinGroup = async (
  parentGroupId: number,
  name: string,
): Promise<{
  id: number
  name: string
  sortOrder: number
  group_id: number
}> => {
  const response = await apiFetch(`/groups/${parentGroupId}/pin-groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    let message = 'Failed to create pin group'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('createPinGroup error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return data.pinGroup
}

export const addTaskToPinGroup = async (
  pinGroupId: number,
  taskId: number,
  sortOrder?: number,
): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, sortOrder }),
  })
  if (!response.ok) {
    let message = 'Failed to add task to pin group'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('addTaskToPinGroup error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const removeTaskFromPinGroup = async (
  pinGroupId: number,
  taskId: number,
): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}/tasks/${taskId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    let message = 'Failed to remove task from pin group'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('removeTaskFromPinGroup error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const reorderPinGroupTasks = async (
  pinGroupId: number,
  items: { taskId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}/tasks/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!response.ok) {
    let message = 'Failed to reorder pinned tasks'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('reorderPinGroupTasks error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const renamePinGroup = async (
  pinGroupId: number,
  name: string,
): Promise<{ id: number; name: string }> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    let message = 'Failed to rename pin group'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('renamePinGroup error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return { id: data.group.id, name: data.group.name }
}

export const deletePinGroup = async (pinGroupId: number): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    let message = 'Failed to delete pin group'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('deletePinGroup error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const reorderPinGroups = async (
  parentGroupId: number,
  items: { pinGroupId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await apiFetch(
    `/groups/${parentGroupId}/pin-groups/reorder`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  )
  if (!response.ok) {
    let message = 'Failed to reorder pin groups'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('reorderPinGroups error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const toggleStreakLog = async (
  streakId: number,
  date: string,
): Promise<ApiStreakLog> => {
  const response = await apiFetch(`/streaks/${streakId}/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
    }),
  })

  if (!response.ok) {
    let message = 'Failed to toggle streak log'
    try {
      const errorData = await response.json()
      message = errorData.message || message
      console.error('Failed to toggle streak log:', errorData)
      const err = new Error(message) as Error & { details?: unknown }
      err.details = errorData
      throw err
    } catch (e) {
      if (message) throw new Error(message)
      throw e
    }
  }

  const data = await response.json()
  return data.log
}

export const setTaskLog = async (
  taskId: number,
  date: string,
  done: boolean,
  extraInfo?: string | null,
  logId?: number,
): Promise<ApiTaskLog> => {
  const response = await apiFetch(`/tasks/${taskId}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
      done,
      // include logId when provided so server can update the existing log
      ...(logId !== undefined ? { logId } : {}),
      // send only if defined to avoid overwriting unintentionally
      ...(extraInfo !== undefined ? { extraInfo } : {}),
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to set task log:', errorData)
    throw new Error('Failed to set task log')
  }

  const data = await response.json()
  return data.log
}

// Create-if-needed: use the same endpoint with a 'new' sentinel
export const createTaskAndLog = async (
  groupId: number,
  task: string,
  date: string,
  done: boolean,
  options?: { defaultExtraInfo?: string | null; extraInfo?: string | null },
): Promise<{ task: ApiTask; log: ApiTaskLog }> => {
  const response = await apiFetch(`/tasks/new/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId,
      task,
      date,
      done,
      ...(options?.defaultExtraInfo !== undefined
        ? { defaultExtraInfo: options.defaultExtraInfo }
        : {}),
      ...(options?.extraInfo !== undefined
        ? { extraInfo: options.extraInfo }
        : {}),
    }),
  })
  if (!response.ok) {
    let message = 'Failed to create task and set log'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('createTaskAndLog error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return { task: data.task, log: data.log }
}

export const updateStreakLogNote = async (
  streakId: number,
  date: string,
  note: string,
): Promise<ApiStreakLog> => {
  const response = await apiFetch(`/streaks/${streakId}/${date}/note`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      note,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update streak log note:', errorData)
    throw new Error('Failed to update streak log note')
  }

  const data = await response.json()
  return data.log
}

// updateTaskLogNote removed in favor of setTaskLog(extraInfo)

export const deleteTaskLogById = async (logId: number): Promise<void> => {
  const response = await apiFetch(`/tasks/logs/${logId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to delete task log by id:', errorData)
    throw new Error('Failed to delete task log')
  }
}

export const fetchAllStreaks = async (): Promise<ApiStreak[]> => {
  const response = await apiFetch(`/streaks`)
  if (!response.ok) throw new Error('Failed to fetch all streaks')
  const data = await response.json()
  return data.streaks
}

export const addStreakToGroup = async (
  groupId: number,
  streakId: number,
  sortOrder: number,
): Promise<void> => {
  const response = await apiFetch(`/groups/${groupId}/streaks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      streakId,
      sortOrder,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to add streak to group:', errorData)
    throw new Error('Failed to add streak to group')
  }
}

export const removeStreakFromGroup = async (
  groupId: number,
  streakId: number,
): Promise<void> => {
  const response = await apiFetch(`/groups/${groupId}/streaks/${streakId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to remove streak from group:', errorData)
    throw new Error('Failed to remove streak from group')
  }
}

export const updateStreakOrder = async (
  groupId: number,
  streakUpdates: { streakId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await apiFetch(`/groups/${groupId}/streaks/reorder`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      streaks: streakUpdates,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update streak order:', errorData)
    throw new Error('Failed to update streak order')
  }
}

export const createStreak = async (name: string): Promise<ApiStreak> => {
  const response = await apiFetch(`/streaks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to create streak:', errorData)
    throw new Error(errorData.message || 'Failed to create streak')
  }

  const data = await response.json()
  return data.streak
}

export const renameStreak = async (
  streakId: number,
  name: string,
): Promise<ApiStreak> => {
  const response = await apiFetch(`/streaks/${streakId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    let message = 'Failed to rename streak'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('renameStreak error:', err)
    } catch {}
    throw new Error(message)
  }

  const data = await response.json()
  return data.streak
}

export const createGroup = async (
  name: string,
  type: 'streaks' | 'tasks',
): Promise<ApiGroup> => {
  const response = await apiFetch(`/groups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, type }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to create group:', errorData)
    throw new Error(errorData.message || 'Failed to create group')
  }

  const data = await response.json()
  return data.group
}

export const deleteGroup = async (groupId: number): Promise<void> => {
  const response = await apiFetch(`/groups/${groupId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to delete group:', errorData)
    throw new Error('Failed to delete group')
  }
}

export const updateGroup = async (
  groupId: number,
  name: string,
): Promise<ApiGroup> => {
  const response = await apiFetch(`/groups/${groupId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update group:', errorData)
    throw new Error('Failed to update group')
  }

  const data = await response.json()
  return data.group
}

export const updateGroupOrder = async (
  groupUpdates: { groupId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await apiFetch(`/groups/reorder`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      groups: groupUpdates,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update group order:', errorData)
    throw new Error('Failed to update group order')
  }
}

export const updateGroupNote = async (
  groupId: number,
  date: string,
  note: string,
): Promise<{
  note: { id: number; date: string; groupId: number; note: string }
}> => {
  const response = await apiFetch(`/groups/${groupId}/${date}/note`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  })
  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update group note:', errorData)
    throw new Error('Failed to update group note')
  }
  return await response.json()
}

// createTaskForGroup removed in favor of createTaskAndLog

export const updateTaskLogsOrder = async (
  date: string,
  taskLogs: { taskId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await apiFetch(`/tasks/reorder`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
      taskLogs,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update task logs order:', errorData)
    throw new Error('Failed to update task logs order')
  }
}

export const updateTask = async (
  taskId: number,
  fields: {
    task?: string
    defaultExtraInfo?: string | null
    streakId?: number | null
  },
): Promise<ApiTask> => {
  const response = await apiFetch(`/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })

  if (!response.ok) {
    let message = 'Failed to update task'
    try {
      const errorData = await response.json()
      message = errorData.message || message
      console.error('Failed to update task:', errorData)
    } catch {}
    throw new Error(message)
  }

  const data = await response.json()
  return data.task
}

export const fillMissingStreaksForTask = async (
  taskId: number,
): Promise<{ date: string; task: string }[]> => {
  const response = await apiFetch(`/tasks/${taskId}/fill-missing-streaks`, {
    method: 'POST',
  })
  if (!response.ok) {
    let message = 'Failed to fill missing streaks'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('fillMissingStreaksForTask error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return data.added || []
}

export const moveTaskLog = async (payload: {
  logId: number
  fromDate: string
  toDate: string
  toDone: boolean
  targetLogId?: number
  position?: 'before' | 'after'
  extraInfo?: string | null
}): Promise<ApiTaskLog> => {
  const response = await apiFetch(`/tasks/move-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    let message = 'Failed to move task log'
    try {
      const errorData = await response.json()
      message = errorData.message || message
      console.error('Failed to move task log:', errorData)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return data.log
}
