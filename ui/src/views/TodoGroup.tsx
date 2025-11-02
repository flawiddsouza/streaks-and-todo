import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  fetchGroupTasks,
  type TaskGroup,
  updateGroup,
  updateTask,
} from '../api'
import ManageTasksModal from '../components/ManageTasksModal'
import PinnedTasks from '../components/PinnedTasks'
import TodoGroupTable from '../components/TodoGroupTable'
import TodoKanbanView from '../components/TodoKanbanView'
import { type AppEvent, onEvent } from '../events'

export default function TodoGroup() {
  const { groupId } = useParams<{ groupId: string }>()
  const [taskData, setTaskData] = useState<TaskGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showManageTasks, setShowManageTasks] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [filteredCount, setFilteredCount] = useState(0)
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | undefined>(
    undefined,
  )
  const titleRef = useRef<HTMLHeadingElement>(null)

  const handleTitleChange = async (
    event: React.FormEvent<HTMLHeadingElement>,
  ) => {
    const newName = event.currentTarget.textContent || ''
    await updateGroup(parseInt(groupId || '0'), { name: newName })
  }

  const handleViewModeChange = async (newViewMode: 'table' | 'kanban') => {
    setViewMode(newViewMode)
    if (groupId) {
      try {
        await updateGroup(parseInt(groupId, 10), { viewMode: newViewMode })
      } catch (err) {
        console.error('Failed to save view mode:', err)
      }
    }
  }

  const handleTitleKeyDown = (
    event: React.KeyboardEvent<HTMLHeadingElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
    }
  }

  const handleTitlePaste = (
    event: React.ClipboardEvent<HTMLHeadingElement>,
  ) => {
    event.preventDefault()
    const paste = event.clipboardData.getData('text/plain')
    const cleanPaste = paste.replace(/\r?\n|\r/g, ' ').trim()
    document.execCommand('insertText', false, cleanPaste)
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        if (groupId) {
          const groupIdNumber = parseInt(groupId, 10)
          if (Number.isNaN(groupIdNumber)) {
            setError('Invalid group ID')
            return
          }

          const taskGroup = await fetchGroupTasks(groupIdNumber)
          if (taskGroup) {
            setTaskData([taskGroup])
            if (titleRef.current) {
              titleRef.current.textContent = taskGroup.name || ''
            }
            // Set view mode from group data, defaulting to 'table'
            setViewMode(taskGroup.viewMode || 'table')
          } else {
            setError('Group not found')
          }
        } else {
          setError('No group ID provided')
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to fetch task data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Live updates via SSE
    let unsub: (() => void) | null = null
    if (groupId) {
      const gid = parseInt(groupId, 10)
      unsub = onEvent(async (evt: AppEvent) => {
        // Only refresh when the event concerns this group
        if (
          (evt.type === 'task.log.updated' && evt.groupId === gid) ||
          (evt.type === 'task.log.deleted' && evt.groupId === gid) ||
          evt.type === 'tasks.reordered' ||
          (evt.type === 'group.note.updated' && evt.groupId === gid) ||
          evt.type === 'task.log.moved' ||
          (evt.type === 'pins.groups.changed' && evt.parentGroupId === gid) ||
          (evt.type === 'pins.group.deleted' && evt.parentGroupId === gid) ||
          evt.type === 'pins.groups.reordered' ||
          evt.type === 'pins.items.changed' ||
          evt.type === 'pins.items.reordered' ||
          (evt.type === 'task.updated' && taskData[0]?.id === gid)
        ) {
          try {
            const updated = await fetchGroupTasks(gid)
            if (updated) setTaskData([updated])
          } catch (err) {
            console.error('Live refresh failed:', err)
          }
        }
      })
    }

    return () => {
      if (unsub) unsub()
    }
  }, [groupId, taskData[0]?.id])

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="nav-left">
          {groupId && (
            <>
              <Link to="/todo" className="back-link">
                ← Back to Todo Groups
              </Link>
              <div
                className="view-toggle"
                style={{
                  display: 'inline-flex',
                  gap: '0',
                  marginLeft: '16px',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleViewModeChange('table')}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    outline: 'none',
                    background: viewMode === 'table' ? '#667eea' : '#f0f0f0',
                    color: viewMode === 'table' ? '#fff' : '#666',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: viewMode === 'table' ? 'bold' : 'normal',
                    borderRight: '1px solid #e0e0e0',
                  }}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeChange('kanban')}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    outline: 'none',
                    background: viewMode === 'kanban' ? '#667eea' : '#f0f0f0',
                    color: viewMode === 'kanban' ? '#fff' : '#666',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: viewMode === 'kanban' ? 'bold' : 'normal',
                  }}
                >
                  Kanban
                </button>
              </div>
            </>
          )}
        </div>
        <div className="nav-right">
          {groupId && (
            <>
              {filterQuery.trim() && (
                <div
                  className="filter-info"
                  style={{
                    marginRight: '12px',
                    color: '#666',
                    backgroundColor: '#f5f5f5',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    padding: '6px 12px',
                  }}
                >
                  <span>
                    <strong>{filteredCount}</strong>{' '}
                    {filteredCount === 1 ? 'day' : 'days'} found
                  </span>
                </div>
              )}
              <div className="filter-container" style={{ marginRight: '12px' }}>
                <input
                  type="search"
                  placeholder="Filter tasks..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="streak-name-input"
                  style={{
                    width: '200px',
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowManageTasks(true)}
              >
                Manage Tasks
              </button>
            </>
          )}
        </div>
      </nav>

      {/** biome-ignore lint/a11y/useHeadingContent: dynamic replacement */}
      <h1
        ref={titleRef}
        className="page-title"
        contentEditable="plaintext-only"
        spellCheck={false}
        onInput={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        onPaste={handleTitlePaste}
        suppressContentEditableWarning={true}
      ></h1>

      {viewMode === 'table' ? (
        <TodoGroupTable
          taskData={taskData}
          loading={loading}
          error={error}
          onTaskDataChange={setTaskData}
          groupId={groupId ? parseInt(groupId, 10) : undefined}
          filterQuery={filterQuery}
          onFilteredCountChange={setFilteredCount}
        />
      ) : viewMode === 'kanban' ? (
        <TodoKanbanView
          taskData={taskData}
          loading={loading}
          error={error}
          onTaskDataChange={setTaskData}
          groupId={groupId ? parseInt(groupId, 10) : undefined}
          filterQuery={filterQuery}
        />
      ) : null}

      {taskData[0] && groupId && (
        <PinnedTasks
          parentGroupId={parseInt(groupId, 10)}
          groupData={taskData[0]}
          onRefresh={(updated) => setTaskData([updated])}
        />
      )}

      <ManageTasksModal
        isOpen={showManageTasks}
        onClose={() => setShowManageTasks(false)}
        group={taskData[0] ?? null}
        onSaveTask={async (taskId, fields) => {
          try {
            await updateTask(taskId, fields)
            if (groupId) {
              const updated = await fetchGroupTasks(parseInt(groupId, 10))
              if (updated) setTaskData([updated])
            }
          } catch (err) {
            alert((err as Error).message)
          }
        }}
      />
    </div>
  )
}
