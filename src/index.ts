import { cors } from '@elysiajs/cors'
import { and, desc, eq, inArray } from 'drizzle-orm'
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
      const groups = await db
        .select()
        .from(groupsTable)
        .orderBy(groupsTable.sortOrder, groupsTable.createdAt)
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

// Additional endpoints for managing group streaks
app
  .get('/streaks', async ({ error }) => {
    try {
      const streaks = await db.select().from(streaksTable)
      return { streaks }
    } catch (err) {
      console.error('Error fetching all streaks:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .post('/streaks', async ({ body, error }) => {
    try {
      const { name } = body as { name: string }

      if (!name || name.trim().length === 0) {
        return error(400, { message: 'Streak name is required' })
      }

      // Check if streak with same name already exists
      const existingStreak = await db
        .select()
        .from(streaksTable)
        .where(eq(streaksTable.name, name.trim()))
        .limit(1)

      if (existingStreak.length > 0) {
        return error(409, { message: 'Streak with this name already exists' })
      }

      const [newStreak] = await db
        .insert(streaksTable)
        .values({ name: name.trim() })
        .returning()

      return { streak: newStreak }
    } catch (err) {
      console.error('Error creating streak:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .post(
    '/groups/:groupId/streaks',
    async ({ params: { groupId }, body, error }) => {
      try {
        const groupIdNum = parseInt(groupId)
        const { streakId, sortOrder } = body as {
          streakId: number
          sortOrder: number
        }

        if (Number.isNaN(groupIdNum)) {
          return error(400, { message: 'Invalid group ID' })
        }

        // Check if streak exists
        const streak = await db
          .select()
          .from(streaksTable)
          .where(eq(streaksTable.id, streakId))
          .limit(1)

        if (streak.length === 0) {
          return error(404, { message: 'Streak not found' })
        }

        // Check if group exists
        const group = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, groupIdNum))
          .limit(1)

        if (group.length === 0) {
          return error(404, { message: 'Group not found' })
        }

        // Check if streak is already in group
        const existing = await db
          .select()
          .from(streakGroupsTable)
          .where(
            and(
              eq(streakGroupsTable.groupId, groupIdNum),
              eq(streakGroupsTable.streakId, streakId),
            ),
          )
          .limit(1)

        if (existing.length > 0) {
          return error(409, { message: 'Streak already in group' })
        }

        const [newStreakGroup] = await db
          .insert(streakGroupsTable)
          .values({
            groupId: groupIdNum,
            streakId,
            sortOrder,
          })
          .returning()

        return { streakGroup: newStreakGroup }
      } catch (err) {
        console.error('Error adding streak to group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

app.delete(
  '/groups/:groupId/streaks/:streakId',
  async ({ params: { groupId, streakId }, error }) => {
    try {
      const groupIdNum = parseInt(groupId)
      const streakIdNum = parseInt(streakId)

      if (Number.isNaN(groupIdNum) || Number.isNaN(streakIdNum)) {
        return error(400, { message: 'Invalid group or streak ID' })
      }

      const deletedStreakGroup = await db
        .delete(streakGroupsTable)
        .where(
          and(
            eq(streakGroupsTable.groupId, groupIdNum),
            eq(streakGroupsTable.streakId, streakIdNum),
          ),
        )
        .returning()

      if (deletedStreakGroup.length === 0) {
        return error(404, { message: 'Streak not found in group' })
      }

      return { message: 'Streak removed from group successfully' }
    } catch (err) {
      console.error('Error removing streak from group:', err)
      return error(500, { message: 'Internal server error' })
    }
  },
)

app.put(
  '/groups/:groupId/streaks/reorder',
  async ({ params: { groupId }, body, error }) => {
    try {
      const groupIdNum = parseInt(groupId)
      const { streaks } = body as {
        streaks: { streakId: number; sortOrder: number }[]
      }

      if (Number.isNaN(groupIdNum)) {
        return error(400, { message: 'Invalid group ID' })
      }

      // Update each streak's sort order
      for (const streak of streaks) {
        await db
          .update(streakGroupsTable)
          .set({ sortOrder: streak.sortOrder })
          .where(
            and(
              eq(streakGroupsTable.groupId, groupIdNum),
              eq(streakGroupsTable.streakId, streak.streakId),
            ),
          )
      }

      return { message: 'Streak order updated successfully' }
    } catch (err) {
      console.error('Error updating streak order:', err)
      return error(500, { message: 'Internal server error' })
    }
  },
)

// Group CRUD operations
app
  .post('/groups', async ({ body, error }) => {
    try {
      const { name } = body as { name: string }

      if (!name || name.trim().length === 0) {
        return error(400, { message: 'Group name is required' })
      }

      // Check if group with same name already exists
      const existingGroup = await db
        .select()
        .from(groupsTable)
        .where(eq(groupsTable.name, name.trim()))
        .limit(1)

      if (existingGroup.length > 0) {
        return error(409, { message: 'Group with this name already exists' })
      }

      // Get the highest sort order to append the new group at the end
      const lastGroup = await db
        .select({ maxSortOrder: groupsTable.sortOrder })
        .from(groupsTable)
        .orderBy(desc(groupsTable.sortOrder))
        .limit(1)

      const newSortOrder =
        lastGroup.length > 0 ? (lastGroup[0].maxSortOrder || 0) + 1 : 0

      const [newGroup] = await db
        .insert(groupsTable)
        .values({
          name: name.trim(),
          sortOrder: newSortOrder,
        })
        .returning()

      return { group: newGroup }
    } catch (err) {
      console.error('Error creating group:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .delete('/groups/:groupId', async ({ params: { groupId }, error }) => {
    try {
      const groupIdNum = parseInt(groupId)

      if (Number.isNaN(groupIdNum)) {
        return error(400, { message: 'Invalid group ID' })
      }

      // First remove all streak associations with this group
      await db
        .delete(streakGroupsTable)
        .where(eq(streakGroupsTable.groupId, groupIdNum))

      // Then delete the group itself
      const deletedGroup = await db
        .delete(groupsTable)
        .where(eq(groupsTable.id, groupIdNum))
        .returning()

      if (deletedGroup.length === 0) {
        return error(404, { message: 'Group not found' })
      }

      return { message: 'Group deleted successfully', group: deletedGroup[0] }
    } catch (err) {
      console.error('Error deleting group:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .put('/groups/:groupId', async ({ params: { groupId }, body, error }) => {
    try {
      const groupIdNum = parseInt(groupId)
      const { name } = body as { name: string }

      if (Number.isNaN(groupIdNum)) {
        return error(400, { message: 'Invalid group ID' })
      }

      if (!name || name.trim().length === 0) {
        return error(400, { message: 'Group name is required' })
      }

      // Check if another group with the same name already exists (excluding current group)
      const existingGroup = await db
        .select()
        .from(groupsTable)
        .where(eq(groupsTable.name, name.trim()))
        .limit(1)

      if (existingGroup.length > 0 && existingGroup[0].id !== groupIdNum) {
        return error(409, { message: 'Group with this name already exists' })
      }

      if (existingGroup.length > 0) {
        return error(409, { message: 'Group with this name already exists' })
      }

      const [updatedGroup] = await db
        .update(groupsTable)
        .set({ name: name.trim() })
        .where(eq(groupsTable.id, groupIdNum))
        .returning()

      if (!updatedGroup) {
        return error(404, { message: 'Group not found' })
      }

      return { group: updatedGroup }
    } catch (err) {
      console.error('Error updating group:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .put('/groups/reorder', async ({ body, error }) => {
    try {
      const { groups } = body as {
        groups: { groupId: number; sortOrder: number }[]
      }

      if (!groups || !Array.isArray(groups)) {
        return error(400, { message: 'Invalid groups data' })
      }

      // Update each group's sort order
      for (const group of groups) {
        await db
          .update(groupsTable)
          .set({ sortOrder: group.sortOrder })
          .where(eq(groupsTable.id, group.groupId))
      }

      return { message: 'Group order updated successfully' }
    } catch (err) {
      console.error('Error updating group order:', err)
      return error(500, { message: 'Internal server error' })
    }
  })

app.listen(9008)

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
)
