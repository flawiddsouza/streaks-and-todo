import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  json,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { usersTable } from './auth-schema'

export const groupTypeEnum = pgEnum('group_type', ['streaks', 'tasks', 'pins'])

export const streaksTable = pgTable('streaks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .references(() => usersTable.id)
    .notNull(),
  name: varchar({ length: 255 }).notNull(),
  notificationsEnabled: boolean('notifications_enabled')
    .default(false)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const streakLogTable = pgTable(
  'streak_log',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    date: date().notNull(),
    streakId: integer('streak_id')
      .references(() => streaksTable.id)
      .notNull(),
    done: boolean().notNull(),
    note: text(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('streak_log_streak_id_date_idx').on(t.streakId, t.date)],
)

export const groupsTable = pgTable(
  'groups',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    group_id: integer('group_id').references((): AnyPgColumn => groupsTable.id),
    name: varchar({ length: 255 }).notNull(),
    type: groupTypeEnum().notNull(),
    sortOrder: integer('sort_order').notNull(),
    viewMode: smallint('view_mode'), // 0 = table, 1 = kanban, 2 = calendar
    settings: json('settings').$type<{
      table?: { showOnlyDaysUntilToday?: boolean }
      kanban?: { showOnlyDaysUntilToday?: boolean }
      calendar?: Record<string, unknown>
      floatingTasksSidebarCollapsed?: boolean
    }>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('groups_user_id_type_sort_order_idx').on(
      t.userId,
      t.type,
      t.sortOrder,
      t.createdAt,
    ),
    index('groups_group_id_type_user_id_idx').on(t.group_id, t.type, t.userId),
    index('groups_name_user_id_idx').on(t.name, t.userId),
  ],
)

export const streakGroupsTable = pgTable(
  'streak_groups',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    groupId: integer('group_id')
      .references(() => groupsTable.id)
      .notNull(),
    streakId: integer('streak_id')
      .references(() => streaksTable.id)
      .notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('streak_groups_group_id_user_id_sort_order_idx').on(
      t.groupId,
      t.userId,
      t.sortOrder,
    ),
  ],
)

export const taskFamiliesTable = pgTable(
  'task_families',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    name: varchar({ length: 255 }).notNull(),
    namePattern: text('name_pattern'),
    defaultExtraInfo: text('default_extra_info'),
    streakId: integer('streak_id').references(() => streaksTable.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('task_families_user_id_name_idx').on(t.userId, t.name)],
)

export const tasksTable = pgTable(
  'tasks',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    groupId: integer('group_id')
      .references(() => groupsTable.id)
      .notNull(),
    task: text().notNull(),
    defaultExtraInfo: text('default_extra_info'),
    streakId: integer('streak_id').references(() => streaksTable.id),
    isOneOff: boolean('is_one_off').notNull().default(false),
    familyId: integer('family_id').references(
      (): AnyPgColumn => taskFamiliesTable.id,
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('tasks_group_id_user_id_idx').on(t.groupId, t.userId),
    index('tasks_streak_id_user_id_idx').on(t.streakId, t.userId),
    index('tasks_family_id_user_id_idx').on(t.familyId, t.userId),
  ],
)

export const taskLogTable = pgTable(
  'task_log',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    date: date().notNull(),
    taskId: integer('task_id')
      .references(() => tasksTable.id)
      .notNull(),
    extraInfo: text('extra_info'),
    done: boolean().notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('task_log_task_id_date_idx').on(t.taskId, t.date),
    index('task_log_user_id_date_done_idx').on(t.userId, t.date, t.done),
  ],
)

export const groupNotesTable = pgTable(
  'group_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    date: date().notNull(),
    groupId: integer('group_id')
      .references(() => groupsTable.id)
      .notNull(),
    note: text().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('group_notes_group_id_date_idx').on(t.groupId, t.date)],
)

export const groupPinsTable = pgTable(
  'group_pins',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .references(() => usersTable.id)
      .notNull(),
    groupId: integer('group_id')
      .references(() => groupsTable.id)
      .notNull(),
    taskId: integer('task_id')
      .references(() => tasksTable.id)
      .notNull(),
    extraInfo: text('extra_info'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('group_pins_group_id_user_id_sort_order_idx').on(
      t.groupId,
      t.userId,
      t.sortOrder,
    ),
    index('group_pins_task_id_idx').on(t.taskId),
  ],
)

export const userNotificationSettingsTable = pgTable(
  'user_notification_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => usersTable.id)
      .notNull(),
    enabled: boolean().default(true).notNull(),
    channels: json('channels').$type<{
      email?: {
        enabled: boolean
        address?: string // Optional override, defaults to user.email
      }
      ntfy?: {
        enabled: boolean
        server: string // e.g., "https://ntfy.sh"
        topic: string // e.g., "mytasks-user123"
        token?: string // Optional bearer token for protected topics
      }
      webhook?: {
        enabled: boolean
        url: string
        secret?: string // For HMAC signature verification
      }
    }>(),
    morningTime: text('morning_time').default('09:00').notNull(), // HH:MM format
    eveningTime: text('evening_time').default('20:00').notNull(), // HH:MM format
    upcomingTasksTime: text('upcoming_tasks_time').default('09:00').notNull(), // HH:MM format
    upcomingTasksDays: integer('upcoming_tasks_days').default(7).notNull(), // Days ahead to check
    timezone: text().default('UTC').notNull(), // IANA timezone, e.g., "America/New_York"
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
)

export const notificationDeliveriesTable = pgTable('notification_deliveries', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .references(() => usersTable.id)
    .notNull(),
  type: text().notNull(), // 'morning_tasks' or 'evening_streaks'
  channel: text().notNull(), // 'email', 'ntfy', 'webhook'
  status: text().notNull(), // 'sent', 'failed'
  error: text(), // Error message if failed
  payload: json('payload'), // The notification payload that was sent
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
})
