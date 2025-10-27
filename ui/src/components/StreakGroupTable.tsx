import dayjs from 'dayjs'
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import {
  renameStreak,
  type StreakGroup,
  type StreakRecord,
  toggleStreakLog,
  updateStreakLogNote,
} from '../api'
import confirmAsync from './confirmAsync'
import './StreakGroupTable.css'
import { useMobileStreakInteraction } from '../hooks/useMobileStreakInteraction'
import MobileStreakActionModal from './MobileStreakActionModal'
import Modal from './Modal'

interface StreakGroupTableProps {
  streakData: StreakGroup[]
  loading: boolean
  error: string | null
  onStreakDataChange: Dispatch<SetStateAction<StreakGroup[]>>
}

const generateDateRange = (dates: string[]): string[] => {
  const today = dayjs()

  if (dates.length === 0) {
    const dateArray: string[] = []
    for (let i = 6; i >= 0; i--) {
      dateArray.push(today.subtract(i, 'day').format('YYYY-MM-DD'))
    }
    return dateArray
  }

  const sortedDates = [...dates].sort()
  const startDate = dayjs(sortedDates[0])
  const lastRecorded = dayjs(sortedDates[sortedDates.length - 1])
  const endDate = today.isAfter(lastRecorded) ? today : lastRecorded

  const sevenDaysAgo = today.subtract(6, 'day')
  const actualStartDate = startDate.isBefore(sevenDaysAgo)
    ? startDate
    : sevenDaysAgo

  const allDates: string[] = []
  let iterDate = actualStartDate
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
  const [blockInfo, setBlockInfo] = useState<
    | {
        isOpen: true
        date: string
        streakName: string
        tasks: { task: string; group: string }[]
        message?: string
      }
    | { isOpen: false }
  >({ isOpen: false })
  const [renameModal, setRenameModal] = useState<
    { isOpen: true; streakId: number; oldName: string } | { isOpen: false }
  >({ isOpen: false })
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (renameModal.isOpen) {
      setTimeout(() => renameInputRef.current?.focus(), 0)
    }
  }, [renameModal.isOpen])

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
            {
              done: record.done,
              note: record.note,
              addedByTasks: record.addedByTasks ?? [],
            },
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
            addedByTasks: [],
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

  const toggleStreakRecord = async (
    streakName: string,
    date: string,
    options?: { skipAddConfirm?: boolean },
  ): Promise<boolean | undefined> => {
    const streakLocation = streakLookup.get(streakName)
    const dateRow = dateRows.find((row) => row.date === date)
    if (!streakLocation || !dateRow) return undefined

    const { groupIndex, streakIndex, streakId } = streakLocation

    // Prevent removing a streak if it's marked done by a task
    const recordData = dateRow.records.get(streakName)
    const isDone = recordData?.done === true
    const addedByTasks = recordData?.addedByTasks ?? []
    if (isDone && addedByTasks.length > 0) {
      setBlockInfo({
        isOpen: true,
        date,
        streakName,
        tasks: addedByTasks,
        message:
          "This streak was marked done by the following task(s) and can't be removed here. Undo/remove the task to remove this streak entry.",
      })
      return undefined
    }

    const today = dayjs().startOf('day')
    const todayString = today.format('YYYY-MM-DD')
    const targetDate = dayjs(date)

    if (
      !isDone &&
      targetDate.isBefore(today, 'day') &&
      options?.skipAddConfirm !== true
    ) {
      const ok = await confirmAsync({
        title: 'Confirm add',
        message: `Mark this streak as done on ${targetDate.format('DD-MMM-YY')}?`,
        confirmLabel: 'Add mark',
        cancelLabel: 'Cancel',
        maxWidth: '480px',
      })
      if (!ok) return undefined
    }

    if (isDone && date !== todayString) {
      const ok = await confirmAsync({
        title: 'Confirm delete',
        message: `Remove this streak mark from ${targetDate.format('DD-MMM-YY')}? This will delete the record for that day.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        maxWidth: '480px',
      })
      if (!ok) return undefined
    }

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
      return updatedLog.done
    } catch (error: unknown) {
      console.error('Error toggling streak record:', error)
      // If server blocked due to linked tasks, show modal with details
      const message =
        (error as Error)?.message || 'Failed to toggle streak record'
      // Try to parse tasks from message (fallback) — server also sends details.tasks
      let tasks: { task: string; group: string }[] = []
      const anyErr = error as Error & {
        details?: {
          tasks?: string[]
          items?: { task: string; group?: string }[]
        }
      }
      if (anyErr.details?.items) {
        tasks = anyErr.details.items
          .filter(
            (item): item is { task: string; group: string } => !!item.group,
          )
          .map((item) => ({ task: item.task, group: item.group }))
      }

      if (tasks.length > 0 || message) {
        setBlockInfo({
          isOpen: true,
          date,
          streakName,
          tasks,
          message,
        })
      }
      return undefined
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

  const getRecordForCell = useCallback(
    (streakName: string, date: string) => {
      const dateRow = dateRows.find((row) => row.date === date)
      return dateRow?.records.get(streakName)
    },
    [dateRows],
  )

  const {
    modalState: mobileModalState,
    noteDraft: mobileNoteDraft,
    setNoteDraft: setMobileNoteDraft,
    modalError: mobileModalError,
    modalSaving: mobileModalSaving,
    handleConfirm: handleMobileModalConfirm,
    handleRemove: handleMobileModalRemove,
    closeModal: closeMobileModal,
    handleTouchStart: handleStreakCellTouchStart,
    handleTouchMove: handleStreakCellTouchMove,
    handleTouchEnd: handleStreakCellTouchEnd,
    handleTouchCancel: handleStreakCellTouchCancel,
    consumeClickSuppression,
  } = useMobileStreakInteraction({
    getRecord: (streakName, date) => {
      const record = getRecordForCell(streakName, date)
      if (!record) return undefined
      return { done: record.done ?? false, note: record.note }
    },
    toggleStreakRecord,
    updateNoteContent,
  })

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
    if (consumeClickSuppression()) {
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

  const handleRenameStreak = async (streakId: number, oldName: string) => {
    setRenameModal({ isOpen: true, streakId, oldName })
  }

  const closeRenameModal = () => setRenameModal({ isOpen: false })

  const submitRename = async () => {
    if (!renameModal.isOpen) return
    const input = renameInputRef.current
    if (!input) return
    const newName = input.value.trim()
    if (!newName || newName === renameModal.oldName) {
      closeRenameModal()
      return
    }

    try {
      const updated = await renameStreak(renameModal.streakId, newName)
      onStreakDataChange((prev) => {
        return prev.map((group) => ({
          ...group,
          streaks: group.streaks.map((s) =>
            s.id === updated.id ? { ...s, name: updated.name } : s,
          ),
        }))
      })
      closeRenameModal()
    } catch (err) {
      console.error('Failed to rename streak:', err)
      // show an alert inside modal
      if (typeof (err as Error).message === 'string') {
        alert((err as Error).message)
      } else {
        alert('Failed to rename streak')
      }
    }
  }

  const groupTasks = (tasks: { task: string; group: string }[]) => {
    const groups = new Map<string, { task: string; group: string }[]>()
    for (const taskObj of tasks) {
      const groupName = taskObj.group
      let group = groups.get(groupName)
      if (!group) {
        group = []
        groups.set(groupName, group)
      }
      group.push(taskObj)
    }
    return groups
  }

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
      {blockInfo.isOpen && (
        <Modal
          isOpen={true}
          onClose={() => setBlockInfo({ isOpen: false })}
          title="Streak change blocked"
          maxWidth="520px"
        >
          <div>
            <div style={{ marginBottom: '0.5rem' }}>
              {blockInfo.message ||
                "This streak was set by task(s) and can't be removed here."}
            </div>
            {blockInfo.tasks?.length > 0 && (
              <div>
                {Array.from(groupTasks(blockInfo.tasks).entries()).map(
                  ([groupName, taskNames]) => (
                    <div key={groupName} style={{ marginBottom: '1rem' }}>
                      <div
                        style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}
                      >
                        {groupName}
                      </div>
                      <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
                        {taskNames.map((taskObj) => (
                          <li key={taskObj.task}>{taskObj.task}</li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
      <TableVirtuoso
        data={dateRows}
        initialTopMostItemIndex={dateRows.length - 1}
        increaseViewportBy={2000}
        fixedHeaderContent={() => (
          <tr className="table-header">
            <th className="header-cell header-cell-date">Date</th>
            <th className="header-cell header-cell-day">Day</th>
            {allStreaks.map((streak) => (
              <th
                key={streak.name}
                className="header-cell header-cell-streak"
                onClick={() => handleRenameStreak(streak.id, streak.name)}
              >
                {streak.name}
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
                    onTouchStart={(event) =>
                      handleStreakCellTouchStart(
                        event,
                        streak.name,
                        dateRow.date,
                      )
                    }
                    onTouchMove={handleStreakCellTouchMove}
                    onTouchEnd={(event) =>
                      handleStreakCellTouchEnd(event, streak.name, dateRow.date)
                    }
                    onTouchCancel={handleStreakCellTouchCancel}
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
      <MobileStreakActionModal
        state={mobileModalState}
        noteDraft={mobileNoteDraft}
        setNoteDraft={setMobileNoteDraft}
        error={mobileModalError}
        saving={mobileModalSaving}
        onClose={closeMobileModal}
        onConfirm={handleMobileModalConfirm}
        onRemove={handleMobileModalRemove}
      />
      {renameModal.isOpen && (
        <Modal
          isOpen={true}
          onClose={closeRenameModal}
          title="Rename streak"
          maxWidth="480px"
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            <input
              ref={renameInputRef}
              defaultValue={renameModal.isOpen ? renameModal.oldName : ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeRenameModal()
                }
              }}
              className="streak-name-input"
              spellCheck={false}
            />
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
              }}
            >
              <button type="button" onClick={closeRenameModal} className="btn">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                className="btn btn-primary"
              >
                Rename
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
