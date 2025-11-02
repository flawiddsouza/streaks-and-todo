import {
  type AnyPgColumn,
  boolean,
  date,
  integer,
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const streakLogTable = pgTable('streak_log', {
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
})

export const groupsTable = pgTable('groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .references(() => usersTable.id)
    .notNull(),
  group_id: integer('group_id').references((): AnyPgColumn => groupsTable.id),
  name: varchar({ length: 255 }).notNull(),
  type: groupTypeEnum().notNull(),
  sortOrder: integer('sort_order').notNull(),
  viewMode: smallint('view_mode'), // 0 = table, 1 = kanban
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const streakGroupsTable = pgTable('streak_groups', {
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
})

export const tasksTable = pgTable('tasks', {
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const taskLogTable = pgTable('task_log', {
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
})

export const groupNotesTable = pgTable('group_notes', {
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
})

export const groupPinsTable = pgTable('group_pins', {
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
})
