const API_BASE_URL = 'http://localhost:9008'

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
}

export interface ApiTask {
  id: number
  groupId: number
  task: string
  defaultExtraInfo: string | null
  logs: ApiTaskLog[]
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
  notes?: { date: string; note: string }[] // add notes array
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
}

export interface TaskRecord {
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
  notes?: { date: string; note: string }[] // add notes array
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
  const response = await fetch(`${API_BASE_URL}/groups?type=${type}`)
  if (!response.ok) throw new Error('Failed to fetch groups')
  const data: ApiGroupsResponse = await response.json()
  return data.groups
}

export const fetchGroupStreaks = async (
  groupId: number,
): Promise<StreakGroup | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}/streak-groups/${groupId}`)
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
    const response = await fetch(`${API_BASE_URL}/task-groups/${groupId}`)
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
        records: task.logs.map((log) => ({
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
  const response = await fetch(
    `${API_BASE_URL}/groups/${parentGroupId}/pin-groups`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
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
  const response = await fetch(
    `${API_BASE_URL}/pin-groups/${pinGroupId}/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, sortOrder }),
    },
  )
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
  const response = await fetch(
    `${API_BASE_URL}/pin-groups/${pinGroupId}/tasks/${taskId}`,
    { method: 'DELETE' },
  )
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
  const response = await fetch(
    `${API_BASE_URL}/pin-groups/${pinGroupId}/tasks/reorder`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  )
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
  const response = await fetch(`${API_BASE_URL}/pin-groups/${pinGroupId}`, {
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
  const response = await fetch(`${API_BASE_URL}/pin-groups/${pinGroupId}`, {
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
  const response = await fetch(
    `${API_BASE_URL}/groups/${parentGroupId}/pin-groups/reorder`,
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
  const response = await fetch(`${API_BASE_URL}/streaks/${streakId}/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to toggle streak log:', errorData)
    throw new Error('Failed to toggle streak log')
  }

  const data = await response.json()
  return data.log
}

export const setTaskLog = async (
  taskId: number,
  date: string,
  done: boolean,
): Promise<ApiTaskLog> => {
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
      done,
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

export const updateStreakLogNote = async (
  streakId: number,
  date: string,
  note: string,
): Promise<ApiStreakLog> => {
  const response = await fetch(
    `${API_BASE_URL}/streaks/${streakId}/${date}/note`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note,
      }),
    },
  )

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update streak log note:', errorData)
    throw new Error('Failed to update streak log note')
  }

  const data = await response.json()
  return data.log
}

export const updateTaskLogNote = async (
  taskId: number,
  date: string,
  extraInfo: string,
): Promise<ApiTaskLog> => {
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/${date}/note`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      extraInfo,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update task log note:', errorData)
    throw new Error('Failed to update task log note')
  }

  const data = await response.json()
  return data.log
}

export const deleteTaskLog = async (
  taskId: number,
  date: string,
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/${date}/log`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to delete task log:', errorData)
    throw new Error('Failed to delete task log')
  }
}

export const fetchAllStreaks = async (): Promise<ApiStreak[]> => {
  const response = await fetch(`${API_BASE_URL}/streaks`)
  if (!response.ok) throw new Error('Failed to fetch all streaks')
  const data = await response.json()
  return data.streaks
}

export const addStreakToGroup = async (
  groupId: number,
  streakId: number,
  sortOrder: number,
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/groups/${groupId}/streaks`, {
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
  const response = await fetch(
    `${API_BASE_URL}/groups/${groupId}/streaks/${streakId}`,
    {
      method: 'DELETE',
    },
  )

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
  const response = await fetch(
    `${API_BASE_URL}/groups/${groupId}/streaks/reorder`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        streaks: streakUpdates,
      }),
    },
  )

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update streak order:', errorData)
    throw new Error('Failed to update streak order')
  }
}

export const createStreak = async (name: string): Promise<ApiStreak> => {
  const response = await fetch(`${API_BASE_URL}/streaks`, {
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

export const createGroup = async (
  name: string,
  type: 'streaks' | 'tasks',
): Promise<ApiGroup> => {
  const response = await fetch(`${API_BASE_URL}/groups`, {
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
  const response = await fetch(`${API_BASE_URL}/groups/${groupId}`, {
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
  const response = await fetch(`${API_BASE_URL}/groups/${groupId}`, {
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
  const response = await fetch(`${API_BASE_URL}/groups/reorder`, {
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
  const response = await fetch(
    `${API_BASE_URL}/groups/${groupId}/${date}/note`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
  )
  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to update group note:', errorData)
    throw new Error('Failed to update group note')
  }
  return await response.json()
}

export const createTaskForGroup = async (
  groupId: number,
  task: string,
  defaultExtraInfo?: string,
): Promise<ApiTask> => {
  const response = await fetch(`${API_BASE_URL}/groups/${groupId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, defaultExtraInfo }),
  })
  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to create task:', errorData)
    throw new Error(errorData.message || 'Failed to create task')
  }
  const data = await response.json()
  return data.task
}

export const updateTaskLogsOrder = async (
  date: string,
  taskLogs: { taskId: number; sortOrder: number }[],
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/tasks/reorder`, {
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
  fields: { task?: string; defaultExtraInfo?: string | null },
): Promise<ApiTask> => {
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
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
