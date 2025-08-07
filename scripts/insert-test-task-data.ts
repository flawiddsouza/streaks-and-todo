import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import {
  groupNotesTable,
  groupsTable,
  taskLogTable,
  tasksTable,
} from '../src/db/schema'

const RECORDS_PER_TASK = 500
const NUM_TASK_GROUPS = 3
const TASKS_PER_GROUP = 5
const TOTAL_TASKS = NUM_TASK_GROUPS * TASKS_PER_GROUP
const TOTAL_RECORDS = RECORDS_PER_TASK * TOTAL_TASKS
const BATCH_SIZE = 100

function generateUniqueDates(count: number): string[] {
  const now = new Date()
  // Expand to 2 years ago to ensure we have enough unique dates
  const twoYearsAgo = new Date(
    now.getFullYear() - 2,
    now.getMonth(),
    now.getDate(),
  )

  const dates = new Set<string>()

  // Add safety check to prevent infinite loop
  const maxAttempts = count * 10
  let attempts = 0

  while (dates.size < count && attempts < maxAttempts) {
    const randomTime =
      twoYearsAgo.getTime() +
      Math.random() * (now.getTime() - twoYearsAgo.getTime())
    const date = new Date(randomTime).toISOString().split('T')[0]
    dates.add(date)
    attempts++
  }

  if (dates.size < count) {
    console.warn(
      `Warning: Could only generate ${dates.size} unique dates out of ${count} requested`,
    )
  }

  return Array.from(dates).sort()
}

function generateRandomExtraInfo(): string | null {
  const extraInfoOptions = [
    null,
    'Completed quickly',
    'Took longer than expected',
    'Good progress',
    'Challenging task',
    'Well done',
    'Need to improve',
    'Perfect execution',
    'Room for improvement',
    'Excellent work',
  ]
  return Math.random() < 0.6
    ? null
    : extraInfoOptions[Math.floor(Math.random() * extraInfoOptions.length)]
}

function generateRandomGroupNote(): string {
  const noteOptions = [
    'Productive day overall',
    'Good team collaboration',
    'Met all deadlines',
    'Some challenges but overcame them',
    'Smooth workflow today',
    'Great communication',
    'Effective problem solving',
    'Strong focus and dedication',
    'Excellent teamwork',
    'Successful completion of goals',
  ]
  return noteOptions[Math.floor(Math.random() * noteOptions.length)]
}

async function cleanTaskData() {
  console.log('🧹 Cleaning existing task data...')

  await db.delete(groupNotesTable)
  console.log('  ✅ Deleted all group notes')

  await db.delete(taskLogTable)
  console.log('  ✅ Deleted all task logs')

  await db.delete(tasksTable)
  console.log('  ✅ Deleted all tasks')
  // Delete only task groups, not all groups
  await db.delete(groupsTable).where(eq(groupsTable.type, 'tasks'))
  console.log('  ✅ Deleted all task groups')

  console.log('🎯 Task data cleaned successfully!\n')
}

async function createTaskGroups(): Promise<
  { groupId: number; taskIds: number[] }[]
> {
  console.log('Creating task groups and tasks...')

  const taskGroupsData = [
    {
      name: 'Daily Work Tasks',
      tasks: [
        'Check emails',
        'Review code',
        'Attend standup meeting',
        'Update project documentation',
        "Plan tomorrow's work",
      ],
    },
    {
      name: 'Personal Projects',
      tasks: [
        'Work on side project',
        'Learn new technology',
        'Write blog post',
        'Practice coding challenges',
        'Update portfolio',
      ],
    },
    {
      name: 'Health & Wellness',
      tasks: [
        'Take vitamins',
        'Drink 8 glasses of water',
        'Take breaks every hour',
        'Stretch exercises',
        'Prepare healthy meals',
      ],
    },
  ]

  const createdGroups = []

  for (let groupIndex = 0; groupIndex < taskGroupsData.length; groupIndex++) {
    const groupData = taskGroupsData[groupIndex]

    const [group] = await db
      .insert(groupsTable)
      .values({
        name: groupData.name,
        type: 'tasks',
        sortOrder: groupIndex + 1,
      })
      .returning({ id: groupsTable.id })

    console.log(`Created task group: ${groupData.name} (ID: ${group.id})`)

    const taskIds = []

    for (let taskIndex = 0; taskIndex < groupData.tasks.length; taskIndex++) {
      const taskName = groupData.tasks[taskIndex]

      const [task] = await db
        .insert(tasksTable)
        .values({
          groupId: group.id,
          task: taskName,
        })
        .returning({ id: tasksTable.id })

      taskIds.push(task.id)
      console.log(`  Created task: ${taskName} (ID: ${task.id})`)
    }

    createdGroups.push({
      groupId: group.id,
      taskIds: taskIds,
    })

    console.log(`  Added ${taskIds.length} tasks to group\n`)
  }

  return createdGroups
}

async function insertTaskLogs(
  groups: { groupId: number; taskIds: number[] }[],
) {
  console.log(`Starting to insert ${TOTAL_RECORDS} task log records...`)

  let totalInserted = 0

  for (const group of groups) {
    for (let taskIndex = 0; taskIndex < group.taskIds.length; taskIndex++) {
      const taskId = group.taskIds[taskIndex]
      const recordsForThisTask = RECORDS_PER_TASK

      console.log(
        `Generating ${recordsForThisTask.toLocaleString()} unique dates for task ${taskId}...`,
      )

      const uniqueDates = generateUniqueDates(recordsForThisTask)

      console.log(
        `Inserting ${recordsForThisTask.toLocaleString()} records for task ${taskId}...`,
      )

      let inserted = 0
      while (inserted < recordsForThisTask) {
        const batchSize = Math.min(BATCH_SIZE, recordsForThisTask - inserted)
        const batch = []

        for (let i = 0; i < batchSize; i++) {
          batch.push({
            date: uniqueDates[inserted + i],
            taskId,
            extraInfo: generateRandomExtraInfo(),
            done: Math.random() > 0.15, // 85% completion rate
            sortOrder: i + 1,
          })
        }

        await db.insert(taskLogTable).values(batch)
        inserted += batchSize
        totalInserted += batchSize

        if (inserted % 5000 === 0 || inserted === recordsForThisTask) {
          console.log(
            `  Progress: ${inserted.toLocaleString()}/${recordsForThisTask.toLocaleString()} (Total: ${totalInserted.toLocaleString()}/${TOTAL_RECORDS.toLocaleString()})`,
          )
        }
      }

      console.log(
        `Completed task ${taskId}: ${recordsForThisTask.toLocaleString()} records`,
      )
    }
  }

  console.log(
    `\n✅ Successfully inserted ${totalInserted.toLocaleString()} task log records across ${TOTAL_TASKS} tasks!`,
  )
}

async function insertGroupNotes(
  groups: { groupId: number; taskIds: number[] }[],
) {
  console.log('Inserting group notes...')

  const uniqueDates = generateUniqueDates(200) // 200 random dates for group notes

  let totalNotesInserted = 0

  for (const group of groups) {
    const notesForThisGroup = Math.floor(uniqueDates.length / groups.length)
    const groupDates = uniqueDates.slice(
      totalNotesInserted,
      totalNotesInserted + notesForThisGroup,
    )

    const batch = groupDates
      .filter(() => Math.random() < 0.3) // Only 30% of dates get notes
      .map((date) => ({
        date,
        groupId: group.groupId,
        note: generateRandomGroupNote(),
      }))

    await db.insert(groupNotesTable).values(batch)
    totalNotesInserted += batch.length

    console.log(`  Added ${batch.length} notes for group ${group.groupId}`)
  }

  console.log(`✅ Successfully inserted ${totalNotesInserted} group notes!`)
}

try {
  console.log('🚀 Starting task data insert script...')
  console.log(
    `Target: ${RECORDS_PER_TASK.toLocaleString()} records per task (${TOTAL_RECORDS.toLocaleString()} total across ${TOTAL_TASKS} tasks)`,
  )
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`)
  console.log('')

  const startTime = Date.now()

  await cleanTaskData()

  const groups = await createTaskGroups()
  console.log('')

  await insertTaskLogs(groups)
  console.log('')

  await insertGroupNotes(groups)

  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000

  console.log(`\n🎉 Script completed in ${duration.toFixed(2)} seconds`)
  console.log(
    `Average: ${Math.round(TOTAL_RECORDS / duration).toLocaleString()} records/second`,
  )
} catch (error) {
  console.error('❌ Error during task data insert:', error)
  process.exit(1)
}
