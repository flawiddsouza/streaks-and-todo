import { db } from '../src/db'
import {
  groupsTable,
  streakGroupsTable,
  streakLogTable,
  streaksTable,
} from '../src/db/schema'

const RECORDS_PER_STREAK = 1000
const NUM_STREAKS = 9
const TOTAL_RECORDS = RECORDS_PER_STREAK * NUM_STREAKS
const BATCH_SIZE = 100

function generateUniqueDates(count: number): string[] {
  const now = new Date()
  const tenYearsAgo = new Date(
    now.getFullYear() - 10,
    now.getMonth(),
    now.getDate(),
  )

  const dates = new Set<string>()

  while (dates.size < count) {
    const randomTime =
      tenYearsAgo.getTime() +
      Math.random() * (now.getTime() - tenYearsAgo.getTime())
    const date = new Date(randomTime).toISOString().split('T')[0]
    dates.add(date)
  }

  return Array.from(dates).sort()
}

function generateRandomNote(): string | null {
  const notes = [
    null,
    'Great day!',
    'Feeling motivated',
    'Small progress',
    'Challenging but worth it',
    'Consistent effort',
    'Building momentum',
    'Steady progress',
    'Good habits forming',
    'Feeling strong',
  ]
  return Math.random() < 0.5
    ? null
    : notes[Math.floor(Math.random() * notes.length)]
}

async function cleanAllData() {
  console.log('🧹 Cleaning all existing data...')

  await db.delete(streakLogTable)
  console.log('  ✅ Deleted all streak logs')

  await db.delete(streakGroupsTable)
  console.log('  ✅ Deleted all streak group associations')

  await db.delete(streaksTable)
  console.log('  ✅ Deleted all streaks')

  await db.delete(groupsTable)
  console.log('  ✅ Deleted all groups')

  console.log('🎯 All data cleaned successfully!\n')
}

async function createStreaks(): Promise<number[]> {
  console.log('Creating group and 9 streaks...')

  const [group] = await db
    .insert(groupsTable)
    .values({ name: 'Daily Habits' })
    .returning({ id: groupsTable.id })

  console.log(`Created group: Daily Habits (ID: ${group.id})`)

  const streakNames = [
    'Daily Exercise',
    'Reading Books',
    'Meditation',
    'Learning Code',
    'Healthy Eating',
    'Early Wake Up',
    'Journal Writing',
    'Water Intake',
    'Walking',
  ]

  const createdStreaks = []

  for (let i = 0; i < streakNames.length; i++) {
    const name = streakNames[i]

    const [streak] = await db
      .insert(streaksTable)
      .values({ name })
      .returning({ id: streaksTable.id })

    createdStreaks.push(streak.id)
    console.log(`Created streak: ${name} (ID: ${streak.id})`)

    await db.insert(streakGroupsTable).values({
      groupId: group.id,
      streakId: streak.id,
      sortOrder: i + 1,
    })

    console.log(`  Added to group with sort order: ${i + 1}`)
  }

  return createdStreaks
}

async function insertStreakLogs(streakIds: number[]) {
  console.log(`Starting to insert ${TOTAL_RECORDS} records...`)

  let totalInserted = 0

  for (let streakIndex = 0; streakIndex < streakIds.length; streakIndex++) {
    const streakId = streakIds[streakIndex]
    const recordsForThisStreak = RECORDS_PER_STREAK

    console.log(
      `Generating ${recordsForThisStreak.toLocaleString()} unique dates for streak ${streakId}...`,
    )

    const uniqueDates = generateUniqueDates(recordsForThisStreak)

    console.log(
      `Inserting ${recordsForThisStreak.toLocaleString()} records for streak ${streakId}...`,
    )

    let inserted = 0
    while (inserted < recordsForThisStreak) {
      const batchSize = Math.min(BATCH_SIZE, recordsForThisStreak - inserted)
      const batch = []

      for (let i = 0; i < batchSize; i++) {
        batch.push({
          date: uniqueDates[inserted + i],
          streakId,
          note: generateRandomNote(),
        })
      }

      await db.insert(streakLogTable).values(batch)
      inserted += batchSize
      totalInserted += batchSize

      if (inserted % 10000 === 0 || inserted === recordsForThisStreak) {
        console.log(
          `  Progress: ${inserted.toLocaleString()}/${recordsForThisStreak.toLocaleString()} (Total: ${totalInserted.toLocaleString()}/${TOTAL_RECORDS.toLocaleString()})`,
        )
      }
    }

    console.log(
      `Completed streak ${streakId}: ${recordsForThisStreak.toLocaleString()} records`,
    )
  }

  console.log(
    `\n✅ Successfully inserted ${totalInserted.toLocaleString()} records across ${NUM_STREAKS} streaks!`,
  )
}

try {
  console.log('🚀 Starting bulk insert script...')
  console.log(
    `Target: ${RECORDS_PER_STREAK.toLocaleString()} records per streak (${TOTAL_RECORDS.toLocaleString()} total across ${NUM_STREAKS} streaks)`,
  )
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`)
  console.log('')

  const startTime = Date.now()

  await cleanAllData()

  const streakIds = await createStreaks()
  console.log('')

  await insertStreakLogs(streakIds)

  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000

  console.log(`\n🎉 Script completed in ${duration.toFixed(2)} seconds`)
  console.log(
    `Average: ${Math.round(TOTAL_RECORDS / duration).toLocaleString()} records/second`,
  )
} catch (error) {
  console.error('❌ Error during bulk insert:', error)
  process.exit(1)
}
