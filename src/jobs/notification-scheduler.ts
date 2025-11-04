import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { usersTable } from '../db/auth-schema'
import {
  groupsTable,
  streakGroupsTable,
  streakLogTable,
  streaksTable,
  taskLogTable,
  tasksTable,
  userNotificationSettingsTable,
} from '../db/schema'
import {
  type EveningStreaksPayload,
  type MorningTasksPayload,
  notificationService,
  type UpcomingTasksPayload,
} from '../services/notification-service'

/**
 * Notification scheduler - runs every minute to check for scheduled notifications
 */
export class NotificationScheduler {
  private isRunning = false

  /**
   * Start the scheduler
   */
  start() {
    console.log('[NotificationScheduler] Starting scheduler...')

    // Run every minute
    setInterval(() => {
      this.tick()
    }, 60000) // 60 seconds

    // Also run immediately on startup
    this.tick()
  }

  /**
   * Execute one tick of the scheduler
   */
  private async tick() {
    if (this.isRunning) {
      console.log(
        '[NotificationScheduler] Previous tick still running, skipping...',
      )
      return
    }

    this.isRunning = true

    try {
      await this.processScheduledNotifications()
    } catch (error) {
      console.error(
        '[NotificationScheduler] Error processing notifications:',
        error,
      )
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Process all scheduled notifications for the current minute
   */
  private async processScheduledNotifications() {
    const now = new Date()

    // Get all users with notification settings enabled
    const usersWithSettings = await db
      .select({
        userId: userNotificationSettingsTable.userId,
        email: usersTable.email,
        settings: userNotificationSettingsTable,
      })
      .from(userNotificationSettingsTable)
      .innerJoin(
        usersTable,
        eq(userNotificationSettingsTable.userId, usersTable.id),
      )
      .where(eq(userNotificationSettingsTable.enabled, true))

    for (const { userId, email, settings } of usersWithSettings) {
      try {
        const userLocalTime = this.convertToUserLocalTime(
          now,
          settings.timezone,
        )
        const currentTimeString = this.formatTime(userLocalTime) // HH:MM

        // Check if it's time for morning notification
        if (currentTimeString === settings.morningTime) {
          await this.sendMorningTasksNotification(userId, email, settings)
        }

        // Check if it's time for evening notification
        if (currentTimeString === settings.eveningTime) {
          await this.sendEveningStreaksNotification(userId, email, settings)
        }

        // Check if it's time for upcoming tasks notification
        if (currentTimeString === settings.upcomingTasksTime) {
          await this.sendUpcomingTasksNotification(userId, email, settings)
        }
      } catch (error) {
        console.error(
          `[NotificationScheduler] Error processing user ${userId}:`,
          error,
        )
      }
    }
  }

  /**
   * Send morning tasks notification
   */
  private async sendMorningTasksNotification(
    userId: string,
    userEmail: string | null,
    settings: typeof userNotificationSettingsTable.$inferSelect,
  ) {
    const today = this.getTodayDateString(settings.timezone)

    // Fetch today's incomplete tasks
    const tasks = await db
      .select({
        id: tasksTable.id,
        task: tasksTable.task,
        groupId: tasksTable.groupId,
        groupName: groupsTable.name,
        extraInfo: taskLogTable.extraInfo,
        sortOrder: taskLogTable.sortOrder,
      })
      .from(taskLogTable)
      .innerJoin(tasksTable, eq(taskLogTable.taskId, tasksTable.id))
      .innerJoin(groupsTable, eq(tasksTable.groupId, groupsTable.id))
      .where(
        and(
          eq(taskLogTable.userId, userId),
          eq(taskLogTable.date, today),
          eq(taskLogTable.done, false),
        ),
      )
      .orderBy(taskLogTable.sortOrder)

    // If no tasks, skip notification
    if (tasks.length === 0) {
      console.log(
        `[NotificationScheduler] No tasks for user ${userId}, skipping morning notification`,
      )
      return
    }

    const payload = this.buildMorningTasksPayload(
      userId,
      userEmail,
      today,
      tasks,
    )

    console.log(
      `[NotificationScheduler] Sending morning notification to user ${userId} (${tasks.length} tasks)`,
    )
    await notificationService.sendNotification(
      userId,
      userEmail,
      settings,
      payload,
    )
  }

  /**
   * Send evening streaks notification
   */
  private async sendEveningStreaksNotification(
    userId: string,
    userEmail: string | null,
    settings: typeof userNotificationSettingsTable.$inferSelect,
  ) {
    const today = this.getTodayDateString(settings.timezone)

    // Fetch all streaks with notifications enabled
    const streaksWithNotifications = await db
      .select({
        id: streaksTable.id,
        name: streaksTable.name,
      })
      .from(streaksTable)
      .where(
        and(
          eq(streaksTable.userId, userId),
          eq(streaksTable.notificationsEnabled, true),
        ),
      )

    if (streaksWithNotifications.length === 0) {
      console.log(
        `[NotificationScheduler] No streaks with notifications enabled for user ${userId}`,
      )
      return
    }

    const streakIds = streaksWithNotifications.map((s) => s.id)

    // BATCH: Get all today's done logs at once
    const todayLogs = await db
      .select()
      .from(streakLogTable)
      .where(
        and(
          inArray(streakLogTable.streakId, streakIds),
          eq(streakLogTable.date, today),
          eq(streakLogTable.done, true),
        ),
      )

    const todayLogsSet = new Set(todayLogs.map((log) => log.streakId))

    // BATCH: Get all group info at once
    const groupMappings = await db
      .select({
        streakId: streakGroupsTable.streakId,
        groupId: groupsTable.id,
        groupName: groupsTable.name,
      })
      .from(streakGroupsTable)
      .innerJoin(groupsTable, eq(streakGroupsTable.groupId, groupsTable.id))
      .where(inArray(streakGroupsTable.streakId, streakIds))

    const groupMap = new Map(
      groupMappings.map((g) => [
        g.streakId,
        { groupId: g.groupId, groupName: g.groupName },
      ]),
    )

    const incompleteStreaks: EveningStreaksPayload['data']['incompleteStreaks'] =
      []

    // Check each streak for completion and calculate current count
    for (const streak of streaksWithNotifications) {
      // Check if done today (using batched data)
      if (todayLogsSet.has(streak.id)) {
        continue
      }

      // Calculate current streak count
      const streakCount = await this.calculateStreakCount(streak.id, today)

      // Get group information (using batched data)
      const groupInfo = groupMap.get(streak.id)

      incompleteStreaks.push({
        id: streak.id,
        name: streak.name,
        currentCount: streakCount,
        groupId: groupInfo?.groupId || null,
        groupName: groupInfo?.groupName || null,
      })
    }

    // If all streaks are complete, skip notification
    if (incompleteStreaks.length === 0) {
      console.log(
        `[NotificationScheduler] All streaks complete for user ${userId}, skipping evening notification`,
      )
      return
    }

    const payload = this.buildEveningStreaksPayload(
      userId,
      userEmail,
      today,
      incompleteStreaks,
    )

    console.log(
      `[NotificationScheduler] Sending evening notification to user ${userId} (${incompleteStreaks.length} incomplete streaks)`,
    )
    await notificationService.sendNotification(
      userId,
      userEmail,
      settings,
      payload,
    )
  }

  /**
   * Send upcoming tasks notification
   */
  private async sendUpcomingTasksNotification(
    userId: string,
    userEmail: string | null,
    settings: typeof userNotificationSettingsTable.$inferSelect,
  ) {
    const today = this.getTodayDateString(settings.timezone)
    const daysAhead = settings.upcomingTasksDays

    // Calculate date range: tomorrow to (today + daysAhead)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowString = tomorrow.toISOString().split('T')[0]

    const endDate = new Date(today)
    endDate.setDate(endDate.getDate() + daysAhead)
    const endDateString = endDate.toISOString().split('T')[0]

    // Fetch upcoming incomplete tasks in date range
    const tasks = await db
      .select({
        id: tasksTable.id,
        task: tasksTable.task,
        date: taskLogTable.date,
        groupId: tasksTable.groupId,
        groupName: groupsTable.name,
        extraInfo: taskLogTable.extraInfo,
      })
      .from(taskLogTable)
      .innerJoin(tasksTable, eq(taskLogTable.taskId, tasksTable.id))
      .innerJoin(groupsTable, eq(tasksTable.groupId, groupsTable.id))
      .where(
        and(
          eq(taskLogTable.userId, userId),
          sql`${taskLogTable.date} >= ${tomorrowString}`,
          sql`${taskLogTable.date} <= ${endDateString}`,
          eq(taskLogTable.done, false),
        ),
      )
      .orderBy(taskLogTable.date)

    // If no tasks, skip notification
    if (tasks.length === 0) {
      console.log(
        `[NotificationScheduler] No upcoming tasks for user ${userId}, skipping notification`,
      )
      return
    }

    // Calculate days until for each task
    const upcomingTasks = tasks.map((task) => {
      const taskDate = new Date(task.date)
      const todayDate = new Date(today)
      const diffTime = taskDate.getTime() - todayDate.getTime()
      const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      return {
        id: task.id,
        task: task.task,
        date: task.date,
        daysUntil,
        groupId: task.groupId,
        groupName: task.groupName,
        extraInfo: task.extraInfo,
      }
    })

    const payload = this.buildUpcomingTasksPayload(
      userId,
      userEmail,
      today,
      daysAhead,
      upcomingTasks,
    )

    console.log(
      `[NotificationScheduler] Sending upcoming tasks notification to user ${userId} (${tasks.length} tasks)`,
    )
    await notificationService.sendNotification(
      userId,
      userEmail,
      settings,
      payload,
    )
  }

  /**
   * Calculate current streak count (consecutive days from yesterday backwards)
   */
  private async calculateStreakCount(
    streakId: number,
    todayDate: string,
  ): Promise<number> {
    // Get all done logs for this streak, ordered by date descending
    const logs = await db
      .select({
        date: streakLogTable.date,
        done: streakLogTable.done,
      })
      .from(streakLogTable)
      .where(
        and(
          eq(streakLogTable.streakId, streakId),
          eq(streakLogTable.done, true),
        ),
      )
      .orderBy(sql`${streakLogTable.date} DESC`)

    if (logs.length === 0) {
      return 0
    }

    // Calculate yesterday's date
    const yesterday = new Date(todayDate)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayString = yesterday.toISOString().split('T')[0]

    // Check if there's a done log for yesterday
    const yesterdayLog = logs.find((log) => log.date === yesterdayString)

    if (!yesterdayLog) {
      // No done log for yesterday (either no log exists or it was marked undone)
      return 0
    }

    // Count consecutive days backwards from yesterday
    let count = 0
    const currentDate = new Date(yesterdayString)

    for (const log of logs) {
      const expectedDate = currentDate.toISOString().split('T')[0]

      if (log.date === expectedDate) {
        count++
        currentDate.setDate(currentDate.getDate() - 1)
      } else {
        // Gap found, stop counting
        break
      }
    }

    return count
  }

  /**
   * Convert UTC time to user's local time
   */
  private convertToUserLocalTime(utcDate: Date, timezone: string): Date {
    try {
      // Use Intl.DateTimeFormat to convert to user timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })

      const parts = formatter.formatToParts(utcDate)
      const values: Record<string, string> = {}
      for (const part of parts) {
        if (part.type !== 'literal') {
          values[part.type] = part.value
        }
      }

      return new Date(
        `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`,
      )
    } catch (error) {
      console.error(`Invalid timezone ${timezone}, falling back to UTC`, error)
      return utcDate
    }
  }

  /**
   * Format time as HH:MM string
   */
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
  }

  /**
   * Get today's date string in user's timezone (YYYY-MM-DD)
   */
  private getTodayDateString(timezone: string): string {
    try {
      const now = new Date()
      const formatter = new Intl.DateTimeFormat('en-CA', {
        // en-CA gives YYYY-MM-DD format
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      return formatter.format(now)
    } catch (error) {
      console.error(`Invalid timezone ${timezone}, falling back to UTC`, error)
      return new Date().toISOString().split('T')[0]
    }
  }

  /**
   * Build morning tasks payload from task data (for reuse in tests)
   */
  buildMorningTasksPayload(
    userId: string,
    userEmail: string | null,
    date: string,
    tasks: Array<{
      id: number
      task: string
      groupId: number
      groupName: string
      extraInfo: string | null
      sortOrder: number
    }>,
  ): MorningTasksPayload {
    const groupCounts: Record<string, number> = {}
    for (const task of tasks) {
      groupCounts[task.groupName] = (groupCounts[task.groupName] || 0) + 1
    }

    return {
      type: 'morning_tasks',
      timestamp: new Date().toISOString(),
      user: {
        id: userId,
        email: userEmail,
      },
      data: {
        date,
        tasks: tasks.map((t) => ({
          id: t.id,
          task: t.task,
          groupId: t.groupId,
          groupName: t.groupName,
          extraInfo: t.extraInfo,
          sortOrder: t.sortOrder,
        })),
        summary: {
          totalTasks: tasks.length,
          groupCounts,
        },
      },
    }
  }

  /**
   * Build evening streaks payload from streak data (for reuse in tests)
   */
  buildEveningStreaksPayload(
    userId: string,
    userEmail: string | null,
    date: string,
    incompleteStreaks: Array<{
      id: number
      name: string
      currentCount: number
      groupId: number | null
      groupName: string | null
    }>,
  ): EveningStreaksPayload {
    return {
      type: 'evening_streaks',
      timestamp: new Date().toISOString(),
      user: {
        id: userId,
        email: userEmail,
      },
      data: {
        date,
        incompleteStreaks,
      },
    }
  }

  /**
   * Build upcoming tasks payload from task data (for reuse in tests)
   */
  buildUpcomingTasksPayload(
    userId: string,
    userEmail: string | null,
    checkDate: string,
    daysAhead: number,
    upcomingTasks: Array<{
      id: number
      task: string
      date: string
      daysUntil: number
      groupId: number
      groupName: string
      extraInfo: string | null
    }>,
  ): UpcomingTasksPayload {
    return {
      type: 'upcoming_tasks',
      timestamp: new Date().toISOString(),
      user: {
        id: userId,
        email: userEmail,
      },
      data: {
        checkDate,
        daysAhead,
        upcomingTasks,
      },
    }
  }
}

// Export singleton instance
export const notificationScheduler = new NotificationScheduler()
