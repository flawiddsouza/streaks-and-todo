import { cors } from '@elysiajs/cors'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { db } from './db'
import {
  groupNotesTable,
  groupPinsTable,
  groupsTable,
  streakGroupsTable,
  streakLogTable,
  streaksTable,
  taskLogTable,
  tasksTable,
} from './db/schema'

// When a task is marked done and it's linked to a streak, ensure the streak has a done log for the same date.
async function ensureStreakDoneForDate(streakId: number, date: string) {
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
    }
  } else {
    await db
      .insert(streakLogTable)
      .values({ streakId, date, done: true })
      .returning()
  }
}

// When a task is moved to undone and it's linked to a streak, clear the streak for that date.
async function ensureStreakUndoneForDate(streakId: number, date: string) {
  const existing = await db
    .select()
    .from(streakLogTable)
    .where(
      and(eq(streakLogTable.streakId, streakId), eq(streakLogTable.date, date)),
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
    }
  }
}

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

      // fetch the groups for these tasks to expose their group names
      const taskGroupIds = Array.from(new Set(tasks.map((t) => t.groupId)))
      const taskGroups =
        taskGroupIds.length > 0
          ? await db
              .select()
              .from(groupsTable)
              .where(inArray(groupsTable.id, taskGroupIds))
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
              groupName: taskGroups.find((g) => g.id === task.groupId)?.name,
              logs: taskLogs.filter((log) => log.taskId === task.id),
            })),
        })),
      }
    } catch (err) {
      console.error('Error fetching streak group data:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .get('/task-groups/:groupId', async ({ params: { groupId }, error }) => {
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

      // Check if this is actually a task group
      if (group[0].type !== 'tasks') {
        return error(400, { message: 'Group is not a task group' })
      }

      const tasks = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.groupId, groupIdNum))

      const taskIds = tasks.map((task) => task.id)
      const taskLogs =
        taskIds.length > 0
          ? await db
              .select()
              .from(taskLogTable)
              .where(inArray(taskLogTable.taskId, taskIds))
              .orderBy(taskLogTable.date, taskLogTable.sortOrder)
          : []

      // Fetch group notes for this group
      const groupNotes = await db
        .select()
        .from(groupNotesTable)
        .where(eq(groupNotesTable.groupId, groupIdNum))

      // Fetch any pin subgroups under this task group
      const pinGroups = await db
        .select()
        .from(groupsTable)
        .where(
          and(
            eq(groupsTable.group_id, groupIdNum),
            eq(groupsTable.type, 'pins'),
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
              .innerJoin(tasksTable, eq(groupPinsTable.taskId, tasksTable.id))
              .where(inArray(groupPinsTable.groupId, pinGroupIds))
          : []

      const pins = pinGroups.map((pg) => ({
        id: pg.id,
        name: pg.name,
        sortOrder: pg.sortOrder,
        tasks: pinItems
          .filter((pi) => pi.pin.groupId === pg.id)
          .sort((a, b) => a.pin.sortOrder - b.pin.sortOrder)
          .map((pi) => ({
            taskId: pi.task.id,
            task: pi.task.task,
            sortOrder: pi.pin.sortOrder,
          })),
      }))

      return {
        group: group[0],
        tasks: tasks.map((task) => ({
          ...task,
          logs: taskLogs.filter((log) => log.taskId === task.id),
        })),
        notes: groupNotes.map((note) => ({ date: note.date, note: note.note })),
        pins,
      }
    } catch (err) {
      console.error('Error fetching task group data:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .get('/groups', async ({ query, error }) => {
    try {
      const { type } = query as { type: 'streaks' | 'tasks' }

      if (!type || (type !== 'streaks' && type !== 'tasks')) {
        return error(400, {
          message:
            'Type parameter is required and must be either "streaks" or "tasks"',
        })
      }

      const groups = await db
        .select()
        .from(groupsTable)
        .where(eq(groupsTable.type, type))
        .orderBy(groupsTable.sortOrder, groupsTable.createdAt)

      return { groups }
    } catch (err) {
      console.error('Error fetching groups:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .post(
    '/streaks/:streakId/toggle',
    async ({ params: { streakId }, body, error }) => {
      try {
        const streakIdNum = parseInt(streakId)
        const { date } = body as { date: string }

        if (Number.isNaN(streakIdNum)) {
          return error(400, { message: 'Invalid streak ID' })
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }

        const streak = await db
          .select()
          .from(streaksTable)
          .where(eq(streaksTable.id, streakIdNum))
          .limit(1)

        if (streak.length === 0) {
          return error(404, { message: 'Streak not found' })
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
              .where(eq(tasksTable.streakId, streakIdNum))

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
                        .where(inArray(groupsTable.id, blockingGroupIds))
                    : []
                const groupNameById = new Map(
                  blockingGroups.map((g) => [g.id, g.name] as const),
                )

                const blockingTaskNames = blockingTasks.map((t) => t.task)
                const items = blockingTasks.map((t) => ({
                  task: t.task,
                  group: groupNameById.get(t.groupId) || '',
                }))

                return error(409, {
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
            .values({
              streakId: streakIdNum,
              date,
              done: true,
            })
            .returning()
          log = newLog
        }

        return { log }
      } catch (err) {
        console.error('Error toggling streak log:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .put(
    '/streaks/:streakId/:date/note',
    async ({ params: { streakId, date }, body, error }) => {
      try {
        const streakIdNum = parseInt(streakId)
        const { note } = body as { note: string }

        if (Number.isNaN(streakIdNum)) {
          return error(400, { message: 'Invalid streak ID' })
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }

        const streak = await db
          .select()
          .from(streaksTable)
          .where(eq(streaksTable.id, streakIdNum))
          .limit(1)

        if (streak.length === 0) {
          return error(404, { message: 'Streak not found' })
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
              streakId: streakIdNum,
              date,
              note: note || null,
              done: true,
            })
            .returning()
          log = newLog
        }

        return { log }
      } catch (err) {
        console.error('Error updating streak log note:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

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

        const streak = await db
          .select()
          .from(streaksTable)
          .where(eq(streaksTable.id, streakId))
          .limit(1)

        if (streak.length === 0) {
          return error(404, { message: 'Streak not found' })
        }

        const group = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, groupIdNum))
          .limit(1)

        if (group.length === 0) {
          return error(404, { message: 'Group not found' })
        }

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

app
  .post('/groups', async ({ body, error }) => {
    try {
      const { name, type } = body as { name: string; type: 'streaks' | 'tasks' }

      if (!name || name.trim().length === 0) {
        return error(400, { message: 'Group name is required' })
      }

      if (!type || (type !== 'streaks' && type !== 'tasks')) {
        return error(400, {
          message:
            'Group type is required and must be either "streaks" or "tasks"',
        })
      }

      const existingGroup = await db
        .select()
        .from(groupsTable)
        .where(eq(groupsTable.name, name.trim()))
        .limit(1)

      if (existingGroup.length > 0) {
        return error(409, { message: 'Group with this name already exists' })
      }

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
          type: type,
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

      await db
        .delete(streakGroupsTable)
        .where(eq(streakGroupsTable.groupId, groupIdNum))

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
  .post('/tasks/:taskId/log', async ({ params: { taskId }, body, error }) => {
    try {
      const taskIdNum = parseInt(taskId)
      const { date, done } = body as { date: string; done: boolean }

      if (Number.isNaN(taskIdNum)) {
        return error(400, { message: 'Invalid task ID' })
      }
      if (!date || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
      }
      if (typeof done !== 'boolean') {
        return error(400, { message: 'Missing or invalid done parameter' })
      }

      const task = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskIdNum))
        .limit(1)

      if (task.length === 0) {
        return error(404, { message: 'Task not found' })
      }

      const existingLog = await db
        .select()
        .from(taskLogTable)
        .where(
          and(eq(taskLogTable.taskId, taskIdNum), eq(taskLogTable.date, date)),
        )
        .limit(1)

      let log: typeof taskLogTable.$inferSelect
      if (existingLog.length > 0) {
        // Get the highest sortOrder for this date and done status (across all tasks)
        const lastSortOrder = await db
          .select({ maxSortOrder: taskLogTable.sortOrder })
          .from(taskLogTable)
          .where(and(eq(taskLogTable.date, date), eq(taskLogTable.done, done)))
          .orderBy(desc(taskLogTable.sortOrder))
          .limit(1)

        const newSortOrder =
          lastSortOrder.length > 0
            ? (lastSortOrder[0].maxSortOrder || 0) + 1
            : 1

        // Set done status and update sortOrder to place at end of new list
        const [updatedLog] = await db
          .update(taskLogTable)
          .set({ done, sortOrder: newSortOrder })
          .where(
            and(
              eq(taskLogTable.taskId, taskIdNum),
              eq(taskLogTable.date, date),
            ),
          )
          .returning()
        log = updatedLog
      } else {
        // Get the highest sortOrder for this date and done status (across all tasks)
        const lastSortOrder = await db
          .select({ maxSortOrder: taskLogTable.sortOrder })
          .from(taskLogTable)
          .where(and(eq(taskLogTable.date, date), eq(taskLogTable.done, done)))
          .orderBy(desc(taskLogTable.sortOrder))
          .limit(1)

        const newSortOrder =
          lastSortOrder.length > 0
            ? (lastSortOrder[0].maxSortOrder || 0) + 1
            : 1

        const [newLog] = await db
          .insert(taskLogTable)
          .values({
            taskId: taskIdNum,
            date,
            done,
            sortOrder: newSortOrder,
          })
          .returning()
        log = newLog
      }

      // Mirror to streak if linked
      if (task[0].streakId != null) {
        if (done === true) {
          await ensureStreakDoneForDate(task[0].streakId, date)
        } else {
          await ensureStreakUndoneForDate(task[0].streakId, date)
        }
      }

      return { log }
    } catch (err) {
      console.error('Error setting task log:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  .put(
    '/tasks/:taskId/:date/note',
    async ({ params: { taskId, date }, body, error }) => {
      try {
        const taskIdNum = parseInt(taskId)
        const { extraInfo } = body as { extraInfo: string }

        if (Number.isNaN(taskIdNum)) {
          return error(400, { message: 'Invalid task ID' })
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }

        const task = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, taskIdNum))
          .limit(1)

        if (task.length === 0) {
          return error(404, { message: 'Task not found' })
        }

        const existingLog = await db
          .select()
          .from(taskLogTable)
          .where(
            and(
              eq(taskLogTable.taskId, taskIdNum),
              eq(taskLogTable.date, date),
            ),
          )
          .limit(1)

        let log: typeof taskLogTable.$inferSelect
        if (existingLog.length > 0) {
          const [updatedLog] = await db
            .update(taskLogTable)
            .set({ extraInfo: extraInfo || null })
            .where(
              and(
                eq(taskLogTable.taskId, taskIdNum),
                eq(taskLogTable.date, date),
              ),
            )
            .returning()
          log = updatedLog
        } else {
          // Get the highest sortOrder for this task and date
          const lastSortOrder = await db
            .select({ maxSortOrder: taskLogTable.sortOrder })
            .from(taskLogTable)
            .where(
              and(
                eq(taskLogTable.taskId, taskIdNum),
                eq(taskLogTable.date, date),
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
              taskId: taskIdNum,
              date,
              extraInfo: extraInfo || null,
              done: true,
              sortOrder: newSortOrder,
            })
            .returning()
          log = newLog

          // Newly creating a done log for a task that's linked to a streak → mirror into streak_log
          if (task[0].streakId != null) {
            await ensureStreakDoneForDate(task[0].streakId, date)
          }
        }

        return { log }
      } catch (err) {
        console.error('Error updating task log note:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .put(
    '/groups/:groupId/:date/note',
    async ({ params: { groupId, date }, body, error }) => {
      try {
        const groupIdNum = parseInt(groupId)
        const { note } = body as { note: string }

        if (Number.isNaN(groupIdNum)) {
          return error(400, { message: 'Invalid group ID' })
        }
        if (!date || !/\d{4}-\d{2}-\d{2}/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }
        if (typeof note !== 'string') {
          return error(400, { message: 'Note is required' })
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
            .values({ groupId: groupIdNum, date, note })
            .returning()
          result = inserted
        }
        return { note: result }
      } catch (err) {
        console.error('Error updating group note:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .post(
    '/groups/:groupId/tasks',
    async ({ params: { groupId }, body, error }) => {
      try {
        const groupIdNum = parseInt(groupId)
        const { task, defaultExtraInfo } = body as {
          task: string
          defaultExtraInfo?: string
        }

        if (Number.isNaN(groupIdNum)) {
          return error(400, { message: 'Invalid group ID' })
        }
        if (!task || typeof task !== 'string' || task.trim().length === 0) {
          return error(400, { message: 'Task name is required' })
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

        // Check for duplicate task in group
        const existing = await db
          .select()
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.groupId, groupIdNum),
              eq(tasksTable.task, task.trim()),
            ),
          )
          .limit(1)
        if (existing.length > 0) {
          return error(409, { message: 'Task already exists in this group' })
        }

        const [newTask] = await db
          .insert(tasksTable)
          .values({
            groupId: groupIdNum,
            task: task.trim(),
            defaultExtraInfo: defaultExtraInfo || null,
          })
          .returning()

        return { task: newTask }
      } catch (err) {
        console.error('Error creating task:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .delete(
    '/tasks/:taskId/:date/log',
    async ({ params: { taskId, date }, error }) => {
      try {
        const taskIdNum = parseInt(taskId)

        if (Number.isNaN(taskIdNum)) {
          return error(400, { message: 'Invalid task ID' })
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
        }

        const task = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, taskIdNum))
          .limit(1)

        if (task.length === 0) {
          return error(404, { message: 'Task not found' })
        }

        const deletedLog = await db
          .delete(taskLogTable)
          .where(
            and(
              eq(taskLogTable.taskId, taskIdNum),
              eq(taskLogTable.date, date),
            ),
          )
          .returning()

        if (deletedLog.length === 0) {
          return error(404, { message: 'Task log not found' })
        }

        // If the deleted log was done and this task is linked to a streak, mark the streak as undone for that date
        if (deletedLog[0]?.done === true && task[0]?.streakId != null) {
          await ensureStreakUndoneForDate(task[0].streakId, date)
        }

        // Check if there are any remaining logs for this task
        const remainingLogs = await db
          .select()
          .from(taskLogTable)
          .where(eq(taskLogTable.taskId, taskIdNum))
          .limit(1)

        // If no logs remain, delete the task itself (and its pins)
        if (remainingLogs.length === 0) {
          // Remove from group_pins first to avoid FK error
          await db
            .delete(groupPinsTable)
            .where(eq(groupPinsTable.taskId, taskIdNum))
          await db.delete(tasksTable).where(eq(tasksTable.id, taskIdNum))
        }

        return { message: 'Task log deleted successfully', log: deletedLog[0] }
      } catch (err) {
        console.error('Error deleting task log:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  .put('/tasks/reorder', async ({ body, error }) => {
    try {
      const { date, taskLogs } = body as {
        date: string
        taskLogs: { taskId: number; sortOrder: number }[]
      }

      if (!date || !taskLogs || !Array.isArray(taskLogs)) {
        return error(400, { message: 'Invalid request body' })
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return error(400, { message: 'Invalid date format. Use YYYY-MM-DD' })
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
            ),
          )
      }

      return { message: 'Task logs reordered successfully' }
    } catch (err) {
      console.error('Error reordering task logs:', err)
      return error(500, { message: 'Internal server error' })
    }
  })
  // Create a pin subgroup under a task group
  .post(
    '/groups/:groupId/pin-groups',
    async ({ params: { groupId }, body, error }) => {
      try {
        const groupIdNum = parseInt(groupId)
        const { name } = body as { name: string }

        if (Number.isNaN(groupIdNum))
          return error(400, { message: 'Invalid group ID' })
        if (!name || name.trim().length === 0)
          return error(400, { message: 'Pin group name is required' })

        // parent must be a task group
        const parent = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, groupIdNum))
          .limit(1)
        if (parent.length === 0)
          return error(404, { message: 'Parent group not found' })
        if (parent[0].type !== 'tasks')
          return error(400, {
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
            ),
          )
          .orderBy(desc(groupsTable.sortOrder))
          .limit(1)
        const newSortOrder =
          lastPinGroup.length > 0 ? (lastPinGroup[0].maxSortOrder || 0) + 1 : 0

        const [pinGroup] = await db
          .insert(groupsTable)
          .values({
            name: name.trim(),
            type: 'pins' as const,
            group_id: groupIdNum,
            sortOrder: newSortOrder,
          })
          .returning()

        return { pinGroup }
      } catch (err) {
        console.error('Error creating pin group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  // Add a task reference into a pin group
  .post(
    '/pin-groups/:pinGroupId/tasks',
    async ({ params: { pinGroupId }, body, error }) => {
      try {
        const pinGroupIdNum = parseInt(pinGroupId)
        const { taskId, sortOrder } = body as {
          taskId: number
          sortOrder?: number
        }

        if (Number.isNaN(pinGroupIdNum))
          return error(400, { message: 'Invalid pin group ID' })
        if (!taskId || Number.isNaN(Number(taskId)))
          return error(400, { message: 'Invalid task ID' })

        const pinGroup = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, pinGroupIdNum))
          .limit(1)
        if (pinGroup.length === 0)
          return error(404, { message: 'Pin group not found' })
        if (pinGroup[0].type !== 'pins')
          return error(400, { message: 'Not a pin group' })

        const task = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1)
        if (task.length === 0) return error(404, { message: 'Task not found' })

        const existing = await db
          .select()
          .from(groupPinsTable)
          .where(
            and(
              eq(groupPinsTable.groupId, pinGroupIdNum),
              eq(groupPinsTable.taskId, taskId),
            ),
          )
          .limit(1)
        if (existing.length > 0)
          return error(409, { message: 'Task already pinned in this group' })

        let finalSortOrder = sortOrder
        if (finalSortOrder == null) {
          const last = await db
            .select({ maxSortOrder: groupPinsTable.sortOrder })
            .from(groupPinsTable)
            .where(eq(groupPinsTable.groupId, pinGroupIdNum))
            .orderBy(desc(groupPinsTable.sortOrder))
            .limit(1)
          finalSortOrder = last.length > 0 ? (last[0].maxSortOrder || 0) + 1 : 0
        }

        const [pin] = await db
          .insert(groupPinsTable)
          .values({ groupId: pinGroupIdNum, taskId, sortOrder: finalSortOrder })
          .returning()
        return { pin }
      } catch (err) {
        console.error('Error adding task to pin group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  // Remove a task reference from a pin group
  .delete(
    '/pin-groups/:pinGroupId/tasks/:taskId',
    async ({ params: { pinGroupId, taskId }, error }) => {
      try {
        const pinGroupIdNum = parseInt(pinGroupId)
        const taskIdNum = parseInt(taskId)
        if (Number.isNaN(pinGroupIdNum) || Number.isNaN(taskIdNum))
          return error(400, { message: 'Invalid pin group or task ID' })

        const deleted = await db
          .delete(groupPinsTable)
          .where(
            and(
              eq(groupPinsTable.groupId, pinGroupIdNum),
              eq(groupPinsTable.taskId, taskIdNum),
            ),
          )
          .returning()
        if (deleted.length === 0)
          return error(404, { message: 'Pin not found' })
        return { message: 'Task unpinned' }
      } catch (err) {
        console.error('Error removing task from pin group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )
  // Reorder tasks within a pin group
  .put(
    '/pin-groups/:pinGroupId/tasks/reorder',
    async ({ params: { pinGroupId }, body, error }) => {
      try {
        const pinGroupIdNum = parseInt(pinGroupId)
        const { items } = body as {
          items: { taskId: number; sortOrder: number }[]
        }
        if (Number.isNaN(pinGroupIdNum))
          return error(400, { message: 'Invalid pin group ID' })
        if (!Array.isArray(items))
          return error(400, { message: 'Invalid items' })

        for (const it of items) {
          await db
            .update(groupPinsTable)
            .set({ sortOrder: it.sortOrder })
            .where(
              and(
                eq(groupPinsTable.groupId, pinGroupIdNum),
                eq(groupPinsTable.taskId, it.taskId),
              ),
            )
        }
        return { message: 'Reordered' }
      } catch (err) {
        console.error('Error reordering pin group tasks:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

  // Rename a pin group
  .put(
    '/pin-groups/:pinGroupId',
    async ({ params: { pinGroupId }, body, error }) => {
      try {
        const pinGroupIdNum = parseInt(pinGroupId)
        const { name } = body as { name: string }

        if (Number.isNaN(pinGroupIdNum))
          return error(400, { message: 'Invalid pin group ID' })
        if (!name || name.trim().length === 0)
          return error(400, { message: 'Name is required' })

        // Ensure target is a pin group
        const existing = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, pinGroupIdNum))
          .limit(1)
        if (existing.length === 0)
          return error(404, { message: 'Pin group not found' })
        if (existing[0].type !== 'pins')
          return error(400, { message: 'Group is not a pin group' })

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
              ),
            )
            .limit(1)
          if (dup.length > 0 && dup[0].id !== pinGroupIdNum) {
            return error(409, {
              message: 'A pin group with this name already exists',
            })
          }
        }

        const [updated] = await db
          .update(groupsTable)
          .set({ name: name.trim() })
          .where(eq(groupsTable.id, pinGroupIdNum))
          .returning()

        return { group: updated }
      } catch (err) {
        console.error('Error renaming pin group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

  // Delete a pin group (and its pins)
  .delete(
    '/pin-groups/:pinGroupId',
    async ({ params: { pinGroupId }, error }) => {
      try {
        const pinGroupIdNum = parseInt(pinGroupId)
        if (Number.isNaN(pinGroupIdNum))
          return error(400, { message: 'Invalid pin group ID' })

        // Ensure it's a pin group
        const existing = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, pinGroupIdNum))
          .limit(1)
        if (existing.length === 0)
          return error(404, { message: 'Pin group not found' })
        if (existing[0].type !== 'pins')
          return error(400, { message: 'Group is not a pin group' })

        await db
          .delete(groupPinsTable)
          .where(eq(groupPinsTable.groupId, pinGroupIdNum))
        const [deleted] = await db
          .delete(groupsTable)
          .where(eq(groupsTable.id, pinGroupIdNum))
          .returning()

        return { message: 'Pin group deleted', group: deleted }
      } catch (err) {
        console.error('Error deleting pin group:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

  // Reorder pin groups under a parent task group
  .put(
    '/groups/:groupId/pin-groups/reorder',
    async ({ params: { groupId }, body, error }) => {
      try {
        const groupIdNum = parseInt(groupId)
        const { items } = body as {
          items: { pinGroupId: number; sortOrder: number }[]
        }

        if (Number.isNaN(groupIdNum))
          return error(400, { message: 'Invalid parent group ID' })
        if (!Array.isArray(items))
          return error(400, { message: 'Invalid items' })

        // ensure parent exists and is a task group
        const parent = await db
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, groupIdNum))
          .limit(1)
        if (parent.length === 0)
          return error(404, { message: 'Parent group not found' })
        if (parent[0].type !== 'tasks')
          return error(400, { message: 'Parent must be a task group' })

        for (const it of items) {
          await db
            .update(groupsTable)
            .set({ sortOrder: it.sortOrder })
            .where(
              and(
                eq(groupsTable.id, it.pinGroupId),
                eq(groupsTable.group_id, groupIdNum),
                eq(groupsTable.type, 'pins'),
              ),
            )
        }
        return { message: 'Pin groups reordered' }
      } catch (err) {
        console.error('Error reordering pin groups:', err)
        return error(500, { message: 'Internal server error' })
      }
    },
  )

  // Update a task's core fields (name, defaultExtraInfo)
  .put('/tasks/:taskId', async ({ params: { taskId }, body, error }) => {
    try {
      const taskIdNum = parseInt(taskId)
      if (Number.isNaN(taskIdNum)) {
        return error(400, { message: 'Invalid task ID' })
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
        return error(400, { message: 'No fields to update' })
      }

      // Fetch existing task
      const existing = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskIdNum))
        .limit(1)

      if (existing.length === 0) {
        return error(404, { message: 'Task not found' })
      }

      const updates: Partial<typeof tasksTable.$inferInsert> = {}

      if (task !== undefined) {
        const trimmed = (task ?? '').trim()
        if (trimmed.length === 0) {
          return error(400, { message: 'Task name cannot be empty' })
        }

        // Prevent duplicate task names within the same group
        const dup = await db
          .select()
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.groupId, existing[0].groupId),
              eq(tasksTable.task, trimmed),
            ),
          )
          .limit(1)

        if (dup.length > 0 && dup[0].id !== taskIdNum) {
          return error(409, {
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
        .where(eq(tasksTable.id, taskIdNum))
        .returning()

      return { task: updated }
    } catch (err) {
      console.error('Error updating task:', err)
      return error(500, { message: 'Internal server error' })
    }
  })

app.listen(9008)

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
)
