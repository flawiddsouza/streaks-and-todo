import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const streaksTable = pgTable('streaks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const streakLogTable = pgTable('streak_log', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  date: date().notNull(),
  streakId: integer('streak_id')
    .references(() => streaksTable.id)
    .notNull(),
  note: text(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const groupsTable = pgTable('groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const streakGroupsTable = pgTable('streak_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
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
  task: text().notNull(),
  streakId: integer('streak_id').references(() => streaksTable.id),
  pinned: boolean().default(false).notNull(),
})

export const taskLogTable = pgTable('task_log', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  date: date().notNull(),
  taskId: integer('task_id')
    .references(() => tasksTable.id)
    .notNull(),
  extraInfo: text('extra_info'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
