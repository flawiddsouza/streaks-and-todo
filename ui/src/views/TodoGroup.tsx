import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  fetchGroupTasks,
  type TaskGroup,
  updateGroup,
  updateTask,
} from '../api'
import FloatingTasksSidebar from '../components/shared/FloatingTasksSidebar'
import GroupSettingsModal, {
  type GroupSettings,
} from '../components/shared/GroupSettingsModal'
import PinnedTasks from '../components/shared/PinnedTasks'
import ManageTasksModal from '../components/todo-groups/ManageTasksModal'
import TodoCalendarView from '../components/todo-groups/TodoCalendarView'
import TodoGroupTable from '../components/todo-groups/TodoGroupTable'
import TodoKanbanView from '../components/todo-groups/TodoKanbanView'
import { FLOATING_TASK_DATE } from '../config'
import { type AppEvent, onEvent } from '../events'

export default function TodoGroup() {
  const { groupId } = useParams<{ groupId: string }>()
  const [rawTaskData, setRawTaskData] = useState<TaskGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showManageTasks, setShowManageTasks] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [filteredCount, setFilteredCount] = useState(0)
  const [viewMode, setViewMode] = useState<
    'table' | 'kanban' | 'calendar' | undefined
  >(undefined)
  const [settings, setSettings] = useState<GroupSettings>({})
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Filter out floating tasks for the views
  const taskData = rawTaskData.map((group) => ({
    ...group,
    tasks: group.tasks.map((task) => ({
      ...task,
      records: task.records.filter(
        (record) => record.date !== FLOATING_TASK_DATE,
      ),
    })),
  }))

  const handleTitleChange = async (
    event: React.FormEvent<HTMLHeadingElement>,
  ) => {
    const newName = event.currentTarget.textContent || ''
    await updateGroup(parseInt(groupId || '0'), { name: newName })
  }

  const handleViewModeChange = async (
    newViewMode: 'table' | 'kanban' | 'calendar',
  ) => {
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

  const handleSettingsChange = async (newSettings: GroupSettings) => {
    setSettings(newSettings)
    if (groupId) {
      try {
        await updateGroup(parseInt(groupId, 10), { settings: newSettings })
      } catch (err) {
        console.error('Failed to save settings:', err)
      }
    }
  }

  const handleSidebarCollapsedChange = async (collapsed: boolean) => {
    const newSettings = {
      ...settings,
      floatingTasksSidebarCollapsed: collapsed,
    }
    await handleSettingsChange(newSettings)
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
            setRawTaskData([taskGroup])
            if (titleRef.current) {
              titleRef.current.textContent = taskGroup.name || ''
            }
            // Set view mode from group data, defaulting to 'table'
            setViewMode(taskGroup.viewMode || 'table')
            // Set settings from group data
            setSettings(taskGroup.settings || {})
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
            if (updated) setRawTaskData([updated])
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
                    borderRight: '1px solid #e0e0e0',
                  }}
                >
                  Kanban
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeChange('calendar')}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    outline: 'none',
                    background: viewMode === 'calendar' ? '#667eea' : '#f0f0f0',
                    color: viewMode === 'calendar' ? '#fff' : '#666',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: viewMode === 'calendar' ? 'bold' : 'normal',
                  }}
                >
                  Calendar
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
                className="btn btn-secondary"
                onClick={() => setShowSettings(true)}
                style={{
                  marginRight: '12px',
                  padding: '8px 16px',
                  fontSize: '14px',
                }}
                title="Settings"
              >
                Settings
              </button>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          height: '100%',
          minHeight: 0,
        }}
      >
        {!loading && (
          <FloatingTasksSidebar
            taskData={rawTaskData}
            onTaskDataChange={setRawTaskData}
            groupId={groupId ? parseInt(groupId, 10) : undefined}
            collapsed={settings.floatingTasksSidebarCollapsed ?? true}
            onCollapsedChange={handleSidebarCollapsedChange}
          />
        )}
        <div style={{ minHeight: 0 }}>
          {viewMode === 'table' ? (
            <TodoGroupTable
              taskData={taskData}
              loading={loading}
              error={error}
              onTaskDataChange={setRawTaskData}
              groupId={groupId ? parseInt(groupId, 10) : undefined}
              filterQuery={filterQuery}
              onFilteredCountChange={setFilteredCount}
              settings={settings}
            />
          ) : viewMode === 'kanban' ? (
            <TodoKanbanView
              taskData={taskData}
              loading={loading}
              error={error}
              onTaskDataChange={setRawTaskData}
              groupId={groupId ? parseInt(groupId, 10) : undefined}
              filterQuery={filterQuery}
              settings={settings}
            />
          ) : viewMode === 'calendar' ? (
            <TodoCalendarView
              taskData={taskData}
              loading={loading}
              error={error}
              onTaskDataChange={setRawTaskData}
              groupId={groupId ? parseInt(groupId, 10) : undefined}
              filterQuery={filterQuery}
            />
          ) : null}
        </div>
      </div>

      {taskData[0] && groupId && (
        <PinnedTasks
          parentGroupId={parseInt(groupId, 10)}
          groupData={taskData[0]}
          onRefresh={(updated) => setRawTaskData([updated])}
        />
      )}

      <GroupSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        group={taskData[0] ?? null}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />

      <ManageTasksModal
        isOpen={showManageTasks}
        onClose={() => setShowManageTasks(false)}
        group={taskData[0] ?? null}
        onSaveTask={async (taskId, fields) => {
          try {
            await updateTask(taskId, fields)
            if (groupId) {
              const updated = await fetchGroupTasks(parseInt(groupId, 10))
              if (updated) setRawTaskData([updated])
            }
          } catch (err) {
            alert((err as Error).message)
          }
        }}
      />
    </div>
  )
}
