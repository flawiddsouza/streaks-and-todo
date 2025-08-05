const API_BASE_URL = 'http://localhost:9008'

export interface ApiStreakLog {
  id: number
  date: string
  streakId: number
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
  present: boolean
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

export const fetchGroups = async (): Promise<ApiGroup[]> => {
  const response = await fetch(`${API_BASE_URL}/groups`)
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
          present: true,
          note: log.note || undefined,
        })),
      })),
    }
  } catch (err) {
    console.error(`Error fetching streaks for group ${groupId}:`, err)
    return null
  }
}

export const createStreakLog = async (
  streakId: number,
  date: string,
  note?: string,
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/streaks/${streakId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date,
      note: note || null,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to create streak log:', errorData)
    throw new Error('Failed to create streak log')
  }
}

export const deleteStreakLog = async (
  streakId: number,
  date: string,
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/streaks/${streakId}/${date}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Failed to delete streak log:', errorData)
    throw new Error('Failed to delete streak log')
  }
}
