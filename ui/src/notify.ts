export type NoticeLevel = 'info' | 'success' | 'warning' | 'error'

export interface Notice {
  id: number
  level: NoticeLevel
  message: string
  timeoutMs?: number
}

type Listener = (n: Notice) => void

let nextId = 1
const listeners = new Set<Listener>()

export function onNotice(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notify(level: NoticeLevel, message: string, timeoutMs = 3500) {
  const notice: Notice = { id: nextId++, level, message, timeoutMs }
  for (const l of listeners) l(notice)
}

export const notices = {
  info: (msg: string, ms?: number) => notify('info', msg, ms),
  success: (msg: string, ms?: number) => notify('success', msg, ms),
  warning: (msg: string, ms?: number) => notify('warning', msg, ms),
  error: (msg: string, ms?: number) => notify('error', msg, ms),
}
