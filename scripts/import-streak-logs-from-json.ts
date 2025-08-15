// Script to import streak logs from a JSON file, including note for the first streak item

import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/index'
import { streakLogTable, streaksTable } from '../src/db/schema'

async function main() {
  const dataPathArg = process.argv[2]
  const userEmail = process.argv[3]
  if (!dataPathArg || !userEmail) {
    console.error(
      'Usage: bun import-streak-logs-from-json.ts <path-to-data.json> <userEmail>',
    )
    process.exit(1)
  }
  const dataPath = path.resolve(process.cwd(), dataPathArg)
  const raw = fs.readFileSync(dataPath, 'utf-8')
  const data = JSON.parse(raw)

  // Look up user ID from email
  const { usersTable } = require('../src/db/auth-schema')
  const userRes = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, userEmail))
    .limit(1)
  if (!userRes.length) {
    console.error(`No user found with email '${userEmail}'.`)
    process.exit(1)
  }
  const userId = userRes[0].id

  // Error out if no streak items
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error('No streak items found in data.json')
  }

  // Wrap all inserts in a transaction for atomicity
  await db.transaction(async (tx) => {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      const dateRaw = item.Date
      if (!dateRaw) {
        // Skip items without a date
        continue
      }
      // Try to parse date to YYYY-MM-DD
      let date: string
      try {
        // Manual parsing for DD-MMM-YY
        const [day, monthStr, yearStr] = dateRaw.split('-')
        const monthMap: Record<string, number> = {
          Jan: 1,
          Feb: 2,
          Mar: 3,
          Apr: 4,
          May: 5,
          Jun: 6,
          Jul: 7,
          Aug: 8,
          Sep: 9,
          Sept: 9,
          Oct: 10,
          Nov: 11,
          Dec: 12,
        }
        const month = monthMap[monthStr]
        if (!month) throw new Error('Invalid month')
        let year = parseInt(yearStr, 10)
        year += year < 100 ? 2000 : 0
        const dayNum = String(parseInt(day, 10)).padStart(2, '0')
        const monthNum = String(month).padStart(2, '0')
        date = `${year}-${monthNum}-${dayNum}`
      } catch {
        console.error(
          `Invalid date format '${dateRaw}' at item index ${i}, skipping.`,
        )
        continue
      }

      // Use the note for this item if present
      const note = item.Note?.trim() ? item.Note.trim() : undefined

      // Gather streak/device keys except 'Date' and 'Note', preserving original order
      const streakKeys = Object.keys(item).filter(
        (key) => key !== 'Date' && key !== 'Note',
      )

      // Find all streaks marked as done ('x')
      const doneKeys = streakKeys.filter((key) => item[key] === 'x')

      // If there's a note, determine where to insert it
      if (note) {
        let targetKey: string | undefined
        let done: boolean | undefined
        if (doneKeys.length > 0) {
          // Insert note into first streak marked as done
          targetKey = doneKeys[0]
          done = true
        } else if (streakKeys.length > 0) {
          // Insert note into first streak (alphabetically)
          targetKey = streakKeys[0]
          done = false
        }
        if (targetKey !== undefined && done !== undefined) {
          // Find the streak in the database by name and userId
          const streak = await tx
            .select()
            .from(streaksTable)
            .where(
              and(
                eq(streaksTable.name, targetKey),
                eq(streaksTable.userId, userId),
              ),
            )
            .limit(1)
          if (!streak.length) {
            console.error(
              `No streak found in DB with name '${targetKey}' for userId '${userId}' (item index ${i}), skipping.`,
            )
            continue
          }
          const streakId = streak[0].id
          // Check for existing streak log for this streakId, userId, and date
          const existingLog = await tx
            .select()
            .from(streakLogTable)
            .where(
              and(
                eq(streakLogTable.streakId, streakId),
                eq(streakLogTable.userId, userId),
                eq(streakLogTable.date, date),
              ),
            )
            .limit(1)
          if (existingLog.length > 0) {
            // console.log(
            //   `Streak log for '${targetKey}' already exists for date ${date}, skipping.`,
            // )
            continue
          }
          // Insert streak log with note
          type StreakLogInsert = {
            streakId: number
            userId: string
            date: string
            done: boolean
            note?: string
          }
          const logData: StreakLogInsert = {
            streakId,
            userId,
            date,
            done,
            note,
          }
          await tx.insert(streakLogTable).values(logData)
          console.log(
            `Inserted streak log for '${targetKey}' on ${date}:`,
            logData,
          )
        }
      }

      // For all other streaks marked as done ('x'), insert streak log with done: true (no note)
      for (const key of doneKeys) {
        // If this key was already used for note, skip
        if (note && key === (doneKeys.length > 0 ? doneKeys[0] : undefined))
          continue
        // Find the streak in the database by name and userId
        const streak = await tx
          .select()
          .from(streaksTable)
          .where(
            and(eq(streaksTable.name, key), eq(streaksTable.userId, userId)),
          )
          .limit(1)
        if (!streak.length) {
          console.error(
            `No streak found in DB with name '${key}' for userId '${userId}' (item index ${i}), skipping.`,
          )
          continue
        }
        const streakId = streak[0].id
        // Check for existing streak log for this streakId, userId, and date
        const existingLog = await tx
          .select()
          .from(streakLogTable)
          .where(
            and(
              eq(streakLogTable.streakId, streakId),
              eq(streakLogTable.userId, userId),
              eq(streakLogTable.date, date),
            ),
          )
          .limit(1)
        if (existingLog.length > 0) {
          // console.log(
          //   `Streak log for '${key}' already exists for date ${date}, skipping.`,
          // )
          continue
        }
        // Insert streak log with done: true, no note
        type StreakLogInsert = {
          streakId: number
          userId: string
          date: string
          done: boolean
          note?: string
        }
        const logData: StreakLogInsert = {
          streakId,
          userId,
          date,
          done: true,
        }
        await tx.insert(streakLogTable).values(logData)
        console.log(`Inserted streak log for '${key}' on ${date}:`, logData)
      }
    }
  })
  // Exit after all work is done
  process.exit(0)
}

main().catch((err) => {
  console.error('Error running import script:', err)
})
