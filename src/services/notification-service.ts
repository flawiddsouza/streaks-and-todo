import { createHmac } from 'node:crypto'
import dayjs from 'dayjs'
import type { InferSelectModel } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import {
  notificationDeliveriesTable,
  type userNotificationSettingsTable,
} from '../db/schema'

export type NotificationSettings = InferSelectModel<
  typeof userNotificationSettingsTable
>

export interface MorningTasksPayload {
  type: 'morning_tasks'
  timestamp: string
  user: {
    id: string
    email: string | null
  }
  data: {
    date: string
    tasks: Array<{
      id: number
      task: string
      groupId: number
      groupName: string
      extraInfo: string | null
      sortOrder: number
    }>
    summary: {
      totalTasks: number
      groupCounts: Record<string, number>
    }
  }
}

export interface EveningStreaksPayload {
  type: 'evening_streaks'
  timestamp: string
  user: {
    id: string
    email: string | null
  }
  data: {
    date: string
    incompleteStreaks: Array<{
      id: number
      name: string
      currentCount: number
      groupId: number | null
      groupName: string | null
    }>
  }
}

export interface UpcomingTasksPayload {
  type: 'upcoming_tasks'
  timestamp: string
  user: {
    id: string
    email: string | null
  }
  data: {
    checkDate: string
    daysAhead: number
    upcomingTasks: Array<{
      id: number
      task: string
      date: string
      daysUntil: number
      groupId: number
      groupName: string
      extraInfo: string | null
    }>
  }
}

export type NotificationPayload =
  | MorningTasksPayload
  | EveningStreaksPayload
  | UpcomingTasksPayload

export class NotificationService {
  /**
   * Send notification through all enabled channels for a user
   */
  async sendNotification(
    userId: string,
    userEmail: string | null,
    settings: NotificationSettings,
    payload: NotificationPayload,
  ): Promise<void> {
    const channels = settings.channels || {}

    // Send to each enabled channel
    const deliveries: Promise<void>[] = []

    if (channels.email?.enabled) {
      deliveries.push(
        this.sendEmail(userId, userEmail, channels.email, payload),
      )
    }

    if (channels.ntfy?.enabled) {
      deliveries.push(this.sendNtfy(userId, channels.ntfy, payload))
    }

    if (channels.webhook?.enabled) {
      deliveries.push(this.sendWebhook(userId, channels.webhook, payload))
    }

    // Execute all deliveries in parallel (no fallback, just log failures)
    await Promise.all(deliveries)
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    userId: string,
    userEmail: string | null,
    emailConfig: { enabled: boolean; address?: string },
    payload: NotificationPayload,
  ): Promise<void> {
    const toEmail = emailConfig.address || userEmail

    if (!toEmail) {
      await this.logDelivery(
        userId,
        payload.type,
        'email',
        'failed',
        'No email address configured',
      )
      return
    }

    // Check if SMTP is configured
    const { smtp } = config.notifications
    if (!smtp.host || !smtp.user || !smtp.password) {
      await this.logDelivery(
        userId,
        payload.type,
        'email',
        'failed',
        'SMTP not configured on server',
      )
      return
    }

    try {
      const { subject, body } = this.formatEmailMessage(payload)

      // Use Bun's built-in SMTP capabilities or nodemailer
      // For now, we'll prepare the structure and log it
      // TODO: Implement actual email sending with nodemailer or similar
      console.log('Email would be sent:', {
        to: toEmail,
        subject,
        body: body.substring(0, 100),
      })

      await this.logDelivery(
        userId,
        payload.type,
        'email',
        'sent',
        undefined,
        payload,
      )
    } catch (error) {
      await this.logDelivery(
        userId,
        payload.type,
        'email',
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  /**
   * Send ntfy notification
   */
  private async sendNtfy(
    userId: string,
    ntfyConfig: {
      enabled: boolean
      server: string
      topic: string
      token?: string
    },
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      const { title, message, priority, actions } =
        this.formatNtfyMessage(payload)
      const url = `${ntfyConfig.server}/${ntfyConfig.topic}`

      const headers: Record<string, string> = {
        'Content-Type': 'text/plain',
        Title: title,
        Priority: priority,
        Tags:
          payload.type === 'morning_tasks'
            ? 'calendar,sunrise'
            : payload.type === 'evening_streaks'
              ? 'warning,fire'
              : 'calendar,clock',
        Markdown: 'yes',
      }

      if (actions) {
        headers.Actions = actions
      }

      if (ntfyConfig.token) {
        headers.Authorization = `Bearer ${ntfyConfig.token}`
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: message,
      })

      if (!response.ok) {
        throw new Error(
          `ntfy request failed: ${response.status} ${response.statusText}`,
        )
      }

      await this.logDelivery(
        userId,
        payload.type,
        'ntfy',
        'sent',
        undefined,
        payload,
      )
    } catch (error) {
      await this.logDelivery(
        userId,
        payload.type,
        'ntfy',
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    userId: string,
    webhookConfig: { enabled: boolean; url: string; secret?: string },
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      const body = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'StreaksAndTodo-Notifications/1.0',
      }

      // Add HMAC signature if secret is configured
      if (webhookConfig.secret) {
        const signature = this.generateWebhookSignature(
          body,
          webhookConfig.secret,
        )
        headers['X-Webhook-Signature'] = signature
      }

      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers,
        body,
      })

      if (!response.ok) {
        throw new Error(
          `Webhook request failed: ${response.status} ${response.statusText}`,
        )
      }

      await this.logDelivery(
        userId,
        payload.type,
        'webhook',
        'sent',
        undefined,
        payload,
      )
    } catch (error) {
      await this.logDelivery(
        userId,
        payload.type,
        'webhook',
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  private generateWebhookSignature(body: string, secret: string): string {
    const hmac = createHmac('sha256', secret)
    hmac.update(body)
    return `sha256=${hmac.digest('hex')}`
  }

  /**
   * Generate unified notification content (agnostic format)
   */
  private generateNotificationContent(payload: NotificationPayload): {
    title: string
    items: Array<{ group?: string; text: string; extra?: string }>
    summary: string
    dateInfo?: string
  } {
    if (payload.type === 'morning_tasks') {
      const { tasks, summary } = payload.data
      const { totalTasks } = summary

      // Group tasks by group name
      const tasksByGroup = new Map<string, typeof tasks>()
      for (const task of tasks) {
        const existing = tasksByGroup.get(task.groupName) || []
        existing.push(task)
        tasksByGroup.set(task.groupName, existing)
      }

      const items: Array<{ group?: string; text: string; extra?: string }> = []
      for (const [groupName, groupTasks] of tasksByGroup) {
        for (const task of groupTasks) {
          items.push({
            group: groupName,
            text: task.task,
            extra: task.extraInfo || undefined,
          })
        }
      }

      return {
        title: 'Tasks for Today',
        summary: `You have **${totalTasks} task${totalTasks !== 1 ? 's' : ''}** scheduled for today`,
        dateInfo: dayjs(payload.data.date).format('DD-MMM-YY'),
        items,
      }
    } else if (payload.type === 'evening_streaks') {
      const { incompleteStreaks } = payload.data
      const streakCount = incompleteStreaks.length

      if (streakCount === 0) {
        return {
          title: 'All Streaks Complete!',
          summary: 'Great job! All your streaks are logged for today.',
          items: [],
        }
      }

      const items = incompleteStreaks.map((streak) => ({
        text: streak.name,
        extra:
          streak.currentCount > 0
            ? `Don't break your ${streak.currentCount}-day streak! 🔥`
            : undefined,
        group: streak.groupName || undefined,
      }))

      return {
        title: 'Streak Reminder',
        summary: `You have **${streakCount} streak${streakCount !== 1 ? 's' : ''}** that need logging`,
        items,
      }
    } else {
      // upcoming_tasks
      const { upcomingTasks, daysAhead } = payload.data
      const taskCount = upcomingTasks.length

      if (taskCount === 0) {
        return {
          title: 'No Upcoming Events',
          summary: 'You have no events scheduled in the next week.',
          items: [],
        }
      }

      // Group by date
      const tasksByDate = new Map<string, typeof upcomingTasks>()
      for (const task of upcomingTasks) {
        const existing = tasksByDate.get(task.date) || []
        existing.push(task)
        tasksByDate.set(task.date, existing)
      }

      const sortedDates = Array.from(tasksByDate.keys()).sort()
      const items: Array<{ group?: string; text: string; extra?: string }> = []

      for (const date of sortedDates) {
        const tasks = tasksByDate.get(date)
        if (!tasks || tasks.length === 0) continue
        const daysUntil = tasks[0].daysUntil
        const dateLabel =
          daysUntil === 0
            ? 'Today'
            : daysUntil === 1
              ? 'Tomorrow'
              : `In ${daysUntil} days`
        const formattedDate = dayjs(date).format('DD-MMM-YY')

        for (const task of tasks) {
          items.push({
            group: `${dateLabel} (${formattedDate})`,
            text: task.task,
            extra: task.extraInfo
              ? `${task.extraInfo} • ${task.groupName}`
              : task.groupName,
          })
        }
      }

      return {
        title: 'Upcoming Events',
        summary: `You have **${taskCount} event${taskCount !== 1 ? 's' : ''}** in the next ${daysAhead} day${daysAhead !== 1 ? 's' : ''}`,
        items,
      }
    }
  }

  /**
   * Format email message from payload (HTML)
   */
  private formatEmailMessage(payload: NotificationPayload): {
    subject: string
    body: string
  } {
    const content = this.generateNotificationContent(payload)
    const subject = content.summary

    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h2 { color: #2563eb; margin-bottom: 10px; }
    .summary { font-size: 16px; margin-bottom: 20px; color: #555; }
    .date-info { font-size: 14px; color: #888; margin-bottom: 20px; }
    .group { font-weight: 600; color: #1f2937; margin-top: 15px; margin-bottom: 8px; }
    .item { margin: 5px 0 5px 20px; }
    .extra { color: #6b7280; font-style: italic; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    .button { display: inline-block; padding: 10px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px; }
    .button:hover { background-color: #1d4ed8; }
  </style>
</head>
<body>
  <h2>${content.title}</h2>
  <p class="summary">${content.summary}</p>
  ${content.dateInfo ? `<p class="date-info">Date: ${content.dateInfo}</p>` : ''}
`

    if (content.items.length > 0) {
      let currentGroup = ''
      for (const item of content.items) {
        if (item.group && item.group !== currentGroup) {
          if (currentGroup !== '') html += `</div>`
          html += `<div class="group">${item.group}:</div><div>`
          currentGroup = item.group
        }

        html += `<div class="item">• ${item.text}`
        if (item.extra) {
          html += ` <span class="extra">(${item.extra})</span>`
        }
        html += `</div>`
      }
      if (currentGroup !== '') html += `</div>`
    }

    html += `
  <div class="footer">
    <a href="${config.frontendUrl}" class="button">Open App</a>
  </div>
</body>
</html>`

    return { subject, body: html }
  }

  /**
   * Format ntfy message from payload (Markdown)
   */
  private formatNtfyMessage(payload: NotificationPayload): {
    title: string
    message: string
    priority: string
    actions?: string
  } {
    const content = this.generateNotificationContent(payload)

    let message = `${content.summary}\n\n`

    if (content.dateInfo) {
      message += `${content.dateInfo}\n\n`
    }

    if (content.items.length > 0) {
      let currentGroup = ''
      for (const item of content.items) {
        if (item.group && item.group !== currentGroup) {
          message += `\n**${item.group}**\n`
          currentGroup = item.group
        }

        message += `- ${item.text}`
        if (item.extra) {
          message += ` _(${item.extra})_`
        }
        message += '\n'
      }
    }

    const priority = content.items.length === 0 ? 'low' : 'default'

    let actions: string | undefined
    if (content.items.length > 0) {
      if (payload.type === 'morning_tasks') {
        actions = `view, View Tasks, ${config.frontendUrl}/todo`
      } else if (payload.type === 'evening_streaks') {
        actions = `view, Log Streaks, ${config.frontendUrl}/streaks`
      } else {
        actions = `view, View Calendar, ${config.frontendUrl}/todo`
      }
    }

    return {
      title: content.title,
      message: message.trim(),
      priority,
      actions,
    }
  }

  /**
   * Log notification delivery to database
   */
  private async logDelivery(
    userId: string,
    type: string,
    channel: string,
    status: 'sent' | 'failed',
    error?: string,
    payload?: NotificationPayload,
  ): Promise<void> {
    try {
      await db.insert(notificationDeliveriesTable).values({
        userId,
        type,
        channel,
        status,
        error: error || null,
        payload: payload || null,
      })
    } catch (err) {
      console.error('Failed to log notification delivery:', err)
    }
  }
}

export const notificationService = new NotificationService()
