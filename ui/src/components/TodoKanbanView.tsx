import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import dayjs from 'dayjs'
import Downshift, { type StateChangeOptions } from 'downshift'
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  deleteTaskLogById,
  fetchGroupTasks,
  moveTaskLog,
  setTaskLog,
  type TaskGroup,
} from '../api'
import { formatTaskWithExtraInfo } from '../helpers'
import {
  createTaskAndAddToGroup,
  parseTaskWithExtraInfo,
} from '../utils/task-utils'
import confirmAsync from './confirmAsync'
import './TodoKanbanView.css'

interface TodoKanbanViewProps {
  taskData: TaskGroup[]
  loading: boolean
  error: string | null
  onTaskDataChange: Dispatch<SetStateAction<TaskGroup[]>>
  groupId?: number
  filterQuery?: string
}

interface KanbanCard {
  id: number // logId
  taskId: number
  taskName: string
  extraInfo?: string
  date: string
  done: boolean
  sortOrder: number
}

interface DateGroup {
  date: string
  cards: KanbanCard[]
}

interface FlatTask {
  id: number
  task: string
  groupName: string
  defaultExtraInfo?: string | null
  records: {
    id: number
    date: string
    done: boolean
    extraInfo?: string
    sortOrder: number
  }[]
}

interface DropZoneProps {
  date: string
  targetLogId: number
  position: 'before' | 'after'
  isDoneColumn: boolean
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
}

function DropZone({
  date,
  targetLogId,
  position,
  isDoneColumn,
  onReorder,
}: DropZoneProps) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const element = dropRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        if (source.data.type === 'kanban-card') {
          return source.data.cardId !== targetLogId
        }
        return false
      },
      onDragEnter: () => setIsActive(true),
      onDragLeave: () => setIsActive(false),
      onDrop: ({ source }) => {
        setIsActive(false)
        if (source.data.type === 'kanban-card') {
          const sourceLogId = source.data.cardId as number
          const sourceDate = source.data.date as string
          onReorder(
            date,
            sourceDate,
            sourceLogId,
            targetLogId,
            position,
            isDoneColumn,
          )
        }
      },
    })
  }, [date, targetLogId, position, isDoneColumn, onReorder])

  return (
    <div
      ref={dropRef}
      className={`kanban-drop-zone ${isActive ? 'kanban-drop-zone-active' : ''}`}
      data-position={position}
    />
  )
}

function KanbanCardComponent({
  card,
  onDelete,
  onReorder,
  filterQuery = '',
}: {
  card: KanbanCard
  onDelete: () => void
  onReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  filterQuery?: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  useEffect(() => {
    const element = cardRef.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'kanban-card',
          cardId: card.id,
          taskId: card.taskId,
          taskName: card.taskName,
          extraInfo: card.extraInfo,
          currentStatus: card.done ? 'done' : 'todo',
          date: card.date,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          return (
            source.data.type === 'kanban-card' && source.data.cardId !== card.id
          )
        },
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false)
          const sourceLogId = source.data.cardId as number
          const sourceDate = source.data.date as string
          if (sourceLogId === card.id) return
          // Pass the target card's done status so cross-column drops position correctly
          onReorder(
            card.date,
            sourceDate,
            sourceLogId,
            card.id,
            'before',
            card.done,
          )
        },
      }),
    )
  }, [card, onReorder])

  const { text: displayText } = formatTaskWithExtraInfo(
    card.taskName,
    card.extraInfo || '',
  )

  // Apply filter highlighting if filterQuery is provided
  const shouldHighlight =
    filterQuery.trim() &&
    displayText.toLowerCase().includes(filterQuery.toLowerCase())

  return (
    <div
      ref={cardRef}
      className={`kanban-card ${isDragging ? 'kanban-card-dragging' : ''} ${
        isDraggedOver ? 'kanban-card-drag-over' : ''
      } ${shouldHighlight ? 'kanban-card-highlighted' : ''}`}
      style={{ cursor: 'grab' }}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-task-name">{displayText}</span>
        <button
          type="button"
          className="kanban-card-delete-btn"
          onClick={onDelete}
          title="Delete task"
        >
          ×
        </button>
      </div>
    </div>
  )
}

function KanbanInput({
  date,
  isDoneColumn,
  availableTasks,
  onTaskSelect,
  disabled = false,
}: {
  date: string
  isDoneColumn: boolean
  availableTasks: FlatTask[]
  onTaskSelect: (
    task: FlatTask | null,
    inputValue: string,
    date: string,
    done: boolean,
    reset: () => void,
  ) => Promise<void>
  disabled?: boolean
}) {
  const [inputValue, setInputValue] = useState('')
  const menuRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  useEffect(() => {
    const updatePos = () => {
      const el = inputRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }

    if (menuOpen) {
      requestAnimationFrame(updatePos)
      window.addEventListener('resize', updatePos)
      window.addEventListener('scroll', updatePos, true)
      requestAnimationFrame(() => {
        const menu = menuRef.current
        if (menu) {
          const first = menu.querySelector('li') as HTMLElement | null
          first?.focus()
        }
      })
    }

    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [menuOpen])

  return (
    <Downshift<FlatTask>
      inputValue={inputValue}
      onInputValueChange={(v) => setInputValue(v)}
      onSelect={(selected) =>
        onTaskSelect(selected, inputValue, date, isDoneColumn, () =>
          setInputValue(''),
        )
      }
      selectedItem={null}
      itemToString={(item) => (item ? item.task : '')}
      onStateChange={(changes: StateChangeOptions<FlatTask>) => {
        if (changes.isOpen !== undefined) {
          setMenuOpen(Boolean(changes.isOpen))
        }
      }}
    >
      {({
        getInputProps,
        getItemProps,
        getMenuProps,
        isOpen,
        highlightedIndex,
      }) => {
        const _menuProps = getMenuProps(
          {},
          { suppressRefError: true },
        ) as unknown

        const dsRef = (
          _menuProps as {
            ref?:
              | ((el: HTMLUListElement | null) => void)
              | { current: HTMLUListElement | null }
              | null
          }
        ).ref
        const restMenuProps = _menuProps as Record<string, unknown>

        const combinedMenuRef = (el: HTMLUListElement | null) => {
          menuRef.current = el
          if (typeof dsRef === 'function') dsRef(el)
          else if (dsRef && 'current' in dsRef) {
            ;(dsRef as { current: HTMLUListElement | null }).current = el
          }
        }

        const filteredTasks =
          inputValue.trim() !== ''
            ? availableTasks.filter((item) =>
                item.task.toLowerCase().includes(inputValue.toLowerCase()),
              )
            : []

        return (
          <div className="kanban-input-wrap">
            <input
              {...getInputProps({
                placeholder: disabled
                  ? 'Select a date first...'
                  : 'Add task...',
                className: 'kanban-input',
                enterKeyHint: 'enter',
                disabled: disabled,
                onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (disabled) return
                  if (e.key === 'Home' || e.key === 'End') {
                    // biome-ignore lint/suspicious/noExplicitAny: type is not correct, preventDownshiftDefault is present
                    ;(e.nativeEvent as any).preventDownshiftDefault = true
                  }
                  if (e.key === 'Enter' && isOpen && highlightedIndex != null) {
                    return
                  }
                  if (e.key === 'Enter') {
                    onTaskSelect(null, inputValue, date, isDoneColumn, () =>
                      setInputValue(''),
                    )
                  }
                },
                spellCheck: false,
              })}
              ref={inputRef}
            />
            {!disabled && isOpen && menuPos && filteredTasks.length > 0
              ? createPortal(
                  <ul
                    {...(restMenuProps as JSX.IntrinsicElements['ul'])}
                    ref={combinedMenuRef}
                    className="kanban-combobox-menu"
                    style={{
                      position: 'absolute',
                      top: menuPos.top,
                      left: menuPos.left,
                      width: menuPos.width,
                      maxHeight: 280,
                      overflow: 'auto',
                      zIndex: 2000,
                      boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
                      background: 'white',
                      borderRadius: 4,
                    }}
                  >
                    {filteredTasks.map((item, index) => (
                      <li
                        {...getItemProps({ item, index })}
                        key={item.id}
                        className={
                          highlightedIndex === index ? 'highlighted' : ''
                        }
                      >
                        {item.task}
                        {item.defaultExtraInfo && (
                          <span className="task-extra-info">
                            {' '}
                            ({item.defaultExtraInfo})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>,
                  document.body,
                )
              : null}
          </div>
        )
      }}
    </Downshift>
  )
}

function KanbanColumn({
  title,
  dateGroups,
  isDoneColumn,
  onCardDelete,
  onCardStatusToggle,
  onCardReorder,
  onTaskSelect,
  availableTasks,
  filterQuery,
}: {
  title: string
  dateGroups: DateGroup[]
  isDoneColumn: boolean
  onCardDelete: (card: KanbanCard) => void
  onCardStatusToggle: (card: KanbanCard) => void
  onCardReorder: (
    targetDate: string,
    sourceDate: string,
    sourceLogId: number,
    targetLogId: number,
    position: 'before' | 'after',
    targetDone?: boolean,
  ) => void
  onTaskSelect: (
    task: FlatTask | null,
    inputValue: string,
    date: string,
    done: boolean,
    reset: () => void,
  ) => Promise<void>
  availableTasks: FlatTask[]
  filterQuery?: string
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)

  const totalCards = dateGroups.reduce(
    (sum, group) => sum + group.cards.length,
    0,
  )

  useEffect(() => {
    const element = columnRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        if (source.data.type !== 'kanban-card') return false
        const sourceStatus = source.data.currentStatus as string
        const targetStatus = isDoneColumn ? 'done' : 'todo'
        // Only allow drops from the opposite column
        return sourceStatus !== targetStatus
      },
      onDragEnter: () => setIsDropTarget(true),
      onDragLeave: () => setIsDropTarget(false),
      onDrop: ({ source }) => {
        setIsDropTarget(false)
        const cardId = source.data.cardId as number
        // Find the card from the source data
        const cardToToggle = {
          id: cardId,
          taskId: source.data.taskId as number,
          taskName: source.data.taskName as string,
          extraInfo: source.data.extraInfo as string | undefined,
          date: source.data.date as string,
          done: source.data.currentStatus === 'done',
          sortOrder: 0,
        }
        onCardStatusToggle(cardToToggle)
      },
    })
  }, [isDoneColumn, onCardStatusToggle])

  const [customDate, setCustomDate] = useState('')
  const [showCustomDateInput, setShowCustomDateInput] = useState(false)

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <h3 className="kanban-column-title">{title}</h3>
        <span className="kanban-column-count">{totalCards}</span>
      </div>
      <div
        ref={columnRef}
        className={`kanban-column-body ${
          isDropTarget ? 'kanban-column-drop-target' : ''
        }`}
      >
        {/* Custom Date Picker Section */}
        <div className="kanban-custom-date-section">
          {!showCustomDateInput ? (
            <button
              type="button"
              className="kanban-add-date-btn"
              onClick={() => setShowCustomDateInput(true)}
            >
              + Add task for specific date
            </button>
          ) : (
            <div className="kanban-custom-date-picker">
              <input
                type="date"
                className="kanban-date-input"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                placeholder="Select date..."
              />
              <KanbanInput
                date={customDate || dayjs().format('YYYY-MM-DD')}
                isDoneColumn={isDoneColumn}
                availableTasks={availableTasks}
                disabled={!customDate}
                onTaskSelect={async (task, inputValue, date, done, reset) => {
                  await onTaskSelect(task, inputValue, date, done, reset)
                  setCustomDate('')
                  setShowCustomDateInput(false)
                }}
              />
              <button
                type="button"
                className="kanban-cancel-date-btn"
                onClick={() => {
                  setCustomDate('')
                  setShowCustomDateInput(false)
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {dateGroups.length === 0 ? (
          <div className="kanban-column-empty">
            {isDoneColumn
              ? 'No completed tasks'
              : 'No pending tasks - drag from Done or add new tasks'}
          </div>
        ) : (
          dateGroups.map((group) => {
            const formattedDate = dayjs(group.date).format('MMM D, YYYY')
            const dayOfWeek = dayjs(group.date).format('dddd')
            const isToday = dayjs(group.date).isSame(dayjs(), 'day')

            return (
              <div key={group.date} className="kanban-date-group">
                <div
                  className={`kanban-date-header ${isToday ? 'kanban-date-today' : ''}`}
                >
                  <span className="kanban-date-label">{formattedDate}</span>
                  <span className="kanban-date-day">{dayOfWeek}</span>
                  <span className="kanban-date-count">
                    {group.cards.length}
                  </span>
                </div>
                <div className="kanban-date-cards">
                  {group.cards.length === 0 ? (
                    <DropZone
                      date={group.date}
                      targetLogId={-1}
                      position="after"
                      isDoneColumn={isDoneColumn}
                      onReorder={onCardReorder}
                    />
                  ) : (
                    group.cards.map((card, index) => (
                      <div key={card.id}>
                        {index === 0 && (
                          <DropZone
                            date={group.date}
                            targetLogId={card.id}
                            position="before"
                            isDoneColumn={isDoneColumn}
                            onReorder={onCardReorder}
                          />
                        )}
                        <KanbanCardComponent
                          card={card}
                          onDelete={() => onCardDelete(card)}
                          onReorder={onCardReorder}
                          filterQuery={filterQuery}
                        />
                        <DropZone
                          date={group.date}
                          targetLogId={card.id}
                          position="after"
                          isDoneColumn={isDoneColumn}
                          onReorder={onCardReorder}
                        />
                      </div>
                    ))
                  )}
                  <KanbanInput
                    date={group.date}
                    isDoneColumn={isDoneColumn}
                    availableTasks={availableTasks}
                    onTaskSelect={onTaskSelect}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default function TodoKanbanView({
  taskData,
  loading,
  error,
  onTaskDataChange,
  groupId,
  filterQuery = '',
}: TodoKanbanViewProps) {
  const kanbanData = useMemo(() => {
    const allCards: KanbanCard[] = []

    // Transform TaskGroup data into flat list of cards
    taskData.forEach((group) => {
      group.tasks.forEach((task) => {
        task.records.forEach((record) => {
          allCards.push({
            id: record.id,
            taskId: task.id,
            taskName: task.task,
            extraInfo: record.extraInfo,
            date: record.date,
            done: record.done,
            sortOrder: record.sortOrder,
          })
        })
      })
    })

    // Apply filter if provided
    let filteredCards = allCards
    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase()
      filteredCards = allCards.filter((card) => {
        const { text } = formatTaskWithExtraInfo(
          card.taskName,
          card.extraInfo || '',
        )
        return text.toLowerCase().includes(query)
      })
    }

    // Separate into TODO and DONE
    const todoCards = filteredCards.filter((card) => !card.done)
    const doneCards = filteredCards.filter((card) => card.done)

    // Group by date and sort
    const groupByDate = (cards: KanbanCard[]): DateGroup[] => {
      // Group by date
      const groupMap = new Map<string, KanbanCard[]>()
      cards.forEach((card) => {
        const existing = groupMap.get(card.date)
        if (existing) {
          existing.push(card)
        } else {
          groupMap.set(card.date, [card])
        }
      })

      // Ensure today is always present, even if empty (but only when no filter is active)
      if (!filterQuery.trim()) {
        const today = dayjs().format('YYYY-MM-DD')
        if (!groupMap.has(today)) {
          groupMap.set(today, [])
        }
      }

      // Convert to array, sort cards within each date by sortOrder ASC, then sort dates DESC
      const dateGroups = Array.from(groupMap.entries())
        .map(([date, cards]) => ({
          date,
          cards: cards.sort((a, b) => a.sortOrder - b.sortOrder),
        }))
        .sort((a, b) => b.date.localeCompare(a.date))

      return dateGroups
    }

    return {
      todoGroups: groupByDate(todoCards),
      doneGroups: groupByDate(doneCards),
    }
  }, [taskData, filterQuery])

  const toggleCardStatus = useCallback(
    async (card: KanbanCard) => {
      if (!groupId) return

      try {
        const updatedLog = await setTaskLog(
          card.taskId,
          card.date,
          !card.done,
          card.extraInfo,
          card.id,
        )

        let didUpdate = false
        onTaskDataChange((prev) => {
          const next = prev.map((group) => {
            const taskIndex = group.tasks.findIndex(
              (task) => task.id === updatedLog.taskId,
            )
            if (taskIndex === -1) return group

            const task = group.tasks[taskIndex]
            const recordIndex = task.records.findIndex(
              (record) => record.id === updatedLog.id,
            )
            if (recordIndex === -1) return group

            didUpdate = true

            const updatedRecords = task.records.map((record, idx) =>
              idx === recordIndex
                ? {
                    ...record,
                    date: updatedLog.date,
                    done: updatedLog.done,
                    extraInfo: updatedLog.extraInfo || undefined,
                    sortOrder: updatedLog.sortOrder,
                  }
                : record,
            )

            const updatedTasks = [...group.tasks]
            updatedTasks[taskIndex] = {
              ...task,
              records: updatedRecords,
            }

            return {
              ...group,
              tasks: updatedTasks,
            }
          })

          return didUpdate ? next : prev
        })

        if (!didUpdate) {
          try {
            const refreshed = await fetchGroupTasks(groupId)
            if (refreshed) onTaskDataChange([refreshed])
          } catch (refreshErr) {
            console.error('Refresh after toggle failed:', refreshErr)
          }
        }
      } catch (err) {
        console.error('Error toggling card status:', err)
        alert('Failed to update task status')
      }
    },
    [groupId, onTaskDataChange],
  )

  const deleteCard = useCallback(
    async (card: KanbanCard) => {
      if (!groupId) return

      const currentDate = dayjs().format('YYYY-MM-DD')

      // Only show confirmation if deleting from a past date
      if (card.date !== currentDate) {
        const ok = await confirmAsync({
          title: 'Confirm delete',
          message: `Remove "${card.taskName}" from ${dayjs(card.date).format('DD-MMM-YY')}? This will delete the record for that day.`,
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          maxWidth: '480px',
        })
        if (!ok) return
      }

      try {
        await deleteTaskLogById(card.id)

        let removed = false
        onTaskDataChange((prev) => {
          const next = prev.map((group) => {
            let groupChanged = false
            const updatedTasks: typeof group.tasks = []

            for (const task of group.tasks) {
              const recordIndex = task.records.findIndex(
                (record) => record.id === card.id,
              )

              if (recordIndex === -1) {
                updatedTasks.push(task)
                continue
              }

              groupChanged = true
              removed = true

              const nextRecords = [...task.records]
              nextRecords.splice(recordIndex, 1)

              if (nextRecords.length > 0) {
                updatedTasks.push({
                  ...task,
                  records: nextRecords,
                })
              }
            }

            return groupChanged
              ? {
                  ...group,
                  tasks: updatedTasks,
                }
              : group
          })

          return removed ? next : prev
        })

        if (!removed) {
          try {
            const refreshed = await fetchGroupTasks(groupId)
            if (refreshed) onTaskDataChange([refreshed])
          } catch (refreshErr) {
            console.error('Refresh after delete failed:', refreshErr)
          }
        }
      } catch (err) {
        console.error('Error deleting card:', err)
        alert('Failed to delete task')
      }
    },
    [groupId, onTaskDataChange],
  )

  const handleCardReorder = useCallback(
    async (
      targetDate: string,
      sourceDate: string,
      sourceLogId: number,
      targetLogId: number,
      position: 'before' | 'after',
      targetDone?: boolean,
    ) => {
      try {
        if (!groupId) return

        // Call moveTaskLog API
        await moveTaskLog({
          logId: sourceLogId,
          fromDate: sourceDate,
          toDate: targetDate,
          toDone: Boolean(targetDone),
          targetLogId: targetLogId === -1 ? undefined : targetLogId,
          position,
        })

        // Refresh the data to reflect the new order
        const updatedGroup = await fetchGroupTasks(groupId)
        if (updatedGroup) {
          onTaskDataChange([updatedGroup])
        }
      } catch (err) {
        console.error('Error reordering cards:', err)
      }
    },
    [groupId, onTaskDataChange],
  )

  const handleAddTask = useCallback(
    async (date: string, done: boolean, taskText: string) => {
      if (!groupId) return
      try {
        await createTaskAndAddToGroup(
          groupId,
          taskText,
          date,
          done,
          onTaskDataChange,
        )
      } catch (err) {
        alert((err as Error).message)
      }
    },
    [groupId, onTaskDataChange],
  )

  const allTasks = useMemo(() => {
    return taskData.flatMap((group) =>
      group.tasks.map((task) => ({
        id: task.id,
        task: task.task,
        groupName: group.name,
        defaultExtraInfo: task.defaultExtraInfo,
        records: task.records,
      })),
    )
  }, [taskData])

  const handleTaskSelect = useCallback(
    async (
      selectedTask: FlatTask | null,
      inputValue: string,
      date: string,
      done: boolean,
      reset: () => void,
    ) => {
      if (!selectedTask && inputValue) {
        await handleAddTask(date, done, inputValue)
        reset()
        return
      }

      reset()
      if (!selectedTask) return

      // Check if input has custom extra info for this task
      const { extraInfo: inputExtraInfo } = parseTaskWithExtraInfo(inputValue)
      const extraInfoToUse =
        inputExtraInfo || selectedTask.defaultExtraInfo || undefined

      // Add the task using existing addTaskToCell logic
      try {
        const log = await setTaskLog(
          selectedTask.id,
          date,
          done,
          extraInfoToUse,
        )

        // Update local state
        onTaskDataChange((prev) => {
          const copy = [...prev]
          if (!copy[0]) return copy
          const group = { ...copy[0] }
          const existingIdx = group.tasks.findIndex(
            (t) => t.id === selectedTask.id,
          )
          if (existingIdx >= 0) {
            const t = { ...group.tasks[existingIdx] }
            const recs = [...t.records]
            const idx = recs.findIndex((r) => r.id === log.id)
            if (idx >= 0) {
              recs[idx] = {
                ...recs[idx],
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              }
            } else {
              recs.push({
                id: log.id,
                date: log.date,
                done: log.done,
                extraInfo: log.extraInfo || undefined,
                sortOrder: log.sortOrder,
              })
            }
            t.records = recs
            group.tasks[existingIdx] = t
          } else {
            // Shouldn't happen but handle gracefully
            group.tasks = [
              ...group.tasks,
              {
                id: selectedTask.id,
                task: selectedTask.task,
                defaultExtraInfo: selectedTask.defaultExtraInfo,
                records: [
                  {
                    id: log.id,
                    date: log.date,
                    done: log.done,
                    extraInfo: log.extraInfo || undefined,
                    sortOrder: log.sortOrder,
                  },
                ],
              },
            ]
          }
          copy[0] = group
          return copy
        })
      } catch (err) {
        console.error('Error adding task to cell:', err)
      }
    },
    [handleAddTask, onTaskDataChange],
  )

  if (loading) {
    return <div className="kanban-loading">Loading tasks...</div>
  }

  if (error) {
    return <div className="kanban-error">Error: {error}</div>
  }

  return (
    <div className="kanban-container">
      <div className="kanban-board">
        <KanbanColumn
          title="TODO"
          dateGroups={kanbanData.todoGroups}
          isDoneColumn={false}
          onCardDelete={deleteCard}
          onCardStatusToggle={toggleCardStatus}
          onCardReorder={handleCardReorder}
          onTaskSelect={handleTaskSelect}
          availableTasks={allTasks}
          filterQuery={filterQuery}
        />
        <KanbanColumn
          title="DONE"
          dateGroups={kanbanData.doneGroups}
          isDoneColumn={true}
          onCardDelete={deleteCard}
          onCardStatusToggle={toggleCardStatus}
          onCardReorder={handleCardReorder}
          onTaskSelect={handleTaskSelect}
          availableTasks={allTasks}
          filterQuery={filterQuery}
        />
      </div>
    </div>
  )
}
