import dayjs from 'dayjs'
import { type Dispatch, type SetStateAction, useMemo, useRef } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import {
  type StreakGroup,
  type StreakRecord,
  toggleStreakLog,
  updateStreakLogNote,
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
    const recordsMap = new Map(streak.records.map((r) => [r.date, r.done]))
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
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggeredRef = useRef(false)

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
        new Map(
          streak.records.map((record) => [
            record.date,
            { done: record.done, note: record.note },
          ]),
        ),
      ]),
    )

    return allDates.map((date) => ({
      date,
      dayOfWeek: dayjs(date).format('dddd'),
      records: new Map(
        allStreaks.map((streak) => [
          streak.name,
          recordsLookup.get(streak.name)?.get(date) ?? {
            done: false,
            note: undefined,
          },
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

    try {
      const updatedLog = await toggleStreakLog(streakId, date)

      onStreakDataChange((prevData) => {
        const newData = [...prevData]
        const targetGroup = { ...newData[groupIndex] }
        const targetStreaks = [...targetGroup.streaks]
        const targetStreak = { ...targetStreaks[streakIndex] }
        const updatedRecords = [...targetStreak.records]

        const recordIndex = updatedRecords.findIndex((r) => r.date === date)

        if (updatedLog.done) {
          if (recordIndex >= 0) {
            updatedRecords[recordIndex] = {
              ...updatedRecords[recordIndex],
              done: true,
            }
          } else {
            updatedRecords.push({ date, done: true })
          }
        } else {
          if (recordIndex >= 0) {
            updatedRecords[recordIndex] = {
              ...updatedRecords[recordIndex],
              done: false,
            }
          } else {
            updatedRecords.push({ date, done: false })
          }
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

  const updateNoteContent = async (
    streakName: string,
    date: string,
    newNote: string,
  ) => {
    const streakLocation = streakLookup.get(streakName)
    if (!streakLocation) return

    const { groupIndex, streakIndex, streakId } = streakLocation

    try {
      await updateStreakLogNote(streakId, date, newNote)

      onStreakDataChange((prevData) => {
        const newData = [...prevData]
        const targetGroup = { ...newData[groupIndex] }
        const targetStreaks = [...targetGroup.streaks]
        const targetStreak = { ...targetStreaks[streakIndex] }
        const updatedRecords = [...targetStreak.records]

        const recordIndex = updatedRecords.findIndex((r) => r.date === date)

        if (recordIndex >= 0) {
          updatedRecords[recordIndex] = {
            ...updatedRecords[recordIndex],
            note: newNote,
          }
        } else {
          updatedRecords.push({ date, done: false, note: newNote })
        }

        targetStreak.records = updatedRecords
        targetStreaks[streakIndex] = targetStreak
        targetGroup.streaks = targetStreaks
        newData[groupIndex] = targetGroup

        return newData
      })
    } catch (error) {
      console.error('Error updating note:', error)
    }
  }

  const handleNoteAction = (streakName: string, date: string) => {
    const dateRow = dateRows.find((row) => row.date === date)
    if (!dateRow) return

    const recordData = dateRow.records.get(streakName)
    const hasNote = recordData?.note && recordData.note.trim().length > 0

    if (hasNote) {
      // Focus on existing note
      setTimeout(() => {
        const noteElement = document.querySelector(
          `[data-streak-note="${streakName}-${date}"]`,
        ) as HTMLElement
        if (noteElement) {
          noteElement.focus()
          // Place cursor at end of text
          const range = document.createRange()
          const selection = window.getSelection()
          range.selectNodeContents(noteElement)
          range.collapse(false)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }, 0)
    } else {
      // Create new note
      updateNoteContent(streakName, date, 'Note: ')
      setTimeout(() => {
        const noteElement = document.querySelector(
          `[data-streak-note="${streakName}-${date}"]`,
        ) as HTMLElement
        if (noteElement) {
          noteElement.focus()
          // Select all text so user can start typing
          const range = document.createRange()
          const selection = window.getSelection()
          range.selectNodeContents(noteElement)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }, 200)
    }
  }

  const handleStreakCellMouseDown = (streakName: string, date: string) => {
    longPressTriggeredRef.current = false
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      handleNoteAction(streakName, date)
    }, 500)
  }

  const handleStreakCellMouseUp = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
  }

  const handleStreakCellKeyDown = (
    event: React.KeyboardEvent,
    streakName: string,
    date: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        handleNoteAction(streakName, date)
      } else {
        toggleStreakRecord(streakName, date)
      }
    }
  }

  const handleStreakCellClick = (
    event: React.MouseEvent,
    streakName: string,
    date: string,
  ) => {
    // Clear any existing long press timeout
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }

    // Don't process click if long press was triggered
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }

    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click or Cmd+click to add/focus note
      event.preventDefault()
      handleNoteAction(streakName, date)
    } else {
      // Regular click to toggle streak
      toggleStreakRecord(streakName, date)
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
        increaseViewportBy={2000}
        fixedHeaderContent={() => (
          <tr className="table-header">
            <th className="header-cell header-cell-date">Date</th>
            <th className="header-cell header-cell-day">Day</th>
            {allStreaks.map((streak) => (
              <th key={streak.name} className="header-cell header-cell-streak">
                <div>{streak.name}</div>
              </th>
            ))}
            <th className="header-cell header-cell-notes">Notes</th>
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
            <td className="footer-cell"></td>
          </tr>
        )}
        itemContent={(_index, dateRow) => {
          const isCurrentDate = dateRow.date === currentDate
          const allStreaksAbsent = allStreaks.every(
            (streak) => !dateRow.records.get(streak.name)?.done,
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
                const recordData = dateRow.records.get(streak.name)
                const done = recordData?.done ?? false
                const hasNote =
                  recordData?.note && recordData.note.trim().length > 0
                const doneClass = done ? 'streak-cell-present' : ''
                return (
                  <td
                    key={streak.name}
                    className={`table-cell streak-cell ${rowBackgroundClass} ${doneClass}`}
                    onClick={(event) =>
                      handleStreakCellClick(event, streak.name, dateRow.date)
                    }
                    onKeyDown={(event) =>
                      handleStreakCellKeyDown(event, streak.name, dateRow.date)
                    }
                    onMouseDown={() =>
                      handleStreakCellMouseDown(streak.name, dateRow.date)
                    }
                    onMouseUp={handleStreakCellMouseUp}
                    onMouseLeave={handleStreakCellMouseUp}
                    onTouchStart={() =>
                      handleStreakCellMouseDown(streak.name, dateRow.date)
                    }
                    onTouchEnd={handleStreakCellMouseUp}
                    style={{ cursor: 'pointer' }}
                  >
                    {done ? 'x' : ''}
                    {hasNote && <div className="note-earmark" />}
                  </td>
                )
              })}
              <td className={`table-cell notes-cell ${rowBackgroundClass}`}>
                <div className="notes-display">
                  {allStreaks
                    .filter((streak) => {
                      const recordData = dateRow.records.get(streak.name)
                      return (
                        recordData?.note && recordData.note.trim().length > 0
                      )
                    })
                    .map((streak) => {
                      const recordData = dateRow.records.get(streak.name)
                      const note = recordData?.note?.trim()

                      return (
                        <div
                          key={`${streak.name}-${dateRow.date}`}
                          className="streak-note"
                        >
                          <div className="streak-note-header">
                            {streak.name}:
                          </div>
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: contentEditable requires interactive behavior */}
                          <span
                            className="streak-note-content"
                            data-streak-note={`${streak.name}-${dateRow.date}`}
                            contentEditable="plaintext-only"
                            suppressContentEditableWarning={true}
                            spellCheck={false}
                            onBlur={(e) => {
                              const newNote = e.currentTarget.textContent || ''
                              if (newNote !== note) {
                                updateNoteContent(
                                  streak.name,
                                  dateRow.date,
                                  newNote,
                                )
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                e.currentTarget.blur()
                              }
                            }}
                          >
                            {note}
                          </span>
                        </div>
                      )
                    })}
                </div>
              </td>
            </>
          )
        }}
      />
    </div>
  )
}
