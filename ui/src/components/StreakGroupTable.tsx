import dayjs from 'dayjs'
import { type Dispatch, type SetStateAction, useMemo } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import {
  createStreakLog,
  deleteStreakLog,
  type StreakGroup,
  type StreakRecord,
} from '../api'
import './StreakGroupTable.css'

interface StreakGroupTableProps {
  streakData: StreakGroup[]
  loading: boolean
  error: string | null
  onStreakDataChange: Dispatch<SetStateAction<StreakGroup[]>>
}

const generateDateRange = (dates: string[]): string[] => {
  if (dates.length === 0) return []

  const sortedDates = [...dates].sort()
  const startDate = dayjs(sortedDates[0])
  const endDate = dayjs(sortedDates[sortedDates.length - 1])

  const allDates: string[] = []
  let iterDate = startDate
  while (iterDate.isBefore(endDate) || iterDate.isSame(endDate)) {
    allDates.push(iterDate.format('YYYY-MM-DD'))
    iterDate = iterDate.add(1, 'day')
  }
  return allDates
}

const calculateRunningStreaks = (
  allStreaks: { name: string; records: StreakRecord[] }[],
  dateRows: { date: string }[],
): Map<string, number> => {
  const runningStreaks = new Map<string, number>()
  const allDatesInRange = dateRows.map((row) => row.date)

  const countConsecutiveDaysFromIndex = (
    recordsMap: Map<string, boolean>,
    startIndex: number,
    increment: number,
  ): number => {
    let count = 0
    for (
      let i = startIndex;
      i >= 0 && i < allDatesInRange.length;
      i += increment
    ) {
      if (recordsMap.get(allDatesInRange[i])) {
        count++
      } else {
        break
      }
    }
    return count
  }

  allStreaks.forEach((streak) => {
    const recordsMap = new Map(streak.records.map((r) => [r.date, r.present]))
    const todayIndex = allDatesInRange.length - 1
    const yesterdayIndex = allDatesInRange.length - 2

    const hasTodayRecord = recordsMap.get(allDatesInRange[todayIndex])
    const hasYesterdayRecord =
      yesterdayIndex >= 0 && recordsMap.get(allDatesInRange[yesterdayIndex])

    let runningStreak = 0

    if (hasTodayRecord) {
      // Current active streak: count backwards from today
      runningStreak = countConsecutiveDaysFromIndex(recordsMap, todayIndex, -1)
    } else if (hasYesterdayRecord) {
      // Streak ended yesterday: count the completed streak
      runningStreak = countConsecutiveDaysFromIndex(
        recordsMap,
        yesterdayIndex,
        -1,
      )
    } else {
      // No recent activity: count negative days (days without records)
      for (let i = todayIndex; i >= 0; i--) {
        if (recordsMap.get(allDatesInRange[i])) {
          break
        }
        runningStreak--
      }
    }

    runningStreaks.set(streak.name, runningStreak)
  })

  return runningStreaks
}

export default function StreakGroupTable({
  streakData,
  loading,
  error,
  onStreakDataChange,
}: StreakGroupTableProps) {
  const allStreaks = useMemo(() => {
    return streakData.flatMap((group) =>
      group.streaks.map((streak) => ({
        id: streak.id,
        name: streak.name,
        groupName: group.name,
        records: streak.records,
      })),
    )
  }, [streakData])

  const dateRows = useMemo(() => {
    const dateSet = new Set<string>()
    allStreaks.forEach((streak) => {
      streak.records.forEach((record) => dateSet.add(record.date))
    })

    const today = dayjs().format('YYYY-MM-DD')
    dateSet.add(today)

    const allDates = generateDateRange(Array.from(dateSet))
    const recordsLookup = new Map(
      allStreaks.map((streak) => [
        streak.name,
        new Map(streak.records.map((record) => [record.date, record.present])),
      ]),
    )

    return allDates.map((date) => ({
      date,
      dayOfWeek: dayjs(date).format('dddd'),
      records: new Map(
        allStreaks.map((streak) => [
          streak.name,
          recordsLookup.get(streak.name)?.get(date) ?? false,
        ]),
      ),
    }))
  }, [allStreaks])

  const streakTotals = useMemo(
    () => calculateRunningStreaks(allStreaks, dateRows),
    [allStreaks, dateRows],
  )

  const streakLookup = useMemo(() => {
    const lookup = new Map<
      string,
      { groupIndex: number; streakIndex: number; streakId: number }
    >()
    streakData.forEach((group, groupIndex) => {
      group.streaks.forEach((streak, streakIndex) => {
        lookup.set(streak.name, {
          groupIndex,
          streakIndex,
          streakId: streak.id,
        })
      })
    })
    return lookup
  }, [streakData])

  const toggleStreakRecord = async (streakName: string, date: string) => {
    const streakLocation = streakLookup.get(streakName)
    const dateRow = dateRows.find((row) => row.date === date)
    if (!streakLocation || !dateRow) return

    const { groupIndex, streakIndex, streakId } = streakLocation
    const currentPresent = dateRow.records.get(streakName) ?? false
    const newPresent = !currentPresent

    try {
      if (newPresent) {
        // Creating a new streak log record
        await createStreakLog(streakId, date)
      } else {
        // Deleting existing streak log record
        await deleteStreakLog(streakId, date)
      }

      // Update local state only after successful API call
      onStreakDataChange((prevData) => {
        const newData = [...prevData]
        const targetGroup = { ...newData[groupIndex] }
        const targetStreaks = [...targetGroup.streaks]
        const targetStreak = { ...targetStreaks[streakIndex] }
        const updatedRecords = [...targetStreak.records]

        const recordIndex = updatedRecords.findIndex((r) => r.date === date)

        if (newPresent) {
          if (recordIndex >= 0) {
            updatedRecords[recordIndex] = {
              ...updatedRecords[recordIndex],
              present: true,
            }
          } else {
            updatedRecords.push({ date, present: true })
          }
        } else if (recordIndex >= 0) {
          updatedRecords.splice(recordIndex, 1)
        }

        targetStreak.records = updatedRecords
        targetStreaks[streakIndex] = targetStreak
        targetGroup.streaks = targetStreaks
        newData[groupIndex] = targetGroup

        return newData
      })
    } catch (error) {
      console.error('Error toggling streak record:', error)
    }
  }

  const currentDate = dayjs().format('YYYY-MM-DD')

  if (loading)
    return (
      <div className="virtuoso-table-container loading-container">
        Loading streak data...
      </div>
    )

  if (error) {
    return (
      <div className="virtuoso-table-container error-container">
        <div>Error: {error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="retry-button"
        >
          Retry
        </button>
      </div>
    )
  }

  if (allStreaks.length === 0)
    return (
      <div className="virtuoso-table-container no-data-container">
        No streak data available
      </div>
    )

  return (
    <div className="virtuoso-table-container">
      <TableVirtuoso
        data={dateRows}
        initialTopMostItemIndex={dateRows.length - 1}
        fixedHeaderContent={() => (
          <tr className="table-header">
            <th className="header-cell header-cell-date">Date</th>
            <th className="header-cell header-cell-day">Day</th>
            {allStreaks.map((streak) => (
              <th key={streak.name} className="header-cell header-cell-streak">
                <div>{streak.name}</div>
              </th>
            ))}
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="table-footer">
            <td colSpan={2} className="footer-label">
              Streak
            </td>
            {allStreaks.map((streak) => (
              <td key={`total-${streak.name}`} className="footer-cell">
                {streakTotals.get(streak.name) || 0}
              </td>
            ))}
          </tr>
        )}
        itemContent={(_index, dateRow) => {
          const isCurrentDate = dateRow.date === currentDate
          const allStreaksAbsent = allStreaks.every(
            (streak) => !dateRow.records.get(streak.name),
          )

          const rowBackgroundClass = isCurrentDate
            ? 'current-date-background'
            : allStreaksAbsent
              ? 'all-absent-background'
              : ''

          return (
            <>
              <td className={`table-cell date-cell ${rowBackgroundClass}`}>
                {dayjs(dateRow.date).format('DD-MMM-YY')}
              </td>
              <td className={`table-cell day-cell ${rowBackgroundClass}`}>
                {dateRow.dayOfWeek}
              </td>
              {allStreaks.map((streak) => {
                const present = dateRow.records.get(streak.name)
                const presentClass = present ? 'streak-cell-present' : ''
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: user requested no accessibility fixes
                  <td
                    key={streak.name}
                    className={`table-cell streak-cell ${rowBackgroundClass} ${presentClass}`}
                    onClick={() =>
                      toggleStreakRecord(streak.name, dateRow.date)
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    {present ? 'x' : ''}
                  </td>
                )
              })}
            </>
          )
        }}
      />
    </div>
  )
}
