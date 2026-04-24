import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { AiProject, AiTask } from '../../api'
import AddTaskRow, { type AddTaskRowHandle } from './AddTaskRow'
import ContextMenu, {
  type ContextMenuItem,
  shouldSkipCustomMenu,
} from './ContextMenu'
import DeleteConfirmPopover from './DeleteConfirmPopover'
import InsertStrip from './InsertStrip'
import TaskRow from './TaskRow'

interface DraggableTaskProps {
  task: AiTask
  allTasks: AiTask[]
  projectId: number
  showDone: boolean
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onBodyChange: (id: number, body: string) => void
  onReorderTasks: (
    projectId: number,
    updates: { taskId: number; sortOrder: number }[],
  ) => void
  onInsertAbove?: () => void
  onInsertBelow?: () => void
  displaced?: boolean
}

function DraggableTask({
  task,
  allTasks,
  projectId,
  showDone,
  onToggle,
  onDelete,
  onBodyChange,
  onReorderTasks,
  onInsertAbove,
  onInsertBelow,
  displaced = false,
}: DraggableTaskProps) {
  const ref = useRef<HTMLDivElement>(null)
  const allTasksRef = useRef(allTasks)
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    allTasksRef.current = allTasks
  }, [allTasks])

  function sendTaskTo(position: 'top' | 'bottom') {
    const arr = [...allTasksRef.current]
    const srcIdx = arr.findIndex((t) => t.id === task.id)
    if (srcIdx === -1) return
    const [moved] = arr.splice(srcIdx, 1)
    if (position === 'top') arr.unshift(moved)
    else arr.push(moved)
    onReorderTasks(
      projectId,
      arr.map((t, i) => ({ taskId: t.id, sortOrder: i + 1 })),
    )
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (shouldSkipCustomMenu(e)) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const isAtTop = allTasks[0]?.id === task.id
  const isAtBottom = allTasks[allTasks.length - 1]?.id === task.id
  const items: ContextMenuItem[] = []
  if (onInsertAbove)
    items.push({ label: 'Insert above', onClick: onInsertAbove })
  if (onInsertBelow)
    items.push({ label: 'Insert below', onClick: onInsertBelow })
  if (!displaced && !isAtTop)
    items.push({ label: 'Send to top', onClick: () => sendTaskTo('top') })
  if (!displaced && !isAtBottom)
    items.push({ label: 'Send to bottom', onClick: () => sendTaskTo('bottom') })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return combine(
      draggable({
        element: el,
        canDrag: () =>
          !displaced && !el.querySelector('[contenteditable="plaintext-only"]'),
        getInitialData: () => ({ type: 'ai-task', taskId: task.id, projectId }),
        onDragStart: () => {
          el.style.opacity = '0.4'
        },
        onDrop: () => {
          el.style.opacity = ''
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          !displaced &&
          source.data.type === 'ai-task' &&
          source.data.taskId !== task.id &&
          source.data.projectId === projectId,
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false)
          const sourceId = source.data.taskId as number
          const arr = [...allTasksRef.current]
          const srcIdx = arr.findIndex((t) => t.id === sourceId)
          if (srcIdx === -1) return
          const [moved] = arr.splice(srcIdx, 1)
          // Re-find after splice so the insert is always before the target
          const newTgtIdx = arr.findIndex((t) => t.id === task.id)
          if (newTgtIdx === -1) return
          arr.splice(newTgtIdx, 0, moved)
          onReorderTasks(
            projectId,
            arr.map((t, i) => ({ taskId: t.id, sortOrder: i + 1 })),
          )
        },
      }),
    )
  }, [task.id, projectId, onReorderTasks, displaced])

  const wrapperClasses = [
    over ? 'ai-drop-over-task' : null,
    menu ? 'ai-context-active' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper exists to host drag + right-click affordances for the task row below
    <div
      ref={ref}
      className={wrapperClasses || undefined}
      onContextMenu={handleContextMenu}
    >
      <TaskRow
        task={task}
        showDone={showDone}
        onToggle={onToggle}
        onDelete={onDelete}
        onBodyChange={onBodyChange}
      />
      {menu && items.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

interface EndDropZoneProps {
  allTasks: AiTask[]
  projectId: number
  onReorderTasks: (
    projectId: number,
    updates: { taskId: number; sortOrder: number }[],
  ) => void
}

function EndDropZone({
  allTasks,
  projectId,
  onReorderTasks,
}: EndDropZoneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const allTasksRef = useRef(allTasks)
  const [over, setOver] = useState(false)
  useEffect(() => {
    allTasksRef.current = allTasks
  }, [allTasks])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        source.data.type === 'ai-task' && source.data.projectId === projectId,
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false)
        const sourceId = source.data.taskId as number
        const arr = [...allTasksRef.current]
        const srcIdx = arr.findIndex((t) => t.id === sourceId)
        if (srcIdx === -1) return
        const [moved] = arr.splice(srcIdx, 1)
        arr.push(moved)
        onReorderTasks(
          projectId,
          arr.map((t, i) => ({ taskId: t.id, sortOrder: i + 1 })),
        )
      },
    })
  }, [projectId, onReorderTasks])
  return (
    <div
      ref={ref}
      className={`ai-end-drop-zone${over ? ' ai-end-drop-zone-over' : ''}`}
    />
  )
}

interface Props {
  project: AiProject
  allProjects: AiProject[]
  tasks: AiTask[]
  showDone: boolean
  sessionDoneIds: Set<number>
  onRename: (id: number, name: string) => void
  onDelete: (id: number) => void
  onAddTask: (projectId: number, body: string, insertAt?: number) => void
  onToggleTask: (id: number) => void
  onDeleteTask: (id: number) => void
  onBodyChange: (id: number, body: string) => void
  onReorderTasks: (
    projectId: number,
    updates: { taskId: number; sortOrder: number }[],
  ) => void
  onReorderProjects: (updates: { groupId: number; sortOrder: number }[]) => void
}

export default function ProjectSection({
  project,
  allProjects,
  tasks,
  showDone,
  sessionDoneIds,
  onRename,
  onDelete,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onBodyChange,
  onReorderTasks,
  onReorderProjects,
}: Props) {
  const nameRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLSpanElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const allProjectsRef = useRef(allProjects)
  const [projectOver, setProjectOver] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [addingAt, setAddingAt] = useState<number | null>(null)
  const editorRef = useRef<AddTaskRowHandle>(null)

  const bottomDones = useMemo(() => {
    if (!showDone) return [] as AiTask[]
    const doneTasks = tasks.filter((t) => t.done)
    doneTasks.sort((a, b) => {
      const cmp = (b.doneAt ?? '').localeCompare(a.doneAt ?? '')
      return cmp !== 0 ? cmp : b.id - a.id
    })
    return doneTasks
  }, [tasks, showDone])

  function handleSwitchTo(newIdx: number) {
    if (newIdx === addingAt) return
    const text = editorRef.current?.flush() ?? null
    let adjustedIdx = newIdx
    if (text && addingAt !== null) {
      onAddTask(project.id, text, addingAt)
      if (addingAt <= newIdx) adjustedIdx += 1
    }
    setAddingAt(adjustedIdx)
  }
  useEffect(() => {
    allProjectsRef.current = allProjects
  }, [allProjects])

  function sendProjectTo(position: 'top' | 'bottom') {
    const arr = [...allProjectsRef.current]
    const srcIdx = arr.findIndex((p) => p.id === project.id)
    if (srcIdx === -1) return
    const [moved] = arr.splice(srcIdx, 1)
    if (position === 'top') arr.unshift(moved)
    else arr.push(moved)
    onReorderProjects(arr.map((p, i) => ({ groupId: p.id, sortOrder: i + 1 })))
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (shouldSkipCustomMenu(e)) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const isAtTop = allProjects[0]?.id === project.id
  const isAtBottom = allProjects[allProjects.length - 1]?.id === project.id
  const projectItems: ContextMenuItem[] = []
  if (!isAtTop)
    projectItems.push({
      label: 'Send to top',
      onClick: () => sendProjectTo('top'),
    })
  if (!isAtBottom)
    projectItems.push({
      label: 'Send to bottom',
      onClick: () => sendProjectTo('bottom'),
    })

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    return combine(
      draggable({
        element: el,
        dragHandle: handleRef.current ?? undefined,
        canDrag: () => !el.querySelector('[contenteditable="plaintext-only"]'),
        getInitialData: () => ({ type: 'ai-project', projectId: project.id }),
        onDragStart: () => {
          el.style.opacity = '0.5'
        },
        onDrop: () => {
          el.style.opacity = ''
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === 'ai-project' &&
          source.data.projectId !== project.id,
        onDragEnter: () => setProjectOver(true),
        onDragLeave: () => setProjectOver(false),
        onDrop: ({ source }) => {
          setProjectOver(false)
          const sourceId = source.data.projectId as number
          const ordered = [...allProjectsRef.current]
          const srcIdx = ordered.findIndex((p) => p.id === sourceId)
          const tgtIdx = ordered.findIndex((p) => p.id === project.id)
          if (srcIdx === -1 || tgtIdx === -1) return
          const [moved] = ordered.splice(srcIdx, 1)
          ordered.splice(tgtIdx, 0, moved)
          onReorderProjects(
            ordered.map((p, i) => ({ groupId: p.id, sortOrder: i + 1 })),
          )
        },
      }),
    )
  }, [project.id, onReorderProjects])

  function startRename(e: React.MouseEvent) {
    const el = nameRef.current
    if (!el || el.contentEditable === 'plaintext-only') return
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null
    el.contentEditable = 'plaintext-only'
    if (range) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    function done() {
      if (!el) return
      el.contentEditable = 'false'
      const newName = el.textContent?.trim() ?? ''
      if (newName && newName !== project.name) onRename(project.id, newName)
      else el.textContent = project.name
      el.removeEventListener('blur', done)
      el.removeEventListener('keydown', onKey)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Enter' || ev.key === 'Escape') done()
    }
    el.addEventListener('blur', done)
    el.addEventListener('keydown', onKey)
  }

  function commitAddTask(body: string) {
    const at = addingAt
    setAddingAt(null)
    if (body && at !== null) onAddTask(project.id, body, at)
  }

  const projectClasses = [
    'ai-project',
    projectOver ? 'ai-drop-over-project' : null,
    menu ? 'ai-context-active' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={projectClasses} ref={outerRef} data-project-id={project.id}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: header hosts drag + right-click affordances for the project; inner controls remain keyboard-accessible */}
      <div className="ai-project-header" onContextMenu={handleContextMenu}>
        <span className="ai-project-drag-handle" ref={handleRef}>
          ⠿
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: needs contentEditable for inline rename, not replaceable with button */}
        <div
          ref={nameRef}
          className="ai-project-name"
          role="button"
          tabIndex={0}
          onClick={startRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLElement).click()
          }}
        >
          {project.name}
        </div>
        <button
          ref={deleteRef}
          type="button"
          className="ai-project-delete"
          title="Delete project"
          style={confirmingDelete ? { color: '#ff6b6b' } : undefined}
          onClick={() => setConfirmingDelete(true)}
        >
          ✕
        </button>
        {confirmingDelete && (
          <DeleteConfirmPopover
            anchorEl={deleteRef.current}
            message="Delete project?"
            onConfirm={() => {
              setConfirmingDelete(false)
              onDelete(project.id)
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
      {tasks.map((task, fullIdx) => {
        const isDisplaced =
          task.done && (showDone || !sessionDoneIds.has(task.id))
        if (isDisplaced) return null
        return (
          <Fragment key={task.id}>
            <InsertStrip onClick={() => handleSwitchTo(fullIdx)} />
            {addingAt === fullIdx && (
              <AddTaskRow
                ref={editorRef}
                onCommit={commitAddTask}
                onCancel={() => setAddingAt(null)}
              />
            )}
            <DraggableTask
              task={task}
              allTasks={tasks}
              projectId={project.id}
              showDone={showDone}
              onToggle={onToggleTask}
              onDelete={onDeleteTask}
              onBodyChange={onBodyChange}
              onReorderTasks={onReorderTasks}
              onInsertAbove={() => handleSwitchTo(fullIdx)}
              onInsertBelow={() => handleSwitchTo(fullIdx + 1)}
            />
          </Fragment>
        )
      })}
      {addingAt === tasks.length && (
        <AddTaskRow
          ref={editorRef}
          onCommit={commitAddTask}
          onCancel={() => setAddingAt(null)}
        />
      )}
      {bottomDones.map((task) => (
        <DraggableTask
          key={task.id}
          task={task}
          allTasks={tasks}
          projectId={project.id}
          showDone={showDone}
          onToggle={onToggleTask}
          onDelete={onDeleteTask}
          onBodyChange={onBodyChange}
          onReorderTasks={onReorderTasks}
          displaced
        />
      ))}
      <EndDropZone
        allTasks={tasks}
        projectId={project.id}
        onReorderTasks={onReorderTasks}
      />
      <button
        type="button"
        className="ai-add-task-btn"
        data-project-add={project.id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleSwitchTo(tasks.length)}
      >
        <span className="ai-add-task-icon">＋</span>
        Add task
      </button>
      {menu && projectItems.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={projectItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
