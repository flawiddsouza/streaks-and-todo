import { cors } from '@elysiajs/cors'
import { and, eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { db } from './db'
import {
  groupsTable,
  streakGroupsTable,
  streakLogTable,
  streaksTable,
  taskLogTable,
  tasksTable,
} from './db/schema'

const app = new Elysia()
  .use(cors())
  .get('/', () => 'Hello Elysia')
  .get('/streak-groups/:groupId', async ({ params: { groupId }, error }) => {
    try {
      const groupIdNum = parseInt(groupId)

      if (Number.isNaN(groupIdNum)) {
        return error(400, { message: 'Invalid group ID' })
      }

      const group = await db
        .select()
        .from(groupsTable)
        .where(eq(groupsTable.id, groupIdNum))
        .limit(1)

      if (group.length === 0) {
        return error(404, { message: 'Group not found' })
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
        .where(eq(streakGroupsTable.groupId, groupIdNum))
        .orderBy(streakGroupsTable.sortOrder)

      const streakIds = streaksInGroup.map((item) => item.streak.id)
      const streakLogs =
        streakIds.length > 0
          ? await db
              .select()
              .from(streakLogTable)
              .where(inArray(streakLogTable.streakId, streakIds))
          : []

      const tasks =
        streakIds.length > 0
          ? await db
              .select()
              .from(tasksTable)
              .where(inArray(tasksTable.streakId, streakIds))
          : []

      const taskIds = tasks.map((task) => task.id)
      const taskLogs =
        taskIds.length > 0
          ? await db
              .select()
              .from(taskLogTable)
              .where(inArray(taskLogTable.taskId, taskIds))
          : []

      return {
        group: group[0],
        streaks: streaksInGroup.map((item) => ({
          ...item.streak,
          sortOrder: item.groupRelation.sortOrder,
          logs: streakLogs.filter((log) => log.streakId === item.streak.id),
          tasks: tasks
            .filter((task) => task.streakId === item.streak.id)
            .map((task) => ({
              ...task,
              logs: taskLogs.filter((log) => log.taskId === task.id),
            })),
        })),
      }
    } catch (err) {
      console.error('Error fetching streak group data:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .get('/groups', async ({ error }) => {
    try {
      const groups = await db.select().from(groupsTable)
      return { groups }
    } catch (err) {
      console.error('Error fetching groups:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .post('/streaks/:streakId', async ({ params: { streakId }, body, error }) => {
    try {
      const streakIdNum = parseInt(streakId)
      const { date, note } = body as { date: string; note?: string }

      if (Number.isNaN(streakIdNum)) {
        return error(400, { message: 'Invalid streak ID' })
      }

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
      }

      // Check if streak exists
      const streak = await db
        .select()
        .from(streaksTable)
        .where(eq(streaksTable.id, streakIdNum))
        .limit(1)

      if (streak.length === 0) {
        return error(404, { message: 'Streak not found' })
      }

      // Check if log already exists for this date
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

      if (existingLog.length > 0) {
        return error(409, { message: 'Log already exists for this date' })
      }

      const [newLog] = await db
        .insert(streakLogTable)
        .values({
          streakId: streakIdNum,
          date,
          note: note || null,
        })
        .returning()

      return { log: newLog }
    } catch (err) {
      console.error('Error creating streak log:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .delete(
    '/streaks/:streakId/:date',
    async ({ params: { streakId, date }, error }) => {
      try {
        const streakIdNum = parseInt(streakId)

        if (Number.isNaN(streakIdNum)) {
          return error(400, { message: 'Invalid streak ID' })
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }

        const deletedLog = await db
          .delete(streakLogTable)
          .where(
            and(
              eq(streakLogTable.streakId, streakIdNum),
              eq(streakLogTable.date, date),
            ),
          )
          .returning()

        if (deletedLog.length === 0) {
          return error(404, { message: 'Log not found' })
        }

        return { message: 'Log deleted successfully', log: deletedLog[0] }
      } catch (err) {
        console.error('Error deleting streak log:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .listen(9008)

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
)
