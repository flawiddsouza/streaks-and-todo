import { config } from './config'
import { formatTaskWithExtraInfo } from './helpers'

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
}

export interface ApiTaskLog {
  id: number
  date: string
  taskId: number
  extraInfo: string | null
  done: boolean
  sortOrder: number
  createdAt: string
}

export interface ApiStreak {
  id: number
  name: string
  notificationsEnabled?: boolean
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
  isOneOff?: boolean
  familyId?: number | null
  logs: ApiTaskLog[]
  groupName: string
}

export interface ApiTaskFamily {
  id: number
  name: string
  namePattern: string | null
  defaultExtraInfo: string | null
  streakId: number | null
  createdAt: string
  updatedAt: string
}

export interface ApiGroup {
  id: number
  name: string
  type: 'streaks' | 'tasks'
  sortOrder: number
  viewMode?: 'table' | 'kanban' | 'calendar'
  settings?: {
    table?: { showOnlyDaysUntilToday?: boolean }
    kanban?: { showOnlyDaysUntilToday?: boolean }
    calendar?: Record<string, unknown>
  }
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
    tasks: {
      id: number
      taskId: number
      task: string
      extraInfo?: string | null
      sortOrder: number
    }[]
  }[]
}

export interface ApiTaskGroupDateSliceResponse {
  tasks: ApiTask[]
  notes?: { date: string; note: string }[]
  dates: string[]
}

interface ApiTaskMeta {
  id: number
  task: string
  defaultExtraInfo?: string | null
  streakId?: number | null
  isOneOff?: boolean
  familyId?: number | null
}

export interface ApiGroupsResponse {
  groups: ApiGroup[]
}

export interface StreakRecord {
  date: string
  done: boolean
  note?: string
  addedByTasks?: { task: string; group: string }[]
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
  notificationsEnabled?: boolean
  records: StreakRecord[]
}

export interface TaskItem {
  id: number
  task: string
  defaultExtraInfo?: string | null
  streakId?: number | null
  isOneOff?: boolean
  familyId?: number | null
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
  viewMode?: 'table' | 'kanban' | 'calendar'
  settings?: {
    table?: { showOnlyDaysUntilToday?: boolean }
    kanban?: { showOnlyDaysUntilToday?: boolean }
    calendar?: Record<string, unknown>
  }
  tasks: TaskItem[]
  notes?: { date: string; note: string }[]
  pins?: {
    id: number
    name: string
    sortOrder: number
    tasks: {
      id: number
      taskId: number
      task: string
      extraInfo?: string | null
      sortOrder: number
    }[]
  }[]
}

export interface TaskGroupDateSlice {
  tasks: TaskItem[]
  notes?: { date: string; note: string }[]
  dates: string[]
}

export interface AiWorkspace {
  id: number
  name: string
  sortOrder: number
}

export interface AiProject {
  id: number
  name: string
  sortOrder: number
  group_id: number
}

export interface AiTask {
  id: number
  projectId: number
  body: string
  sortOrder: number | null
  done: boolean
  createdAt: string
  doneAt: string | null
}

export interface AiChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

const mapTaskItem = (task: ApiTask): TaskItem => ({
  id: task.id,
  task: task.task,
  defaultExtraInfo: task.defaultExtraInfo,
  streakId: task.streakId ?? null,
  isOneOff: task.isOneOff ?? false,
  familyId: task.familyId ?? null,
  records: task.logs.map((log) => ({
    id: log.id,
    date: log.date,
    done: log.done,
    extraInfo: log.extraInfo || undefined,
    sortOrder: log.sortOrder,
  })),
})

const mapTaskGroupBase = (data: ApiTaskGroupResponse) => ({
  id: data.group.id,
  name: data.group.name,
  viewMode: data.group.viewMode,
  settings: data.group.settings,
  tasks: data.tasks.map(mapTaskItem),
  notes: data.notes || [],
})

const mapTaskGroupDateSlice = (data: ApiTaskGroupDateSliceResponse) => ({
  tasks: data.tasks.map(mapTaskItem),
  notes: data.notes || [],
  dates: data.dates,
})

const sortTaskRecords = (a: TaskRecord, b: TaskRecord) =>
  a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder || a.id - b.id

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
        notificationsEnabled: streak.notificationsEnabled,
        records: streak.logs.map((log) => {
          const addedByTasks = (streak.tasks || []).flatMap((t) =>
            t.logs
              .filter((l) => l.date === log.date && l.done)
              .map((matchingLog) => {
                const extraInfo = matchingLog.extraInfo ?? undefined
                const substitutedTask = formatTaskWithExtraInfo(
                  t.task,
                  extraInfo,
                ).text
                return { task: substitutedTask, group: t.groupName }
              }),
          )

          return {
            date: log.date,
            done: log.done,
            note: log.note || undefined,
            // if API bundled linked tasks, compute which tasks mark this date as done
            addedByTasks: addedByTasks.length > 0 ? addedByTasks : undefined,
          }
        }),
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
      ...mapTaskGroupBase(data),
      pins: data.pins || [],
    }
  } catch (err) {
    console.error(`Error fetching tasks for group ${groupId}:`, err)
    return null
  }
}

export const fetchGroupTaskDates = async (
  groupId: number,
  dates: string[],
): Promise<TaskGroupDateSlice | null> => {
  const uniqueDates = Array.from(new Set(dates)).filter(Boolean)
  if (uniqueDates.length === 0) return null

  try {
    const params = new URLSearchParams()
    for (const date of uniqueDates) {
      params.append('date', date)
    }
    const response = await apiFetch(
      `/task-groups/${groupId}/dates?${params.toString()}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch date slice for group ${groupId}`)
    }

    const data: ApiTaskGroupDateSliceResponse = await response.json()
    return mapTaskGroupDateSlice(data)
  } catch (err) {
    console.error(`Error fetching task date slice for group ${groupId}:`, err)
    return null
  }
}

export const mergeTaskGroupDates = (
  current: TaskGroup,
  slice: TaskGroupDateSlice,
): TaskGroup => {
  const dateSet = new Set(slice.dates)
  const sliceTasksById = new Map(slice.tasks.map((task) => [task.id, task]))

  const mergedExistingTasks = current.tasks.flatMap((currentTask) => {
    const sliceTask = sliceTasksById.get(currentTask.id)
    const preservedRecords = currentTask.records.filter(
      (record) => !dateSet.has(record.date),
    )

    if (!sliceTask) {
      return preservedRecords.length > 0
        ? [{ ...currentTask, records: preservedRecords.sort(sortTaskRecords) }]
        : []
    }

    return [
      {
        ...currentTask,
        ...sliceTask,
        records: [...preservedRecords, ...sliceTask.records].sort(
          sortTaskRecords,
        ),
      },
    ]
  })

  const newTasks = slice.tasks.filter(
    (sliceTask) => !current.tasks.some((task) => task.id === sliceTask.id),
  )

  return {
    ...current,
    tasks: [...mergedExistingTasks, ...newTasks],
    notes: [
      ...(current.notes ?? []).filter((note) => !dateSet.has(note.date)),
      ...(slice.notes ?? []),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export const fetchGroupPins = async (
  groupId: number,
): Promise<NonNullable<TaskGroup['pins']> | null> => {
  try {
    const response = await apiFetch(`/task-groups/${groupId}/pins`)
    if (!response.ok) {
      throw new Error(`Failed to fetch pins for group ${groupId}`)
    }
    const data: { pins: NonNullable<TaskGroup['pins']> } = await response.json()
    return data.pins
  } catch (err) {
    console.error(`Error fetching pins for group ${groupId}:`, err)
    return null
  }
}

export const fetchGroupTasksMeta = async (
  groupId: number,
): Promise<TaskItem[] | null> => {
  try {
    const response = await apiFetch(`/task-groups/${groupId}/tasks`)
    if (!response.ok) {
      throw new Error(`Failed to fetch tasks for group ${groupId}`)
    }
    const data: { tasks: ApiTaskMeta[] } = await response.json()
    return data.tasks.map((task) => ({
      id: task.id,
      task: task.task,
      defaultExtraInfo: task.defaultExtraInfo,
      streakId: task.streakId ?? null,
      isOneOff: task.isOneOff ?? false,
      familyId: task.familyId ?? null,
      records: [],
    }))
  } catch (err) {
    console.error(`Error fetching task metadata for group ${groupId}:`, err)
    return null
  }
}

export const mergeGroupTasksMeta = (
  current: TaskGroup,
  updatedTasks: TaskItem[],
): TaskGroup => {
  const updatedById = new Map(updatedTasks.map((t) => [t.id, t]))
  return {
    ...current,
    tasks: [
      ...current.tasks.flatMap((t) => {
        const updated = updatedById.get(t.id)
        if (!updated) return []
        return [{ ...t, ...updated, records: t.records }]
      }),
      ...updatedTasks
        .filter((t) => !current.tasks.some((ct) => ct.id === t.id))
        .map((t) => ({ ...t, records: [] })),
    ],
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
  extraInfo?: string | null,
  sortOrder?: number,
): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, extraInfo, sortOrder }),
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
  pinId: number,
): Promise<void> => {
  const response = await apiFetch(`/pin-groups/${pinGroupId}/pins/${pinId}`, {
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
  items: { pinId: number; sortOrder: number }[],
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
  options?: {
    defaultExtraInfo?: string | null
    extraInfo?: string | null
    isOneOff?: boolean
  },
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
      ...(options?.isOneOff ? { isOneOff: true } : {}),
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
  updates: {
    name?: string
    viewMode?: 'table' | 'kanban' | 'calendar'
    settings?: {
      table?: { showOnlyDaysUntilToday?: boolean }
      kanban?: { showOnlyDaysUntilToday?: boolean }
      calendar?: Record<string, unknown>
    }
  },
): Promise<ApiGroup> => {
  const response = await apiFetch(`/groups/${groupId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
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

// Notification Settings API

export interface NotificationSettings {
  enabled: boolean
  morningTime: string
  eveningTime: string
  upcomingTasksTime: string
  upcomingTasksDays: number
  timezone: string
  channels: {
    email?: {
      enabled: boolean
    }
    ntfy?: {
      enabled: boolean
      server: string
      topic: string
      token?: string
    }
    webhook?: {
      enabled: boolean
      url: string
      secret: string
    }
  }
}

export interface NotificationDeliveryLog {
  id: number
  type: string
  channel: string
  status: string
  error?: string | null
  sentAt: string
}

export const getUserNotificationSettings =
  async (): Promise<NotificationSettings> => {
    const response = await apiFetch('/user/notification-settings')
    if (!response.ok) {
      let message = 'Failed to fetch notification settings'
      try {
        const err = await response.json()
        message = err.message || message
        console.error('getUserNotificationSettings error:', err)
      } catch {}
      throw new Error(message)
    }
    const data = await response.json()
    return data.settings
  }

export const updateNotificationSettings = async (
  settings: Partial<NotificationSettings>,
): Promise<NotificationSettings> => {
  const response = await apiFetch('/user/notification-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.ok) {
    let message = 'Failed to update notification settings'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('updateNotificationSettings error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return data.settings
}

export const sendTestNotification = async (
  type?: 'morning' | 'evening' | 'upcoming',
): Promise<void> => {
  const response = await apiFetch('/test-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  })
  if (!response.ok) {
    let message = 'Failed to send test notification'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('sendTestNotification error:', err)
    } catch {}
    throw new Error(message)
  }
}

export const getNotificationDeliveries = async (): Promise<
  NotificationDeliveryLog[]
> => {
  const response = await apiFetch('/user/notification-deliveries')
  if (!response.ok) {
    let message = 'Failed to fetch notification deliveries'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('getNotificationDeliveries error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return (data.deliveries || []) as NotificationDeliveryLog[]
}

export const updateStreakNotifications = async (
  streakId: number,
  enabled: boolean,
): Promise<ApiStreak> => {
  const response = await apiFetch(`/streaks/${streakId}/notifications`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) {
    let message = 'Failed to update streak notifications'
    try {
      const err = await response.json()
      message = err.message || message
      console.error('updateStreakNotifications error:', err)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  return data.streak
}

export const fetchTaskFamilies = async (): Promise<ApiTaskFamily[]> => {
  const response = await apiFetch('/task-families')
  if (!response.ok) throw new Error('Failed to fetch task families')
  const data = await response.json()
  return data.families
}

export const createTaskFamily = async (payload: {
  name: string
  namePattern?: string | null
  defaultExtraInfo?: string | null
  streakId?: number | null
  taskId: number
  withFill?: boolean
}): Promise<{ family: ApiTaskFamily; fills: ApiFamilyFill[] }> => {
  const response = await apiFetch('/task-families', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to create task family')
  }
  const data = await response.json()
  return { family: data.family, fills: data.fills ?? [] }
}

export const previewCreateTaskFamily = async (payload: {
  taskId: number
  streakId?: number | null
}): Promise<ApiFamilyFill[]> => {
  const response = await apiFetch('/task-families/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to preview create family')
  }
  const data = await response.json()
  return data.fills ?? []
}

export interface ApiFamilyFill {
  taskId: number
  taskName: string
  dates: string[]
}

export const updateTaskFamily = async (
  familyId: number,
  payload: {
    name?: string
    namePattern?: string | null
    defaultExtraInfo?: string | null
    streakId?: number | null
    withFill?: boolean
  },
): Promise<{ family: ApiTaskFamily; fills: ApiFamilyFill[] }> => {
  const response = await apiFetch(`/task-families/${familyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to update task family')
  }
  const data = await response.json()
  return { family: data.family, fills: data.fills ?? [] }
}

export const previewUpdateTaskFamily = async (
  familyId: number,
  payload: { streakId?: number | null },
): Promise<ApiFamilyFill[]> => {
  const response = await apiFetch(`/task-families/${familyId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to preview family update')
  }
  const data = await response.json()
  return data.fills ?? []
}

export const deleteTaskFamily = async (familyId: number): Promise<void> => {
  const response = await apiFetch(`/task-families/${familyId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete task family')
}

export const addTaskToFamily = async (
  familyId: number,
  taskId: number,
  withFill = false,
): Promise<{ fills: ApiFamilyFill[] }> => {
  const response = await apiFetch(`/task-families/${familyId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, withFill }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to add task to family')
  }
  const data = await response.json()
  return { fills: data.fills ?? [] }
}

export const previewAddTaskToFamily = async (
  familyId: number,
  taskId: number,
): Promise<ApiFamilyFill[]> => {
  const response = await apiFetch(
    `/task-families/${familyId}/members/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    },
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to preview add to family')
  }
  const data = await response.json()
  return data.fills ?? []
}

export const removeTaskFromFamily = async (
  familyId: number,
  taskId: number,
): Promise<void> => {
  const response = await apiFetch(
    `/task-families/${familyId}/members/${taskId}`,
    {
      method: 'DELETE',
    },
  )
  if (!response.ok) throw new Error('Failed to remove task from family')
}

export const matchTaskFamily = async (
  taskName: string,
): Promise<ApiTaskFamily[]> => {
  const response = await apiFetch(
    `/task-families/match?name=${encodeURIComponent(taskName)}`,
  )
  if (!response.ok) return []
  const data = await response.json()
  return data.families ?? []
}

// ── AI Tasks ──────────────────────────────────────────────────────

export const fetchAiWorkspaces = async (): Promise<AiWorkspace[]> => {
  const res = await apiFetch('/ai-tasks/workspaces')
  if (!res.ok) throw new Error('Failed to fetch workspaces')
  const data = await res.json()
  return data.workspaces
}

export const createAiWorkspace = async (name: string): Promise<AiWorkspace> => {
  const res = await apiFetch('/ai-tasks/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create workspace')
  const data = await res.json()
  return data.workspace
}

export const updateAiWorkspace = async (
  id: number,
  name: string,
): Promise<AiWorkspace> => {
  const res = await apiFetch(`/ai-tasks/workspaces/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to update workspace')
  const data = await res.json()
  return data.workspace
}

export const deleteAiWorkspace = async (id: number): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/workspaces/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete workspace')
}

export const reorderAiWorkspaces = async (
  updates: { groupId: number; sortOrder: number }[],
): Promise<void> => {
  const res = await apiFetch('/groups/reorder', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groups: updates }),
  })
  if (!res.ok) throw new Error('Failed to reorder workspaces')
}

export const fetchAiProjects = async (
  workspaceId: number,
): Promise<AiProject[]> => {
  const res = await apiFetch(`/ai-tasks/${workspaceId}/projects`)
  if (!res.ok) throw new Error('Failed to fetch projects')
  const data = await res.json()
  return data.projects
}

export const createAiProject = async (
  workspaceId: number,
  name: string,
): Promise<AiProject> => {
  const res = await apiFetch(`/ai-tasks/${workspaceId}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create project')
  const data = await res.json()
  return data.project
}

export const updateAiProject = async (
  id: number,
  name: string,
): Promise<AiProject> => {
  const res = await apiFetch(`/ai-tasks/projects/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to update project')
  const data = await res.json()
  return data.project
}

export const deleteAiProject = async (id: number): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete project')
}

export const reorderAiProjects = async (
  workspaceId: number,
  updates: { groupId: number; sortOrder: number }[],
): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/${workspaceId}/projects/reorder`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates }),
  })
  if (!res.ok) throw new Error('Failed to reorder projects')
}

export const fetchAiTasks = async (workspaceId: number): Promise<AiTask[]> => {
  const res = await apiFetch(`/ai-tasks/${workspaceId}/tasks`)
  if (!res.ok) throw new Error('Failed to fetch tasks')
  const data = await res.json()
  return data.tasks
}

export const createAiTask = async (
  projectId: number,
  body: string,
): Promise<AiTask> => {
  const res = await apiFetch(`/ai-tasks/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('Failed to create task')
  const data = await res.json()
  return data.task
}

export const updateAiTask = async (
  id: number,
  updates: { body?: string; sortOrder?: number },
): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update task')
}

export const toggleAiTask = async (
  id: number,
): Promise<{ done: boolean; doneAt: string | null }> => {
  const res = await apiFetch(`/ai-tasks/tasks/${id}/toggle`, {
    method: 'PATCH',
  })
  if (!res.ok) throw new Error('Failed to toggle task')
  return res.json()
}

export const deleteAiTask = async (id: number): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete task')
}

export const reorderAiTasks = async (
  projectId: number,
  updates: { taskId: number; sortOrder: number }[],
): Promise<void> => {
  const res = await apiFetch(`/ai-tasks/projects/${projectId}/tasks/reorder`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates }),
  })
  if (!res.ok) throw new Error('Failed to reorder tasks')
}

export const fetchAiChatHistory = async (
  workspaceId: number,
): Promise<AiChatMessage[]> => {
  const res = await apiFetch(`/ai-tasks/${workspaceId}/chat`)
  if (!res.ok) throw new Error('Failed to fetch chat history')
  const data = await res.json()
  return data.messages
}

// Returns the fetch Response directly so the caller can stream response.body
export const sendAiChatMessage = (
  workspaceId: number,
  message: string,
): Promise<Response> => {
  return apiFetch(`/ai-tasks/${workspaceId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

export const deleteAiChatFrom = async (
  workspaceId: number,
  messageId: number,
): Promise<void> => {
  const res = await apiFetch(
    `/ai-tasks/${workspaceId}/chat/from/${messageId}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error('Failed to delete chat messages')
}
