import { cors } from '@elysiajs/cors'
import { staticPlugin } from '@elysiajs/static'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { type Context, Elysia, sse } from 'elysia'
import { auth } from './auth'
import { config } from './config'
import { db } from './db'
import { usersTable } from './db/auth-schema'
import {
  groupNotesTable,
  groupPinsTable,
  groupsTable,
  notificationDeliveriesTable,
  streakGroupsTable,
  streakLogTable,
  streaksTable,
  taskLogTable,
  tasksTable,
  userNotificationSettingsTable,
} from './db/schema'
import { notificationScheduler } from './jobs/notification-scheduler'
import {
  type EveningStreaksPayload,
  type MorningTasksPayload,
  notificationService,
  type UpcomingTasksPayload,
} from './services/notification-service'

// View mode helpers: 0 = table, 1 = kanban, 2 = calendar
const toViewModeString = (
  mode: number | null | undefined,
): 'table' | 'kanban' | 'calendar' | undefined => {
  if (mode === 0) return 'table'
  if (mode === 1) return 'kanban'
  if (mode === 2) return 'calendar'
  return undefined
}

const toViewModeNumber = (mode: string): number => {
  if (mode === 'calendar') return 2
  if (mode === 'kanban') return 1
  return 0
}

// Authentication: each route validates session and derives userId (no global mutable store usage).

// Small shared helpers to reduce repetition
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const normalizeOptionalText = (v: unknown) => {
  if (v == null) return null
  const s = `${v}`.trim()
  return s === '' ? null : s
}

// When a task is marked done and it's linked to a streak, ensure the streak has a done log for the same date.
async function ensureStreakDoneForDate(
  streakId: number,
  date: string,
  userId: string,
) {
  const existing = await db
    .select()
    .from(streakLogTable)
    .where(
      and(eq(streakLogTable.streakId, streakId), eq(streakLogTable.date, date)),
    )
    .limit(1)

  if (existing.length > 0) {
    if (!existing[0].done) {
      await db
        .update(streakLogTable)
        .set({ done: true })
        .where(
          and(
            eq(streakLogTable.streakId, streakId),
            eq(streakLogTable.date, date),
          ),
        )
      // Notify listeners that a streak log changed due to linked task action
      broadcast(userId, {
        type: 'streak.log.updated',
        streakId,
        date,
      })
    }
  } else {
    await db
      .insert(streakLogTable)
      .values({ userId, streakId, date, done: true })
      .returning()
    // New streak log inserted due to linked task action
    broadcast(userId, {
      type: 'streak.log.updated',
      streakId,
      date,
    })
  }
}

// When a task is moved to undone and it's linked to a streak, clear the streak for that date.
async function ensureStreakUndoneForDate(
  streakId: number,
  date: string,
  _userId: string, // reserved for potential auditing
) {
  // Check if there are any other done task logs for this streak on this date
  const doneTaskLogs = await db
    .select()
    .from(taskLogTable)
    .innerJoin(tasksTable, eq(taskLogTable.taskId, tasksTable.id))
    .where(
      and(
        eq(tasksTable.streakId, streakId),
        eq(taskLogTable.date, date),
        eq(taskLogTable.done, true),
        eq(tasksTable.userId, _userId),
      ),
    )

  // Only set streak to undone if there are no done task logs for this streak on this date
  if (doneTaskLogs.length === 0) {
    const existing = await db
      .select()
      .from(streakLogTable)
      .where(
        and(
          eq(streakLogTable.streakId, streakId),
          eq(streakLogTable.date, date),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      if (existing[0].done) {
        await db
          .update(streakLogTable)
          .set({ done: false })
          .where(
            and(
              eq(streakLogTable.streakId, streakId),
              eq(streakLogTable.date, date),
            ),
          )
        // Notify listeners that a streak log changed due to linked task action
        broadcast(_userId, {
          type: 'streak.log.updated',
          streakId,
          date,
        })
      }
    }
  }
}

const betterAuthView = (context: Context) => {
  const BETTER_AUTH_ACCEPT_METHODS = ['POST', 'GET']
  // validate request method
  if (BETTER_AUTH_ACCEPT_METHODS.includes(context.request.method)) {
    return auth.handler(context.request)
  } else {
    return context.status(405)
  }
}

const SET_COOKIE_HEADER = 'set-cookie'

type SessionPayload = Awaited<ReturnType<typeof auth.api.getSession>>

type AuthedStore = {
  session: SessionPayload
  userId: string
}

const appendSetCookieHeaders = (set: Context['set'], headers?: Headers) => {
  if (!headers) return

  const cookieValues: string[] = []
  headers.forEach((value, key) => {
    if (key.toLowerCase() === SET_COOKIE_HEADER) {
      cookieValues.push(value)
    }
  })

  if (cookieValues.length === 0) return

  const existing = set.headers[SET_COOKIE_HEADER]
  if (existing) {
    const normalized = Array.isArray(existing) ? existing : [existing]
    set.headers[SET_COOKIE_HEADER] = [...normalized, ...cookieValues]
  } else {
    set.headers[SET_COOKIE_HEADER] =
      cookieValues.length === 1 ? cookieValues[0] : cookieValues
  }
}

const getSessionFromRequest = async ({
  request,
  set,
}: {
  request: Request
  set: Context['set']
}): Promise<SessionPayload> => {
  const result = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  } as unknown as Parameters<typeof auth.api.getSession>[0])

  if (result && typeof result === 'object' && 'headers' in result) {
    const headers = result.headers instanceof Headers ? result.headers : void 0
    appendSetCookieHeaders(set, headers)
  }

  if (result && typeof result === 'object' && 'response' in result) {
    return result.response as SessionPayload
  }

  return result as SessionPayload
}

// In-memory per-user SSE subscriptions using a simple async queue per connection.
// Note: This is ephemeral and single-instance only. For multi-instance, use Redis/pub-sub.
class AsyncQueue {
  #queue: string[] = []
  #resolvers: ((v: string) => void)[] = []
  push(v: string) {
    const r = this.#resolvers.shift()
    if (r) r(v)
    else this.#queue.push(v)
  }
  next(): Promise<string> {
    if (this.#queue.length)
      return Promise.resolve(this.#queue.shift() as string)
    return new Promise((resolve) => this.#resolvers.push(resolve))
  }
}

const subscribers = new Map<string, Set<AsyncQueue>>()

function broadcast(userId: string, payload: unknown) {
  const set = subscribers.get(userId)
  if (!set || set.size === 0) return
  const data = JSON.stringify(payload)
  for (const q of Array.from(set)) q.push(data)
}

const api = new Elysia({ prefix: '/api' })
  .use(
    cors({
      credentials: true,
      origin: [config.frontendUrl],
    }),
  )
  .all('/auth/*', betterAuthView)
  .guard(
    {
      async beforeHandle(ctx) {
        const session = await getSessionFromRequest({
          request: ctx.request,
          set: ctx.set,
        })
        if (!session) {
          return new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }

        const store = ctx.store as Partial<AuthedStore>
        store.session = session
        store.userId = session.user.id
      },
    },
    (app) =>
      app
        // Server-Sent Events subscription using async generator + sse()
        .get('/events', async function* ({ request, status, set, store }) {
          try {
            const { userId } = store as AuthedStore

            // Ensure proxies like Nginx don't buffer SSE
            // Must be set before the first yield (Elysia defers headers until first chunk)
            set.headers['x-accel-buffering'] = 'no'
            set.headers['cache-control'] = 'no-cache'

            const q = new AsyncQueue()
            let userSet = subscribers.get(userId)
            if (!userSet) {
              userSet = new Set<AsyncQueue>()
              subscribers.set(userId, userSet)
            }
            userSet.add(q)

            // initial hello and keepalive
            q.push(JSON.stringify({ type: 'connected', ts: Date.now() }))
            const interval = setInterval(() => {
              q.push(JSON.stringify({ type: 'ping', ts: Date.now() }))
            }, 15000)

            try {
              while (!request.signal.aborted) {
                const data = await q.next()
                yield sse(data)
              }
            } finally {
              clearInterval(interval)
              subscribers.get(userId)?.delete(q)
            }
          } catch (err) {
            console.error('Error establishing SSE:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .get(
          '/streak-groups/:groupId',
          async ({ params: { groupId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              const group = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)

              if (group.length === 0) {
                return status(404, { message: 'Group not found' })
              }

              const streaksInGroup = await db
                .select({
                  streak: streaksTable,
                  groupRelation: streakGroupsTable,
                })
                .from(streakGroupsTable)
                .innerJoin(
                  streaksTable,
                  eq(streakGroupsTable.streakId, streaksTable.id),
                )
                .where(
                  and(
                    eq(streakGroupsTable.groupId, groupIdNum),
                    eq(streakGroupsTable.userId, userId),
                  ),
                )
                .orderBy(streakGroupsTable.sortOrder)

              const streakIds = streaksInGroup.map((item) => item.streak.id)
              const streakLogs =
                streakIds.length > 0
                  ? await db
                      .select()
                      .from(streakLogTable)
                      .where(
                        and(
                          inArray(streakLogTable.streakId, streakIds),
                          eq(streakLogTable.userId, userId),
                        ),
                      )
                  : []

              const tasks =
                streakIds.length > 0
                  ? await db
                      .select()
                      .from(tasksTable)
                      .where(
                        and(
                          inArray(tasksTable.streakId, streakIds),
                          eq(tasksTable.userId, userId),
                        ),
                      )
                  : []

              const taskIds = tasks.map((task) => task.id)
              const taskLogs =
                taskIds.length > 0
                  ? await db
                      .select()
                      .from(taskLogTable)
                      .where(
                        and(
                          inArray(taskLogTable.taskId, taskIds),
                          eq(taskLogTable.userId, userId),
                        ),
                      )
                  : []

              // fetch the groups for these tasks to expose their group names
              const taskGroupIds = Array.from(
                new Set(tasks.map((t) => t.groupId)),
              )
              const taskGroups =
                taskGroupIds.length > 0
                  ? await db
                      .select()
                      .from(groupsTable)
                      .where(
                        and(
                          inArray(groupsTable.id, taskGroupIds),
                          eq(groupsTable.userId, userId),
                        ),
                      )
                  : []

              return {
                group: group[0],
                streaks: streaksInGroup.map((item) => ({
                  ...item.streak,
                  sortOrder: item.groupRelation.sortOrder,
                  logs: streakLogs.filter(
                    (log) => log.streakId === item.streak.id,
                  ),
                  tasks: tasks
                    .filter((task) => task.streakId === item.streak.id)
                    .map((task) => ({
                      ...task,
                      groupName: taskGroups.find((g) => g.id === task.groupId)
                        ?.name,
                      logs: taskLogs.filter((log) => log.taskId === task.id),
                    })),
                })),
              }
            } catch (err) {
              console.error('Error fetching streak group data:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .get(
          '/task-groups/:groupId',
          async ({ params: { groupId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              const group = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)

              if (group.length === 0) {
                return status(404, { message: 'Group not found' })
              }

              // Check if this is actually a task group
              if (group[0].type !== 'tasks') {
                return status(400, { message: 'Group is not a task group' })
              }

              const tasks = await db
                .select()
                .from(tasksTable)
                .where(
                  and(
                    eq(tasksTable.groupId, groupIdNum),
                    eq(tasksTable.userId, userId),
                  ),
                )

              const taskIds = tasks.map((task) => task.id)
              const taskLogs =
                taskIds.length > 0
                  ? await db
                      .select()
                      .from(taskLogTable)
                      .where(
                        and(
                          inArray(taskLogTable.taskId, taskIds),
                          eq(taskLogTable.userId, userId),
                        ),
                      )
                      .orderBy(taskLogTable.date, taskLogTable.sortOrder)
                  : []

              // Fetch group notes for this group
              const groupNotes = await db
                .select()
                .from(groupNotesTable)
                .where(
                  and(
                    eq(groupNotesTable.groupId, groupIdNum),
                    eq(groupNotesTable.userId, userId),
                  ),
                )

              // Fetch any pin subgroups under this task group
              const pinGroups = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.group_id, groupIdNum),
                    eq(groupsTable.type, 'pins'),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .orderBy(groupsTable.sortOrder, groupsTable.createdAt)

              const pinGroupIds = pinGroups.map((g) => g.id)
              const pinItems =
                pinGroupIds.length > 0
                  ? await db
                      .select({
                        pin: groupPinsTable,
                        task: tasksTable,
                      })
                      .from(groupPinsTable)
                      .innerJoin(
                        tasksTable,
                        eq(groupPinsTable.taskId, tasksTable.id),
                      )
                      .where(
                        and(
                          inArray(groupPinsTable.groupId, pinGroupIds),
                          eq(groupPinsTable.userId, userId),
                        ),
                      )
                  : []

              const pins = pinGroups.map((pg) => ({
                id: pg.id,
                name: pg.name,
                sortOrder: pg.sortOrder,
                tasks: pinItems
                  .filter((pi) => pi.pin.groupId === pg.id)
                  .sort((a, b) => a.pin.sortOrder - b.pin.sortOrder)
                  .map((pi) => ({
                    id: pi.pin.id,
                    taskId: pi.task.id,
                    task: pi.task.task,
                    extraInfo: pi.pin.extraInfo,
                    sortOrder: pi.pin.sortOrder,
                  })),
              }))

              return {
                group: {
                  ...group[0],
                  viewMode: toViewModeString(group[0].viewMode),
                },
                tasks: tasks.map((task) => ({
                  ...task,
                  logs: taskLogs.filter((log) => log.taskId === task.id),
                })),
                notes: groupNotes.map((note) => ({
                  date: note.date,
                  note: note.note,
                })),
                pins,
              }
            } catch (err) {
              console.error('Error fetching task group data:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .get('/groups', async ({ query, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { type } = query as { type: 'streaks' | 'tasks' }

            if (!type || (type !== 'streaks' && type !== 'tasks')) {
              return status(400, {
                message:
                  'Type parameter is required and must be either "streaks" or "tasks"',
              })
            }

            const groups = await db
              .select()
              .from(groupsTable)
              .where(
                and(eq(groupsTable.type, type), eq(groupsTable.userId, userId)),
              )
              .orderBy(groupsTable.sortOrder, groupsTable.createdAt)

            return {
              groups: groups.map((g) => ({
                ...g,
                viewMode: toViewModeString(g.viewMode),
              })),
            }
          } catch (err) {
            console.error('Error fetching groups:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post(
          '/streaks/:streakId/toggle',
          async ({ params: { streakId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const streakIdNum = parseInt(streakId)
              const { date } = body as { date: string }

              if (Number.isNaN(streakIdNum)) {
                return status(400, { message: 'Invalid streak ID' })
              }

              if (!date || !DATE_RE.test(date)) {
                return status(400, {
                  message: 'Invalid date format. Use YYYY-MM-DD',
                })
              }

              const streak = await db
                .select()
                .from(streaksTable)
                .where(
                  and(
                    eq(streaksTable.id, streakIdNum),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (streak.length === 0) {
                return status(404, { message: 'Streak not found' })
              }
              const existingLog = await db
                .select()
                .from(streakLogTable)
                .where(
                  and(
                    eq(streakLogTable.streakId, streakIdNum),
                    eq(streakLogTable.date, date),
                  ),
                )
                .limit(1)

              let log: typeof streakLogTable.$inferSelect
              if (existingLog.length > 0) {
                // If attempting to toggle from done -> undone, ensure no linked task is done for this date
                if (existingLog[0].done === true) {
                  const linkedTasks = await db
                    .select()
                    .from(tasksTable)
                    .where(
                      and(
                        eq(tasksTable.streakId, streakIdNum),
                        eq(tasksTable.userId, userId),
                      ),
                    )

                  if (linkedTasks.length > 0) {
                    const taskIds = linkedTasks.map((t) => t.id)
                    const blockingTaskLogs =
                      taskIds.length > 0
                        ? await db
                            .select()
                            .from(taskLogTable)
                            .where(
                              and(
                                inArray(taskLogTable.taskId, taskIds),
                                eq(taskLogTable.date, date),
                                eq(taskLogTable.done, true),
                                eq(taskLogTable.userId, userId),
                              ),
                            )
                        : []

                    if (blockingTaskLogs.length > 0) {
                      const blockingTaskIds = new Set(
                        blockingTaskLogs.map((b) => b.taskId),
                      )
                      const blockingTasks = linkedTasks.filter((t) =>
                        blockingTaskIds.has(t.id),
                      )

                      // fetch group names for these tasks
                      const blockingGroupIds = Array.from(
                        new Set(blockingTasks.map((t) => t.groupId)),
                      )
                      const blockingGroups =
                        blockingGroupIds.length > 0
                          ? await db
                              .select()
                              .from(groupsTable)
                              .where(
                                and(
                                  inArray(groupsTable.id, blockingGroupIds),
                                  eq(groupsTable.userId, userId),
                                ),
                              )
                          : []
                      const groupNameById = new Map(
                        blockingGroups.map((g) => [g.id, g.name] as const),
                      )

                      const blockingTaskNames = blockingTasks.map((t) => t.task)
                      const items = blockingTasks.map((t) => ({
                        task: t.task,
                        group: groupNameById.get(t.groupId) || '',
                      }))

                      return status(409, {
                        message:
                          "Can't undo this streak log because it's marked done by task(s): " +
                          blockingTaskNames.join(', ') +
                          '. Undo or remove the task log to remove this streak entry.',
                        tasks: blockingTaskNames,
                        items,
                      })
                    }
                  }
                }
                const [updatedLog] = await db
                  .update(streakLogTable)
                  .set({ done: !existingLog[0].done })
                  .where(
                    and(
                      eq(streakLogTable.streakId, streakIdNum),
                      eq(streakLogTable.date, date),
                    ),
                  )
                  .returning()
                log = updatedLog
              } else {
                const [newLog] = await db
                  .insert(streakLogTable)
                  .values({ userId, streakId: streakIdNum, date, done: true })
                  .returning()
                log = newLog
              }

              // Notify SSE listeners for this user
              broadcast(userId, {
                type: 'streak.log.updated',
                streakId: streakIdNum,
                date,
              })
              return { log }
            } catch (err) {
              console.error('Error toggling streak log:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put(
          '/streaks/:streakId/:date/note',
          async ({ params: { streakId, date }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const streakIdNum = parseInt(streakId)
              const { note } = body as { note: string }

              if (Number.isNaN(streakIdNum)) {
                return status(400, { message: 'Invalid streak ID' })
              }

              if (!date || !DATE_RE.test(date)) {
                return status(400, {
                  message: 'Invalid date format. Use YYYY-MM-DD',
                })
              }

              const streak = await db
                .select()
                .from(streaksTable)
                .where(
                  and(
                    eq(streaksTable.id, streakIdNum),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (streak.length === 0) {
                return status(404, { message: 'Streak not found' })
              }

              const existingLog = await db
                .select()
                .from(streakLogTable)
                .where(
                  and(
                    eq(streakLogTable.streakId, streakIdNum),
                    eq(streakLogTable.date, date),
                  ),
                )
                .limit(1)

              let log: typeof streakLogTable.$inferSelect
              if (existingLog.length > 0) {
                const [updatedLog] = await db
                  .update(streakLogTable)
                  .set({ note: note || null })
                  .where(
                    and(
                      eq(streakLogTable.streakId, streakIdNum),
                      eq(streakLogTable.date, date),
                    ),
                  )
                  .returning()
                log = updatedLog
              } else {
                const [newLog] = await db
                  .insert(streakLogTable)
                  .values({
                    userId,
                    streakId: streakIdNum,
                    date,
                    note: note || null,
                    done: true,
                  })
                  .returning()
                log = newLog
              }

              broadcast(userId, {
                type: 'streak.note.updated',
                streakId: streakIdNum,
                date,
              })
              return { log }
            } catch (err) {
              console.error('Error updating streak log note:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .get('/streaks', async ({ status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const streaks = await db
              .select()
              .from(streaksTable)
              .where(eq(streaksTable.userId, userId))
            return { streaks }
          } catch (err) {
            console.error('Error fetching all streaks:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post('/streaks', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { name } = body as { name: string }

            if (!name || name.trim().length === 0) {
              return status(400, { message: 'Streak name is required' })
            }

            const existingStreak = await db
              .select()
              .from(streaksTable)
              .where(
                and(
                  eq(streaksTable.name, name.trim()),
                  eq(streaksTable.userId, userId),
                ),
              )
              .limit(1)

            if (existingStreak.length > 0) {
              return status(409, {
                message: 'Streak with this name already exists',
              })
            }

            const [newStreak] = await db
              .insert(streaksTable)
              .values({ userId, name: name.trim() })
              .returning()

            return { streak: newStreak }
          } catch (err) {
            console.error('Error creating streak:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .put(
          '/streaks/:streakId',
          async ({ params: { streakId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const streakIdNum = parseInt(streakId)
              const { name } = body as { name: string }

              if (Number.isNaN(streakIdNum)) {
                return status(400, { message: 'Invalid streak ID' })
              }

              if (!name || name.trim().length === 0) {
                return status(400, { message: 'Streak name is required' })
              }

              const existing = await db
                .select()
                .from(streaksTable)
                .where(
                  and(
                    eq(streaksTable.name, name.trim()),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (existing.length > 0 && existing[0].id !== streakIdNum) {
                return status(409, {
                  message: 'Streak with this name already exists',
                })
              }

              const [updated] = await db
                .update(streaksTable)
                .set({ name: name.trim() })
                .where(
                  and(
                    eq(streaksTable.id, streakIdNum),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .returning()

              if (!updated) {
                return status(404, { message: 'Streak not found' })
              }

              // Broadcast that streak metadata changed so UIs can refresh
              broadcast(userId, {
                type: 'streak.meta.updated',
                streakId: streakIdNum,
              })

              return { streak: updated }
            } catch (err) {
              console.error('Error renaming streak:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .patch(
          '/streaks/:streakId/notifications',
          async ({ params: { streakId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const streakIdNum = parseInt(streakId)
              const { enabled } = body as { enabled: boolean }

              if (Number.isNaN(streakIdNum)) {
                return status(400, { message: 'Invalid streak ID' })
              }

              if (typeof enabled !== 'boolean') {
                return status(400, { message: 'enabled must be a boolean' })
              }

              const [updated] = await db
                .update(streaksTable)
                .set({ notificationsEnabled: enabled })
                .where(
                  and(
                    eq(streaksTable.id, streakIdNum),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .returning()

              if (!updated) {
                return status(404, { message: 'Streak not found' })
              }

              broadcast(userId, {
                type: 'streak.meta.updated',
                streakId: streakIdNum,
              })

              return { streak: updated }
            } catch (err) {
              console.error('Error updating streak notifications:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .get('/user/notification-settings', async ({ status, store }) => {
          try {
            const { userId } = store as AuthedStore

            const settings = await db
              .select()
              .from(userNotificationSettingsTable)
              .where(eq(userNotificationSettingsTable.userId, userId))
              .limit(1)

            if (settings.length === 0) {
              // Return default settings if none exist
              return {
                settings: {
                  userId,
                  enabled: true,
                  channels: {},
                  morningTime: '09:00',
                  eveningTime: '20:00',
                  upcomingTasksTime: '09:00',
                  upcomingTasksDays: 7,
                  timezone: 'UTC',
                },
              }
            }

            return { settings: settings[0] }
          } catch (err) {
            console.error('Error fetching notification settings:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .get('/user/notification-deliveries', async ({ status, store }) => {
          try {
            const { userId } = store as AuthedStore

            const deliveries = await db
              .select({
                id: notificationDeliveriesTable.id,
                type: notificationDeliveriesTable.type,
                channel: notificationDeliveriesTable.channel,
                status: notificationDeliveriesTable.status,
                error: notificationDeliveriesTable.error,
                sentAt: notificationDeliveriesTable.sentAt,
              })
              .from(notificationDeliveriesTable)
              .where(eq(notificationDeliveriesTable.userId, userId))
              .orderBy(desc(notificationDeliveriesTable.sentAt))
              .limit(50)

            return {
              deliveries: deliveries.map((delivery) => ({
                ...delivery,
                sentAt: delivery.sentAt.toISOString(),
              })),
            }
          } catch (err) {
            console.error('Error fetching notification deliveries:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .put('/user/notification-settings', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { enabled, channels, morningTime, eveningTime, timezone } =
              body as {
                enabled?: boolean
                channels?: unknown
                morningTime?: string
                eveningTime?: string
                timezone?: string
              }

            // Validate time format (HH:MM)
            const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
            if (morningTime && !timeRegex.test(morningTime)) {
              return status(400, {
                message: 'Invalid morningTime format (use HH:MM)',
              })
            }
            if (eveningTime && !timeRegex.test(eveningTime)) {
              return status(400, {
                message: 'Invalid eveningTime format (use HH:MM)',
              })
            }

            const existing = await db
              .select()
              .from(userNotificationSettingsTable)
              .where(eq(userNotificationSettingsTable.userId, userId))
              .limit(1)

            if (existing.length === 0) {
              // Insert new settings
              const [inserted] = await db
                .insert(userNotificationSettingsTable)
                .values({
                  userId,
                  enabled: enabled ?? true,
                  channels: channels || {},
                  morningTime: morningTime || '09:00',
                  eveningTime: eveningTime || '20:00',
                  timezone: timezone || 'UTC',
                })
                .returning()

              return { settings: inserted }
            } else {
              // Update existing settings
              const [updated] = await db
                .update(userNotificationSettingsTable)
                .set({
                  enabled: enabled ?? existing[0].enabled,
                  channels:
                    channels !== undefined ? channels : existing[0].channels,
                  morningTime: morningTime || existing[0].morningTime,
                  eveningTime: eveningTime || existing[0].eveningTime,
                  timezone: timezone || existing[0].timezone,
                  updatedAt: new Date(),
                })
                .where(eq(userNotificationSettingsTable.userId, userId))
                .returning()

              return { settings: updated }
            }
          } catch (err) {
            console.error('Error updating notification settings:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post('/test-notification', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { type } = body as {
              type?: 'morning' | 'evening' | 'upcoming'
            }

            // Get user email and settings
            const user = await db
              .select()
              .from(usersTable)
              .where(eq(usersTable.id, userId))
              .limit(1)

            if (user.length === 0) {
              return status(404, { message: 'User not found' })
            }

            const settingsResult = await db
              .select()
              .from(userNotificationSettingsTable)
              .where(eq(userNotificationSettingsTable.userId, userId))
              .limit(1)

            if (settingsResult.length === 0) {
              return status(400, {
                message:
                  'Notification settings not configured. Please save settings first.',
              })
            }

            const settings = settingsResult[0]
            const userEmail = user[0].email
            const today = new Date().toISOString().split('T')[0]

            // Create test payload using the same helpers as the scheduler
            let testPayload:
              | MorningTasksPayload
              | EveningStreaksPayload
              | UpcomingTasksPayload

            if (type === 'morning' || !type) {
              // Build realistic morning tasks payload
              testPayload = notificationScheduler.buildMorningTasksPayload(
                userId,
                userEmail,
                today,
                [
                  {
                    id: 1,
                    task: 'Review project documentation',
                    groupId: 1,
                    groupName: 'Work',
                    extraInfo: '2 hours',
                    sortOrder: 1,
                  },
                  {
                    id: 2,
                    task: 'Morning workout',
                    groupId: 2,
                    groupName: 'Health',
                    extraInfo: null,
                    sortOrder: 2,
                  },
                  {
                    id: 3,
                    task: 'Team standup meeting',
                    groupId: 1,
                    groupName: 'Work',
                    extraInfo: '9:00 AM',
                    sortOrder: 3,
                  },
                ],
              )
            } else if (type === 'evening') {
              // Build realistic evening streaks payload
              testPayload = notificationScheduler.buildEveningStreaksPayload(
                userId,
                userEmail,
                today,
                [
                  {
                    id: 1,
                    name: 'Daily Exercise',
                    currentCount: 7,
                    groupId: 1,
                    groupName: 'Health',
                  },
                  {
                    id: 2,
                    name: 'Read for 30 minutes',
                    currentCount: 3,
                    groupId: 2,
                    groupName: 'Personal Development',
                  },
                  {
                    id: 3,
                    name: 'Practice guitar',
                    currentCount: 12,
                    groupId: null,
                    groupName: null,
                  },
                ],
              )
            } else {
              // Build realistic upcoming tasks payload
              const tomorrow = new Date()
              tomorrow.setDate(tomorrow.getDate() + 1)
              const in3days = new Date()
              in3days.setDate(in3days.getDate() + 3)
              const in5days = new Date()
              in5days.setDate(in5days.getDate() + 5)

              testPayload = notificationScheduler.buildUpcomingTasksPayload(
                userId,
                userEmail,
                today,
                settings.upcomingTasksDays,
                [
                  {
                    id: 1,
                    task: 'Client presentation',
                    date: tomorrow.toISOString().split('T')[0],
                    daysUntil: 1,
                    groupId: 1,
                    groupName: 'Work',
                    extraInfo: '2:00 PM - Conference Room A',
                  },
                  {
                    id: 2,
                    task: 'Dentist appointment',
                    date: in3days.toISOString().split('T')[0],
                    daysUntil: 3,
                    groupId: 2,
                    groupName: 'Personal',
                    extraInfo: '10:30 AM',
                  },
                  {
                    id: 3,
                    task: 'Project deadline',
                    date: in5days.toISOString().split('T')[0],
                    daysUntil: 5,
                    groupId: 1,
                    groupName: 'Work',
                    extraInfo: null,
                  },
                ],
              )
            }

            await notificationService.sendNotification(
              userId,
              userEmail,
              settings,
              testPayload,
            )

            return { message: 'Test notification sent successfully' }
          } catch (err) {
            console.error('Error sending test notification:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post(
          '/groups/:groupId/streaks',
          async ({ params: { groupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { streakId, sortOrder } = body as {
                streakId: number
                sortOrder: number
              }

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              const streak = await db
                .select()
                .from(streaksTable)
                .where(
                  and(
                    eq(streaksTable.id, streakId),
                    eq(streaksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (streak.length === 0) {
                return status(404, { message: 'Streak not found' })
              }

              const group = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)

              if (group.length === 0) {
                return status(404, { message: 'Group not found' })
              }

              const existing = await db
                .select()
                .from(streakGroupsTable)
                .where(
                  and(
                    eq(streakGroupsTable.groupId, groupIdNum),
                    eq(streakGroupsTable.streakId, streakId),
                    eq(streakGroupsTable.userId, userId),
                  ),
                )
                .limit(1)

              if (existing.length > 0) {
                return status(409, { message: 'Streak already in group' })
              }

              const [newStreakGroup] = await db
                .insert(streakGroupsTable)
                .values({ userId, groupId: groupIdNum, streakId, sortOrder })
                .returning()

              broadcast(userId, {
                type: 'group.streaks.changed',
                groupId: groupIdNum,
              })
              return { streakGroup: newStreakGroup }
            } catch (err) {
              console.error('Error adding streak to group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .delete(
          '/groups/:groupId/streaks/:streakId',
          async ({ params: { groupId, streakId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const streakIdNum = parseInt(streakId)

              if (Number.isNaN(groupIdNum) || Number.isNaN(streakIdNum)) {
                return status(400, { message: 'Invalid group or streak ID' })
              }

              const deletedStreakGroup = await db
                .delete(streakGroupsTable)
                .where(
                  and(
                    eq(streakGroupsTable.groupId, groupIdNum),
                    eq(streakGroupsTable.streakId, streakIdNum),
                    eq(streakGroupsTable.userId, userId),
                  ),
                )
                .returning()

              if (deletedStreakGroup.length === 0) {
                return status(404, { message: 'Streak not found in group' })
              }

              broadcast(userId, {
                type: 'group.streaks.changed',
                groupId: groupIdNum,
              })
              return { message: 'Streak removed from group successfully' }
            } catch (err) {
              console.error('Error removing streak from group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put(
          '/groups/:groupId/streaks/reorder',
          async ({ params: { groupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { streaks } = body as {
                streaks: { streakId: number; sortOrder: number }[]
              }

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              for (const streak of streaks) {
                await db
                  .update(streakGroupsTable)
                  .set({ sortOrder: streak.sortOrder })
                  .where(
                    and(
                      eq(streakGroupsTable.groupId, groupIdNum),
                      eq(streakGroupsTable.streakId, streak.streakId),
                      eq(streakGroupsTable.userId, userId),
                    ),
                  )
              }

              broadcast(userId, {
                type: 'group.streaks.changed',
                groupId: groupIdNum,
              })
              return { message: 'Streak order updated successfully' }
            } catch (err) {
              console.error('Error updating streak order:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .post('/groups', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { name, type } = body as {
              name: string
              type: 'streaks' | 'tasks'
            }

            if (!name || name.trim().length === 0) {
              return status(400, { message: 'Group name is required' })
            }

            if (!type || (type !== 'streaks' && type !== 'tasks')) {
              return status(400, {
                message:
                  'Group type is required and must be either "streaks" or "tasks"',
              })
            }

            const existingGroup = await db
              .select()
              .from(groupsTable)
              .where(
                and(
                  eq(groupsTable.name, name.trim()),
                  eq(groupsTable.userId, userId),
                ),
              )
              .limit(1)

            if (existingGroup.length > 0) {
              return status(409, {
                message: 'Group with this name already exists',
              })
            }

            const lastGroup = await db
              .select({ maxSortOrder: groupsTable.sortOrder })
              .from(groupsTable)
              .where(eq(groupsTable.userId, userId))
              .orderBy(desc(groupsTable.sortOrder))
              .limit(1)

            const newSortOrder =
              lastGroup.length > 0 ? (lastGroup[0].maxSortOrder || 0) + 1 : 0

            const [newGroup] = await db
              .insert(groupsTable)
              .values({
                userId,
                name: name.trim(),
                type: type,
                sortOrder: newSortOrder,
              })
              .returning()

            broadcast(userId, { type: 'groups.changed', groupType: type })
            return { group: newGroup }
          } catch (err) {
            console.error('Error creating group:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .delete(
          '/groups/:groupId',
          async ({ params: { groupId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              await db
                .delete(streakGroupsTable)
                .where(
                  and(
                    eq(streakGroupsTable.groupId, groupIdNum),
                    eq(streakGroupsTable.userId, userId),
                  ),
                )

              const deletedGroup = await db
                .delete(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .returning()

              if (deletedGroup.length === 0) {
                return status(404, { message: 'Group not found' })
              }

              broadcast(userId, {
                type: 'groups.changed',
                groupType: deletedGroup[0]?.type,
              })
              return {
                message: 'Group deleted successfully',
                group: deletedGroup[0],
              }
            } catch (err) {
              console.error('Error deleting group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put(
          '/groups/:groupId',
          async ({ params: { groupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { name, viewMode, settings } = body as {
                name?: string
                viewMode?: 'table' | 'kanban' | 'calendar'
                settings?: {
                  table?: { showOnlyDaysUntilToday?: boolean }
                  kanban?: { showOnlyDaysUntilToday?: boolean }
                  calendar?: Record<string, unknown>
                }
              }

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }

              // Build the update object with only provided fields
              const updateData: {
                name?: string
                viewMode?: number | null
                settings?: {
                  table?: { showOnlyDaysUntilToday?: boolean }
                  kanban?: { showOnlyDaysUntilToday?: boolean }
                  calendar?: Record<string, unknown>
                }
              } = {}

              if (name !== undefined) {
                if (!name || name.trim().length === 0) {
                  return status(400, { message: 'Group name is required' })
                }

                const existingGroup = await db
                  .select()
                  .from(groupsTable)
                  .where(
                    and(
                      eq(groupsTable.name, name.trim()),
                      eq(groupsTable.userId, userId),
                    ),
                  )
                  .limit(1)

                if (
                  existingGroup.length > 0 &&
                  existingGroup[0].id !== groupIdNum
                ) {
                  return status(409, {
                    message: 'Group with this name already exists',
                  })
                }

                updateData.name = name.trim()
              }

              if (viewMode !== undefined) {
                updateData.viewMode = toViewModeNumber(viewMode)
              }

              if (settings !== undefined) {
                updateData.settings = settings
              }

              // Only update if there's something to update
              if (Object.keys(updateData).length === 0) {
                return status(400, {
                  message: 'No fields to update',
                })
              }

              const [updatedGroup] = await db
                .update(groupsTable)
                .set(updateData)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .returning()

              if (!updatedGroup) {
                return status(404, { message: 'Group not found' })
              }

              broadcast(userId, {
                type: 'group.meta.updated',
                groupId: groupIdNum,
              })
              return {
                group: {
                  ...updatedGroup,
                  viewMode: toViewModeString(updatedGroup.viewMode),
                },
              }
            } catch (err) {
              console.error('Error updating group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put('/groups/reorder', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { groups } = body as {
              groups: { groupId: number; sortOrder: number }[]
            }

            if (!groups || !Array.isArray(groups)) {
              return status(400, { message: 'Invalid groups data' })
            }

            for (const group of groups) {
              await db
                .update(groupsTable)
                .set({ sortOrder: group.sortOrder })
                .where(
                  and(
                    eq(groupsTable.id, group.groupId),
                    eq(groupsTable.userId, userId),
                  ),
                )
            }

            broadcast(userId, { type: 'groups.reordered' })
            return { message: 'Group order updated successfully' }
          } catch (err) {
            console.error('Error updating group order:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post(
          '/tasks/:taskId/log',
          async ({ params: { taskId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const isNew = taskId === 'new'
              const maybeNum = Number.parseInt(taskId)
              const taskIdNum = Number.isNaN(maybeNum) ? null : maybeNum
              const {
                date,
                done,
                extraInfo,
                groupId,
                task: taskName,
                defaultExtraInfo,
                logId,
              } = body as {
                date: string
                done: boolean
                extraInfo?: string | null
                groupId?: number
                task?: string
                defaultExtraInfo?: string | null
                logId?: number
              }

              if (!isNew && (taskIdNum == null || Number.isNaN(taskIdNum))) {
                return status(400, { message: 'Invalid task ID' })
              }
              if (!date || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
                return status(400, {
                  message: 'Invalid date format. Use YYYY-MM-DD',
                })
              }
              if (typeof done !== 'boolean') {
                return status(400, {
                  message: 'Missing or invalid done parameter',
                })
              }
              let taskRow: typeof tasksTable.$inferSelect | undefined
              let createdTask: typeof tasksTable.$inferSelect | undefined

              if (isNew) {
                // Validate creation fields
                if (!groupId || Number.isNaN(Number(groupId))) {
                  return status(400, {
                    message: 'groupId is required for new task',
                  })
                }
                if (
                  !taskName ||
                  typeof taskName !== 'string' ||
                  taskName.trim().length === 0
                ) {
                  return status(400, {
                    message: 'task is required for new task',
                  })
                }

                // Ensure group exists and belongs to user
                const group = await db
                  .select()
                  .from(groupsTable)
                  .where(
                    and(
                      eq(groupsTable.id, groupId),
                      eq(groupsTable.userId, userId),
                    ),
                  )
                  .limit(1)
                if (group.length === 0) {
                  return status(404, { message: 'Group not found' })
                }

                // Find or create the task by name within the group for this user
                const existingTask = await db
                  .select()
                  .from(tasksTable)
                  .where(
                    and(
                      eq(tasksTable.groupId, groupId),
                      eq(tasksTable.task, taskName.trim()),
                      eq(tasksTable.userId, userId),
                    ),
                  )
                  .limit(1)

                if (existingTask.length > 0) {
                  taskRow = existingTask[0]
                } else {
                  const [newTask] = await db
                    .insert(tasksTable)
                    .values({
                      userId,
                      groupId,
                      task: taskName.trim(),
                      defaultExtraInfo: normalizeOptionalText(defaultExtraInfo),
                    })
                    .returning()
                  taskRow = newTask
                  createdTask = newTask
                }
                // taskRow is set
              } else {
                const found = await db
                  .select()
                  .from(tasksTable)
                  .where(
                    and(
                      eq(tasksTable.id, taskIdNum as number),
                      eq(tasksTable.userId, userId),
                    ),
                  )
                  .limit(1)

                if (found.length === 0) {
                  return status(404, { message: 'Task not found' })
                }
                taskRow = found[0]
              }

              let existingLog: (typeof taskLogTable.$inferSelect)[] = []
              if (logId !== undefined && logId !== null) {
                const logIdNum = Number.parseInt(String(logId))
                if (Number.isNaN(logIdNum)) {
                  return status(400, { message: 'Invalid logId' })
                }
                const foundById = await db
                  .select()
                  .from(taskLogTable)
                  .where(
                    and(
                      eq(taskLogTable.id, logIdNum),
                      eq(taskLogTable.userId, userId),
                    ),
                  )
                  .limit(1)
                if (foundById.length === 0) {
                  return status(404, { message: 'Task log not found' })
                }
                existingLog = foundById
              }

              let log: typeof taskLogTable.$inferSelect
              if (existingLog.length > 0) {
                // If done status is unchanged, update only extraInfo (if provided) and preserve sortOrder
                const current = existingLog[0]
                if (current.done === done) {
                  if (extraInfo !== undefined) {
                    const normalized = normalizeOptionalText(extraInfo)
                    const [updatedLog] = await db
                      .update(taskLogTable)
                      .set({ extraInfo: normalized })
                      .where(eq(taskLogTable.id, current.id))
                      .returning()
                    log = updatedLog
                  } else {
                    log = current
                  }
                } else {
                  // Moving across columns: place at end of the target column
                  const lastSortOrder = await db
                    .select({ maxSortOrder: taskLogTable.sortOrder })
                    .from(taskLogTable)
                    .where(
                      and(
                        eq(taskLogTable.date, date),
                        eq(taskLogTable.done, done),
                      ),
                    )
                    .orderBy(desc(taskLogTable.sortOrder))
                    .limit(1)

                  const newSortOrder =
                    lastSortOrder.length > 0
                      ? (lastSortOrder[0].maxSortOrder || 0) + 1
                      : 1

                  const updateFields: Partial<
                    typeof taskLogTable.$inferInsert
                  > = {
                    done,
                    sortOrder: newSortOrder,
                  }
                  if (extraInfo !== undefined) {
                    updateFields.extraInfo = normalizeOptionalText(extraInfo)
                  }

                  const [updatedLog] = await db
                    .update(taskLogTable)
                    .set(updateFields)
                    .where(eq(taskLogTable.id, current.id))
                    .returning()
                  log = updatedLog
                }
              } else {
                // Get the highest sortOrder for this date and done status (across all tasks)
                const lastSortOrder = await db
                  .select({ maxSortOrder: taskLogTable.sortOrder })
                  .from(taskLogTable)
                  .where(
                    and(
                      eq(taskLogTable.date, date),
                      eq(taskLogTable.done, done),
                    ),
                  )
                  .orderBy(desc(taskLogTable.sortOrder))
                  .limit(1)

                const newSortOrder =
                  lastSortOrder.length > 0
                    ? (lastSortOrder[0].maxSortOrder || 0) + 1
                    : 1

                const [newLog] = await db
                  .insert(taskLogTable)
                  .values({
                    userId,
                    taskId: (taskRow as typeof tasksTable.$inferSelect).id,
                    date,
                    done,
                    extraInfo: normalizeOptionalText(extraInfo),
                    sortOrder: newSortOrder,
                  })
                  .returning()
                log = newLog
              }

              // Mirror to streak if linked
              const linkedStreakId = (taskRow as typeof tasksTable.$inferSelect)
                .streakId
              if (linkedStreakId != null) {
                if (done === true) {
                  await ensureStreakDoneForDate(linkedStreakId, date, userId)
                } else {
                  await ensureStreakUndoneForDate(linkedStreakId, date, userId)
                }
              }

              // Broadcast task log change; if a new task was created, include that too
              const payload = {
                type: 'task.log.updated' as const,
                taskId: (taskRow as typeof tasksTable.$inferSelect).id,
                groupId: (taskRow as typeof tasksTable.$inferSelect).groupId,
                date,
                ...(createdTask ? { newTask: createdTask } : {}),
                ...(linkedStreakId != null ? { linkedStreakId } : {}),
              }
              broadcast(userId, payload)
              return createdTask ? { log, task: createdTask } : { log }
            } catch (err) {
              console.error('Error setting task log:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put(
          '/groups/:groupId/:date/note',
          async ({ params: { groupId, date }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { note } = body as { note: string }

              if (Number.isNaN(groupIdNum)) {
                return status(400, { message: 'Invalid group ID' })
              }
              if (!date || !DATE_RE.test(date)) {
                return status(400, {
                  message: 'Invalid date format. Use YYYY-MM-DD',
                })
              }
              if (typeof note !== 'string') {
                return status(400, { message: 'Note is required' })
              }

              // Check if group exists
              const group = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (group.length === 0) {
                return status(404, { message: 'Group not found' })
              }

              // Check if note exists
              const existing = await db
                .select()
                .from(groupNotesTable)
                .where(
                  and(
                    eq(groupNotesTable.groupId, groupIdNum),
                    eq(groupNotesTable.date, date),
                  ),
                )
                .limit(1)

              let result: (typeof existing)[0] | undefined
              if (existing.length > 0) {
                // Update
                const [updated] = await db
                  .update(groupNotesTable)
                  .set({ note })
                  .where(
                    and(
                      eq(groupNotesTable.groupId, groupIdNum),
                      eq(groupNotesTable.date, date),
                    ),
                  )
                  .returning()
                result = updated
              } else {
                // Insert
                const [inserted] = await db
                  .insert(groupNotesTable)
                  .values({ userId, groupId: groupIdNum, date, note })
                  .returning()
                result = inserted
              }
              broadcast(userId, {
                type: 'group.note.updated',
                groupId: groupIdNum,
                date,
              })
              return { note: result }
            } catch (err) {
              console.error('Error updating group note:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .delete(
          '/tasks/logs/:logId',
          async ({ params: { logId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const logIdNum = parseInt(logId)

              if (Number.isNaN(logIdNum)) {
                return status(400, { message: 'Invalid log ID' })
              }

              // Ensure the log exists and belongs to this user
              const existing = await db
                .select()
                .from(taskLogTable)
                .where(
                  and(
                    eq(taskLogTable.id, logIdNum),
                    eq(taskLogTable.userId, userId),
                  ),
                )
                .limit(1)

              if (existing.length === 0) {
                return status(404, { message: 'Task log not found' })
              }

              const taskIdNum = existing[0].taskId
              const date = existing[0].date

              const deleted = await db
                .delete(taskLogTable)
                .where(eq(taskLogTable.id, logIdNum))
                .returning()

              if (deleted.length === 0) {
                return status(404, { message: 'Task log not found' })
              }

              const deletedLog = deleted[0]

              // Fetch the parent task to check streak linkage and group id
              const task = await db
                .select()
                .from(tasksTable)
                .where(
                  and(
                    eq(tasksTable.id, taskIdNum),
                    eq(tasksTable.userId, userId),
                  ),
                )
                .limit(1)

              // If the deleted log was done and this task is linked to a streak, mark the streak as undone for that date
              if (deletedLog?.done === true && task[0]?.streakId != null) {
                await ensureStreakUndoneForDate(task[0].streakId, date, userId)
              }

              // Check if there are any remaining logs for this task (respecting user)
              const remainingLogs = await db
                .select()
                .from(taskLogTable)
                .where(
                  and(
                    eq(taskLogTable.taskId, taskIdNum),
                    eq(taskLogTable.userId, userId),
                  ),
                )
                .limit(1)

              // If no logs remain, delete the task itself (and its pins)
              if (remainingLogs.length === 0) {
                // Remove from group_pins first to avoid FK error
                await db
                  .delete(groupPinsTable)
                  .where(eq(groupPinsTable.taskId, taskIdNum))
                await db.delete(tasksTable).where(eq(tasksTable.id, taskIdNum))
              }

              broadcast(userId, {
                type: 'task.log.deleted',
                taskId: taskIdNum,
                date,
                groupId: task[0]?.groupId,
              })

              return {
                message: 'Task log deleted successfully',
                log: deletedLog,
              }
            } catch (err) {
              console.error('Error deleting task log by id:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put('/tasks/reorder', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore
            const { date, taskLogs } = body as {
              date: string
              taskLogs: { taskId: number; sortOrder: number }[]
            }

            if (!date || !taskLogs || !Array.isArray(taskLogs)) {
              return status(400, { message: 'Invalid request body' })
            }

            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              return status(400, {
                message: 'Invalid date format. Use YYYY-MM-DD',
              })
            }

            // Update sort order for each task log
            for (const { taskId: logTaskId, sortOrder } of taskLogs) {
              await db
                .update(taskLogTable)
                .set({ sortOrder })
                .where(
                  and(
                    eq(taskLogTable.taskId, logTaskId),
                    eq(taskLogTable.date, date),
                    eq(taskLogTable.userId, userId),
                  ),
                )
            }

            broadcast(userId, { type: 'tasks.reordered', date })
            return { message: 'Task logs reordered successfully' }
          } catch (err) {
            console.error('Error reordering task logs:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        // Atomically move a task log across dates/columns and/or reposition relative to another task
        .post('/tasks/move-log', async ({ body, status, store }) => {
          try {
            const { userId } = store as AuthedStore

            const {
              logId,
              fromDate,
              toDate,
              toDone,
              targetLogId,
              position,
              extraInfo,
            } = body as {
              logId: number
              fromDate: string
              toDate: string
              toDone: boolean
              targetLogId?: number
              position?: 'before' | 'after'
              extraInfo?: string | null
            }

            if (!logId || Number.isNaN(Number(logId)))
              return status(400, { message: 'Invalid log ID' })
            if (!fromDate || !DATE_RE.test(fromDate))
              return status(400, { message: 'Invalid fromDate' })
            if (!toDate || !DATE_RE.test(toDate))
              return status(400, { message: 'Invalid toDate' })

            // Load the source log and its task
            const srcLogs = await db
              .select()
              .from(taskLogTable)
              .where(
                and(
                  eq(taskLogTable.id, logId),
                  eq(taskLogTable.userId, userId),
                ),
              )
              .limit(1)
            if (srcLogs.length === 0)
              return status(404, { message: 'Task log not found' })
            const sourceLog = srcLogs[0]
            if (sourceLog.date !== fromDate)
              return status(400, { message: 'fromDate does not match log' })

            const task = await db
              .select()
              .from(tasksTable)
              .where(
                and(
                  eq(tasksTable.id, sourceLog.taskId),
                  eq(tasksTable.userId, userId),
                ),
              )
              .limit(1)
            if (task.length === 0)
              return status(404, { message: 'Task not found' })

            // Helper: load ordered list for a date+done
            const getList = async (date: string, done: boolean) => {
              return await db
                .select()
                .from(taskLogTable)
                .where(
                  and(
                    eq(taskLogTable.date, date),
                    eq(taskLogTable.done, done),
                    eq(taskLogTable.userId, userId),
                  ),
                )
                .orderBy(taskLogTable.sortOrder)
            }

            // Helper: write contiguous sort order for a list of logIds at date+done
            const writeOrder = async (
              date: string,
              done: boolean,
              orderedLogIds: number[],
            ) => {
              for (let i = 0; i < orderedLogIds.length; i++) {
                const id = orderedLogIds[i]
                await db
                  .update(taskLogTable)
                  .set({ sortOrder: i + 1 })
                  .where(
                    and(
                      eq(taskLogTable.id, id),
                      eq(taskLogTable.date, date),
                      eq(taskLogTable.done, done),
                      eq(taskLogTable.userId, userId),
                    ),
                  )
              }
            }

            const sourceDone = sourceLog.done

            const sameDate = fromDate === toDate
            const togglingColumn = sourceLog.done !== toDone

            // Ensure we have a current extraInfo fallback
            const finalExtraInfo =
              extraInfo !== undefined
                ? extraInfo
                : (sourceLog.extraInfo ?? null)

            // When reordering relative to a target, compute the destination order array
            const placeInList = (
              currentOrder: number[],
              sourceLogId: number,
              tgtLogId?: number,
              pos?: 'before' | 'after',
            ) => {
              const arr = currentOrder.filter((id) => id !== sourceLogId)
              if (tgtLogId == null || !arr.includes(tgtLogId)) {
                arr.push(sourceLogId)
                return arr
              }
              const idx = arr.indexOf(tgtLogId)
              const insertAt = pos === 'before' ? idx : idx + 1
              arr.splice(insertAt, 0, sourceLogId)
              return arr
            }

            if (sameDate) {
              if (togglingColumn) {
                // Move from one column to the other on the same date
                // 1) Update the source log's done/extraInfo and set temporary sortOrder
                await db
                  .update(taskLogTable)
                  .set({ done: toDone, extraInfo: finalExtraInfo })
                  .where(
                    and(
                      eq(taskLogTable.id, logId),
                      eq(taskLogTable.userId, userId),
                    ),
                  )

                // Re-pack old column (exclude the moved log)
                const oldList = await getList(fromDate, sourceDone)
                await writeOrder(
                  fromDate,
                  sourceDone,
                  oldList.filter((l) => l.id !== logId).map((l) => l.id),
                )

                // Build target order
                const targetList = await getList(toDate, toDone)
                const ordered = placeInList(
                  targetList.map((l) => l.id),
                  logId,
                  targetLogId,
                  position,
                )
                await writeOrder(toDate, toDone, ordered)
              } else {
                // Same column reorder only
                const list = await getList(toDate, toDone)
                const ordered = placeInList(
                  list.map((l) => l.id),
                  logId,
                  targetLogId,
                  position,
                )
                await writeOrder(toDate, toDone, ordered)
              }

              // mirror streak
              if (task[0].streakId != null) {
                if (toDone === true) {
                  await ensureStreakDoneForDate(
                    task[0].streakId,
                    toDate,
                    userId,
                  )
                } else {
                  await ensureStreakUndoneForDate(
                    task[0].streakId,
                    toDate,
                    userId,
                  )
                }
              }
            } else {
              // Cross-date move
              const srcDone = sourceDone

              // Move the existing log row by updating date/done/extraInfo
              await db
                .update(taskLogTable)
                .set({ date: toDate, done: toDone, extraInfo: finalExtraInfo })
                .where(
                  and(
                    eq(taskLogTable.id, logId),
                    eq(taskLogTable.userId, userId),
                  ),
                )

              // Build destination order on target date+toDone
              const targetList = await getList(toDate, toDone)
              const ordered = placeInList(
                targetList.map((l) => l.id),
                logId,
                targetLogId,
                position,
              )
              await writeOrder(toDate, toDone, ordered)

              // Repack source column on original date
              const srcList = await getList(fromDate, srcDone)
              await writeOrder(
                fromDate,
                srcDone,
                srcList.map((l) => l.id),
              )

              // mirror streak
              if (task[0].streakId != null) {
                if (toDone === true) {
                  await ensureStreakDoneForDate(
                    task[0].streakId,
                    toDate,
                    userId,
                  )
                }
                if (srcDone === true) {
                  await ensureStreakUndoneForDate(
                    task[0].streakId,
                    fromDate,
                    userId,
                  )
                }
              }
            }

            // Return the target log for convenience
            const [resultLog] = await db
              .select()
              .from(taskLogTable)
              .where(
                and(
                  eq(taskLogTable.id, logId),
                  eq(taskLogTable.userId, userId),
                ),
              )
              .limit(1)

            broadcast(userId, {
              type: 'task.log.moved',
              taskId: sourceLog.taskId,
              logId,
              fromDate,
              toDate,
              toDone,
            })
            return { message: 'Moved', log: resultLog }
          } catch (err) {
            console.error('Error moving task log:', err)
            return status(500, { message: 'Internal server error' })
          }
        })
        .post(
          '/groups/:groupId/pin-groups',
          async ({ params: { groupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { name } = body as { name: string }

              if (Number.isNaN(groupIdNum))
                return status(400, { message: 'Invalid group ID' })
              if (!name || name.trim().length === 0)
                return status(400, { message: 'Pin group name is required' })

              // parent must be a task group
              const parent = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (parent.length === 0)
                return status(404, { message: 'Parent group not found' })
              if (parent[0].type !== 'tasks')
                return status(400, {
                  message: 'Pin groups can only be created under task groups',
                })

              // next sort order among pin groups under this parent
              const lastPinGroup = await db
                .select({ maxSortOrder: groupsTable.sortOrder })
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.group_id, groupIdNum),
                    eq(groupsTable.type, 'pins'),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .orderBy(desc(groupsTable.sortOrder))
                .limit(1)
              const newSortOrder =
                lastPinGroup.length > 0
                  ? (lastPinGroup[0].maxSortOrder || 0) + 1
                  : 0

              const [pinGroup] = await db
                .insert(groupsTable)
                .values({
                  userId,
                  name: name.trim(),
                  type: 'pins' as const,
                  group_id: groupIdNum,
                  sortOrder: newSortOrder,
                })
                .returning()

              broadcast(userId, {
                type: 'pins.groups.changed',
                parentGroupId: groupIdNum,
              })
              return { pinGroup }
            } catch (err) {
              console.error('Error creating pin group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .post(
          '/pin-groups/:pinGroupId/tasks',
          async ({ params: { pinGroupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const pinGroupIdNum = parseInt(pinGroupId)
              const { taskId, sortOrder, extraInfo } = body as {
                taskId: number
                sortOrder?: number
                extraInfo?: string
              }

              if (Number.isNaN(pinGroupIdNum))
                return status(400, { message: 'Invalid pin group ID' })
              if (!taskId || Number.isNaN(Number(taskId)))
                return status(400, { message: 'Invalid task ID' })

              const pinGroup = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, pinGroupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (pinGroup.length === 0)
                return status(404, { message: 'Pin group not found' })
              if (pinGroup[0].type !== 'pins')
                return status(400, { message: 'Not a pin group' })

              const task = await db
                .select()
                .from(tasksTable)
                .where(
                  and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)),
                )
                .limit(1)
              if (task.length === 0)
                return status(404, { message: 'Task not found' })

              // Check for duplicate (same taskId and extraInfo combination)
              const normalizedExtraInfo = extraInfo?.trim() || null
              const existing = await db
                .select()
                .from(groupPinsTable)
                .where(
                  and(
                    eq(groupPinsTable.groupId, pinGroupIdNum),
                    eq(groupPinsTable.taskId, taskId),
                    eq(groupPinsTable.userId, userId),
                    normalizedExtraInfo
                      ? eq(groupPinsTable.extraInfo, normalizedExtraInfo)
                      : sql`${groupPinsTable.extraInfo} IS NULL`,
                  ),
                )
                .limit(1)
              if (existing.length > 0)
                return status(409, {
                  message:
                    'Task with this extra info already pinned in this group',
                })

              let finalSortOrder = sortOrder
              if (finalSortOrder == null) {
                const last = await db
                  .select({ maxSortOrder: groupPinsTable.sortOrder })
                  .from(groupPinsTable)
                  .where(
                    and(
                      eq(groupPinsTable.groupId, pinGroupIdNum),
                      eq(groupPinsTable.userId, userId),
                    ),
                  )
                  .orderBy(desc(groupPinsTable.sortOrder))
                  .limit(1)
                finalSortOrder =
                  last.length > 0 ? (last[0].maxSortOrder || 0) + 1 : 0
              }

              const [pin] = await db
                .insert(groupPinsTable)
                .values({
                  userId,
                  groupId: pinGroupIdNum,
                  taskId,
                  extraInfo: normalizedExtraInfo,
                  sortOrder: finalSortOrder,
                })
                .returning()
              return { pin }
            } catch (err) {
              console.error('Error adding task to pin group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .delete(
          '/pin-groups/:pinGroupId/pins/:pinId',
          async ({ params: { pinGroupId, pinId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const pinGroupIdNum = parseInt(pinGroupId)
              const pinIdNum = parseInt(pinId)
              if (Number.isNaN(pinGroupIdNum) || Number.isNaN(pinIdNum))
                return status(400, { message: 'Invalid pin group or pin ID' })

              const deleted = await db
                .delete(groupPinsTable)
                .where(
                  and(
                    eq(groupPinsTable.id, pinIdNum),
                    eq(groupPinsTable.groupId, pinGroupIdNum),
                    eq(groupPinsTable.userId, userId),
                  ),
                )
                .returning()
              if (deleted.length === 0)
                return status(404, { message: 'Pin not found' })
              broadcast(userId, {
                type: 'pins.items.changed',
                pinGroupId: pinGroupIdNum,
              })
              return { message: 'Task unpinned' }
            } catch (err) {
              console.error('Error removing task from pin group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )
        .put(
          '/pin-groups/:pinGroupId/tasks/reorder',
          async ({ params: { pinGroupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const pinGroupIdNum = parseInt(pinGroupId)
              const { items } = body as {
                items: { pinId: number; sortOrder: number }[]
              }
              if (Number.isNaN(pinGroupIdNum))
                return status(400, { message: 'Invalid pin group ID' })
              if (!Array.isArray(items))
                return status(400, { message: 'Invalid items' })

              for (const it of items) {
                await db
                  .update(groupPinsTable)
                  .set({ sortOrder: it.sortOrder })
                  .where(
                    and(
                      eq(groupPinsTable.id, it.pinId),
                      eq(groupPinsTable.groupId, pinGroupIdNum),
                      eq(groupPinsTable.userId, userId),
                    ),
                  )
              }
              broadcast(userId, {
                type: 'pins.items.reordered',
                pinGroupId: pinGroupIdNum,
              })
              return { message: 'Reordered' }
            } catch (err) {
              console.error('Error reordering pin group tasks:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )

        // Rename a pin group
        .put(
          '/pin-groups/:pinGroupId',
          async ({ params: { pinGroupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const pinGroupIdNum = parseInt(pinGroupId)
              const { name } = body as { name: string }

              if (Number.isNaN(pinGroupIdNum))
                return status(400, { message: 'Invalid pin group ID' })
              if (!name || name.trim().length === 0)
                return status(400, { message: 'Name is required' })

              // Ensure target is a pin group
              const existing = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, pinGroupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (existing.length === 0)
                return status(404, { message: 'Pin group not found' })
              if (existing[0].type !== 'pins')
                return status(400, { message: 'Group is not a pin group' })

              // Optional: prevent duplicate names within the same parent
              if (existing[0].group_id != null) {
                const dup = await db
                  .select()
                  .from(groupsTable)
                  .where(
                    and(
                      eq(groupsTable.group_id, existing[0].group_id),
                      eq(groupsTable.type, 'pins'),
                      eq(groupsTable.name, name.trim()),
                      eq(groupsTable.userId, userId),
                    ),
                  )
                  .limit(1)
                if (dup.length > 0 && dup[0].id !== pinGroupIdNum) {
                  return status(409, {
                    message: 'A pin group with this name already exists',
                  })
                }
              }

              const [updated] = await db
                .update(groupsTable)
                .set({ name: name.trim() })
                .where(
                  and(
                    eq(groupsTable.id, pinGroupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .returning()

              broadcast(userId, {
                type: 'pins.group.renamed',
                pinGroupId: pinGroupIdNum,
              })
              return { group: updated }
            } catch (err) {
              console.error('Error renaming pin group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )

        // Delete a pin group (and its pins)
        .delete(
          '/pin-groups/:pinGroupId',
          async ({ params: { pinGroupId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const pinGroupIdNum = parseInt(pinGroupId)
              if (Number.isNaN(pinGroupIdNum))
                return status(400, { message: 'Invalid pin group ID' })

              // Ensure it's a pin group
              const existing = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, pinGroupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (existing.length === 0)
                return status(404, { message: 'Pin group not found' })
              if (existing[0].type !== 'pins')
                return status(400, { message: 'Group is not a pin group' })

              await db
                .delete(groupPinsTable)
                .where(
                  and(
                    eq(groupPinsTable.groupId, pinGroupIdNum),
                    eq(groupPinsTable.userId, userId),
                  ),
                )
              const [deleted] = await db
                .delete(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, pinGroupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .returning()

              broadcast(userId, {
                type: 'pins.group.deleted',
                pinGroupId: pinGroupIdNum,
                parentGroupId: deleted?.group_id,
              })
              return { message: 'Pin group deleted', group: deleted }
            } catch (err) {
              console.error('Error deleting pin group:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )

        .put(
          '/groups/:groupId/pin-groups/reorder',
          async ({ params: { groupId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const groupIdNum = parseInt(groupId)
              const { items } = body as {
                items: { pinGroupId: number; sortOrder: number }[]
              }

              if (Number.isNaN(groupIdNum))
                return status(400, { message: 'Invalid parent group ID' })
              if (!Array.isArray(items))
                return status(400, { message: 'Invalid items' })

              // ensure parent exists and is a task group
              const parent = await db
                .select()
                .from(groupsTable)
                .where(
                  and(
                    eq(groupsTable.id, groupIdNum),
                    eq(groupsTable.userId, userId),
                  ),
                )
                .limit(1)
              if (parent.length === 0)
                return status(404, { message: 'Parent group not found' })
              if (parent[0].type !== 'tasks')
                return status(400, { message: 'Parent must be a task group' })

              for (const it of items) {
                await db
                  .update(groupsTable)
                  .set({ sortOrder: it.sortOrder })
                  .where(
                    and(
                      eq(groupsTable.id, it.pinGroupId),
                      eq(groupsTable.group_id, groupIdNum),
                      eq(groupsTable.type, 'pins'),
                      eq(groupsTable.userId, userId),
                    ),
                  )
              }
              broadcast(userId, {
                type: 'pins.groups.reordered',
                parentGroupId: groupIdNum,
              })
              return { message: 'Pin groups reordered' }
            } catch (err) {
              console.error('Error reordering pin groups:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )

        // Update a task's core fields (name, defaultExtraInfo)
        .put(
          '/tasks/:taskId',
          async ({ params: { taskId }, body, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const taskIdNum = parseInt(taskId)
              if (Number.isNaN(taskIdNum)) {
                return status(400, { message: 'Invalid task ID' })
              }

              const { task, defaultExtraInfo, streakId } = body as {
                task?: string
                defaultExtraInfo?: string | null
                streakId?: number | null
              }

              if (
                (task === undefined || task === null) &&
                defaultExtraInfo === undefined &&
                streakId === undefined
              ) {
                return status(400, { message: 'No fields to update' })
              }

              // Fetch existing task
              const existing = await db
                .select()
                .from(tasksTable)
                .where(
                  and(
                    eq(tasksTable.id, taskIdNum),
                    eq(tasksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (existing.length === 0) {
                return status(404, { message: 'Task not found' })
              }

              const updates: Partial<typeof tasksTable.$inferInsert> = {}

              if (task !== undefined) {
                const trimmed = (task ?? '').trim()
                if (trimmed.length === 0) {
                  return status(400, { message: 'Task name cannot be empty' })
                }

                // Prevent duplicate task names within the same group
                const dup = await db
                  .select()
                  .from(tasksTable)
                  .where(
                    and(
                      eq(tasksTable.groupId, existing[0].groupId),
                      eq(tasksTable.task, trimmed),
                      eq(tasksTable.userId, userId),
                    ),
                  )
                  .limit(1)

                if (dup.length > 0 && dup[0].id !== taskIdNum) {
                  return status(409, {
                    message: 'Task with this name already exists in the group',
                  })
                }

                updates.task = trimmed
              }

              if (defaultExtraInfo !== undefined) {
                const val = defaultExtraInfo
                updates.defaultExtraInfo =
                  val === null || `${val}`.trim() === '' ? null : `${val}`
              }

              if (streakId !== undefined) {
                updates.streakId = streakId === null ? null : streakId
              }

              const [updated] = await db
                .update(tasksTable)
                .set(updates)
                .where(
                  and(
                    eq(tasksTable.id, taskIdNum),
                    eq(tasksTable.userId, userId),
                  ),
                )
                .returning()

              broadcast(userId, {
                type: 'task.updated',
                taskId: taskIdNum,
                groupId: updated.groupId,
              })
              return { task: updated }
            } catch (err) {
              console.error('Error updating task:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        )

        // Fill any missing streak logs for dates where a task was marked done but the
        // linked streak has no entry. Returns the list of dates that were added.
        .post(
          '/tasks/:taskId/fill-missing-streaks',
          async ({ params: { taskId }, status, store }) => {
            try {
              const { userId } = store as AuthedStore
              const taskIdNum = parseInt(taskId)

              if (Number.isNaN(taskIdNum)) {
                return status(400, { message: 'Invalid task ID' })
              }

              const found = await db
                .select()
                .from(tasksTable)
                .where(
                  and(
                    eq(tasksTable.id, taskIdNum),
                    eq(tasksTable.userId, userId),
                  ),
                )
                .limit(1)

              if (found.length === 0) {
                return status(404, { message: 'Task not found' })
              }

              const taskRow = found[0]
              const linkedStreakId = taskRow.streakId
              if (linkedStreakId == null) {
                return status(400, {
                  message: 'Task is not linked to a streak',
                })
              }

              // Get distinct dates where this task has a done log
              const rows = await db
                .select({ date: taskLogTable.date })
                .from(taskLogTable)
                .where(
                  and(
                    eq(taskLogTable.taskId, taskIdNum),
                    eq(taskLogTable.done, true),
                    eq(taskLogTable.userId, userId),
                  ),
                )
                .orderBy(taskLogTable.date)

              const dates = Array.from(new Set(rows.map((r) => r.date)))
              const added: string[] = []

              for (const date of dates) {
                const existing = await db
                  .select()
                  .from(streakLogTable)
                  .where(
                    and(
                      eq(streakLogTable.streakId, linkedStreakId),
                      eq(streakLogTable.date, date),
                    ),
                  )
                  .limit(1)

                if (existing.length === 0) {
                  await db
                    .insert(streakLogTable)
                    .values({
                      userId,
                      streakId: linkedStreakId,
                      date,
                      done: true,
                    })
                    .returning()
                  added.push(date)
                  broadcast(userId, {
                    type: 'streak.log.updated',
                    streakId: linkedStreakId,
                    date,
                  })
                } else if (!existing[0].done) {
                  await db
                    .update(streakLogTable)
                    .set({ done: true })
                    .where(
                      and(
                        eq(streakLogTable.streakId, linkedStreakId),
                        eq(streakLogTable.date, date),
                      ),
                    )
                  added.push(date)
                  broadcast(userId, {
                    type: 'streak.log.updated',
                    streakId: linkedStreakId,
                    date,
                  })
                }
              }

              return {
                added: added.map((d) => ({ date: d, task: taskRow.task })),
              }
            } catch (err) {
              console.error('Error filling missing streak logs:', err)
              return status(500, { message: 'Internal server error' })
            }
          },
        ),
  )

const app = new Elysia()
  .use(
    staticPlugin({
      assets: 'ui/dist',
      prefix: '/public',
      indexHTML: false,
    }),
  )
  .use(api)
  .onError(({ code, request }) => {
    if (code === 'NOT_FOUND') {
      const { pathname } = new URL(request.url)
      if (!pathname.startsWith('/api') && !pathname.startsWith('/public')) {
        return Bun.file('ui/dist/index.html')
      }
    }
  })
  .listen({
    port: 9008,
    idleTimeout: 30,
  })

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
)

// Start notification scheduler
notificationScheduler.start()
