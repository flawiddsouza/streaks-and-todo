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

export interface ApiStreak {
  id: number
  name: string
  logs: ApiStreakLog[]
  sortOrder: number
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

export interface ApiGroupsResponse {
  groups: ApiGroup[]
}

export interface StreakRecord {
  date: string
  done: boolean
  note?: string
}

export interface StreakItem {
  id: number
  name: string
  records: StreakRecord[]
}

export interface StreakGroup {
  id: number
  name: string
  streaks: StreakItem[]
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
