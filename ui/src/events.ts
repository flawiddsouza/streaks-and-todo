import { config } from './config'

export type AppEvent =
  | { type: 'connected'; ts: number }
  | { type: 'ping'; ts: number }
  | { type: 'groups.changed'; groupType?: 'streaks' | 'tasks' }
  | { type: 'groups.reordered' }
  | { type: 'group.meta.updated'; groupId: number }
  | { type: 'group.note.updated'; groupId: number; date: string }
  | { type: 'group.streaks.changed'; groupId: number }
  | { type: 'streak.log.updated'; streakId: number; date: string }
  | { type: 'streak.note.updated'; streakId: number; date: string }
  | {
      type: 'task.log.updated'
      taskId: number
      groupId: number
      date: string
      newTask?: unknown
      linkedStreakId?: number
    }
  | { type: 'task.log.deleted'; taskId: number; groupId?: number; date: string }
  | { type: 'tasks.reordered'; date: string }
  | {
      type: 'task.log.moved'
      taskId: number
      fromDate: string
      toDate: string
      toDone: boolean
    }
  | { type: 'pins.groups.changed'; parentGroupId: number }
  | { type: 'pins.group.deleted'; pinGroupId: number; parentGroupId?: number }
  | { type: 'pins.group.renamed'; pinGroupId: number }
  | { type: 'pins.groups.reordered'; parentGroupId: number }
  | { type: 'pins.items.changed'; pinGroupId: number }
  | { type: 'pins.items.reordered'; pinGroupId: number }
  | { type: 'task.updated'; taskId: number; groupId: number }

type Listener = (evt: AppEvent) => void

let es: EventSource | null = null
const listeners = new Set<Listener>()

export function connectEvents() {
  if (es) return es
  const url = `${config.apiBaseUrl}/api/events`
  es = new EventSource(url, { withCredentials: true })

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as AppEvent
      for (const l of listeners) l(data)
    } catch (err) {
      console.error('SSE parse error', err, e.data)
    }
  }

  es.onerror = () => {
    // Let browser auto-reconnect; optionally, we could drop es to recreate.
  }

  return es
}

export function onEvent(fn: Listener): () => void {
  listeners.add(fn)
  // ensure connected
  connectEvents()
  return () => listeners.delete(fn)
}
