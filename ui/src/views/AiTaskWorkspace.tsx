import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
  type AiChatMessage,
  type AiProject,
  type AiTask,
  createAiProject,
  createAiTask,
  deleteAiProject,
  deleteAiTask,
  fetchAiChatHistory,
  fetchAiProjects,
  fetchAiTasks,
  reorderAiProjects,
  reorderAiTasks,
  toggleAiTask,
  updateAiProject,
  updateAiTask,
} from '../api'
import ChatPanel from '../components/ai-tasks/ChatPanel'
import MobileHeader, {
  type MobileTab,
} from '../components/ai-tasks/MobileHeader'
import TaskPanel from '../components/ai-tasks/TaskPanel'
import { onEvent } from '../events'
import useIsMobile from '../hooks/useIsMobile'

const pageStyle: React.CSSProperties = {
  padding: 0,
  height: '100vh',
  display: 'flex',
  overflow: 'hidden',
}

export default function AiTaskWorkspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const wsId = parseInt(workspaceId ?? '0')
  const [projects, setProjects] = useState<AiProject[]>([])
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const toggleShowDone = useCallback(() => setShowDone((s) => !s), [])
  const isMobile = useIsMobile()
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('tasks')
  const [chatHasUnread, setChatHasUnread] = useState(false)
  const doneCount = tasks.filter((t) => t.done).length

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveMobileTab(tab)
    if (tab === 'chat') setChatHasUnread(false)
  }, [])
  const expectedOwnBroadcasts = useRef(0)

  const loadData = useCallback(async () => {
    try {
      const [projs, tsks, msgs] = await Promise.all([
        fetchAiProjects(wsId),
        fetchAiTasks(wsId),
        fetchAiChatHistory(wsId),
      ])
      setProjects(projs)
      setTasks(tsks)
      setMessages(msgs)
    } finally {
      setLoading(false)
    }
  }, [wsId])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    document.body.style.backgroundColor = '#13131f'
    return () => {
      document.body.style.backgroundColor = ''
    }
  }, [])

  // Re-fetch tasks when AI actions trigger changes
  useEffect(() => {
    return onEvent((evt) => {
      if (evt.type === 'ai-tasks.changed' && evt.workspaceId === wsId) {
        if (expectedOwnBroadcasts.current > 0) {
          expectedOwnBroadcasts.current -= 1
          return
        }
        fetchAiProjects(wsId).then(setProjects)
        fetchAiTasks(wsId).then(setTasks)
      }
    })
  }, [wsId])

  const prevMessageCount = useRef<number | null>(null)
  useEffect(() => {
    if (loading) return
    if (prevMessageCount.current === null) {
      prevMessageCount.current = messages.length
      return
    }
    const grew = messages.length > prevMessageCount.current
    prevMessageCount.current = messages.length
    if (!grew) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    if (isMobile && activeMobileTab !== 'chat') {
      setChatHasUnread(true)
    }
  }, [messages, isMobile, activeMobileTab, loading])

  useEffect(() => {
    if (!isMobile) setChatHasUnread(false)
  }, [isMobile])

  async function handleAddProject(name: string) {
    const tempId = -Date.now()
    const maxSort = projects.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0)
    const tempProject: AiProject = {
      id: tempId,
      name,
      sortOrder: maxSort + 1,
      group_id: wsId,
    }
    setProjects((prev) => [...prev, tempProject])
    expectedOwnBroadcasts.current += 1
    let project: AiProject
    try {
      project = await createAiProject(wsId, name)
    } catch (err) {
      expectedOwnBroadcasts.current -= 1
      setProjects((prev) => prev.filter((p) => p.id !== tempId))
      throw err
    }
    setProjects((prev) => prev.map((p) => (p.id === tempId ? project : p)))
  }

  async function handleRenameProject(id: number, name: string) {
    await updateAiProject(id, name)
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  async function handleDeleteProject(id: number) {
    const deletedProject = projects.find((p) => p.id === id)
    if (!deletedProject) return
    const deletedIndex = projects.findIndex((p) => p.id === id)
    const deletedTasks = tasks.filter((t) => t.projectId === id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setTasks((prev) => prev.filter((t) => t.projectId !== id))
    expectedOwnBroadcasts.current += 1
    try {
      await deleteAiProject(id)
    } catch (err) {
      expectedOwnBroadcasts.current -= 1
      setProjects((prev) => {
        const next = [...prev]
        next.splice(Math.min(deletedIndex, next.length), 0, deletedProject)
        return next
      })
      setTasks((prev) => [...prev, ...deletedTasks])
      throw err
    }
  }

  const handleReorderProjects = useCallback(
    async (updates: { groupId: number; sortOrder: number }[]) => {
      const order = new Map(updates.map((u) => [u.groupId, u.sortOrder]))
      setProjects((prev) =>
        [...prev].sort(
          (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
        ),
      )
      await reorderAiProjects(wsId, updates)
    },
    [wsId],
  )

  async function handleAddTask(
    projectId: number,
    body: string,
    insertAt?: number,
  ) {
    const tempId = -Date.now()
    const tempTask: AiTask = {
      id: tempId,
      projectId,
      body,
      sortOrder: null,
      done: false,
      createdAt: new Date().toISOString(),
      doneAt: null,
    }

    let isAppending = true
    let orderedIds: number[] = []
    setTasks((prev) => {
      const projectTaskIndices: number[] = []
      prev.forEach((t, i) => {
        if (t.projectId === projectId) projectTaskIndices.push(i)
      })
      if (insertAt === undefined || insertAt >= projectTaskIndices.length) {
        return [...prev, tempTask]
      }
      isAppending = false
      const anchorIdx = projectTaskIndices[insertAt]
      orderedIds = projectTaskIndices.map((i) => prev[i].id)
      orderedIds.splice(insertAt, 0, tempId)
      return [...prev.slice(0, anchorIdx), tempTask, ...prev.slice(anchorIdx)]
    })

    const expectedCount = isAppending ? 1 : 2
    expectedOwnBroadcasts.current += expectedCount

    let task: AiTask
    try {
      task = await createAiTask(projectId, body)
    } catch (err) {
      expectedOwnBroadcasts.current -= expectedCount
      throw err
    }
    setTasks((prev) => prev.map((t) => (t.id === tempId ? task : t)))

    if (!isAppending) {
      orderedIds = orderedIds.map((id) => (id === tempId ? task.id : id))
      try {
        await reorderAiTasks(
          projectId,
          orderedIds.map((id, i) => ({ taskId: id, sortOrder: i + 1 })),
        )
      } catch (err) {
        expectedOwnBroadcasts.current -= 1
        throw err
      }
    }
  }

  async function handleToggleTask(id: number) {
    const existing = tasks.find((t) => t.id === id)
    if (!existing) return
    const optimisticDone = !existing.done
    const optimisticDoneAt = optimisticDone ? new Date().toISOString() : null
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, done: optimisticDone, doneAt: optimisticDoneAt }
          : t,
      ),
    )
    expectedOwnBroadcasts.current += 1
    try {
      const result = await toggleAiTask(id)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, done: result.done, doneAt: result.doneAt } : t,
        ),
      )
    } catch (err) {
      expectedOwnBroadcasts.current -= 1
      setTasks((prev) => prev.map((t) => (t.id === id ? existing : t)))
      throw err
    }
  }

  async function handleDeleteTask(id: number) {
    await deleteAiTask(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleBodyChange(id: number, body: string) {
    await updateAiTask(id, { body })
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, body } : t)))
  }

  const handleReorderTasks = useCallback(
    async (
      projectId: number,
      updates: { taskId: number; sortOrder: number }[],
    ) => {
      const order = new Map(updates.map((u) => [u.taskId, u.sortOrder]))
      setTasks((prev) => {
        const projectTasks = prev
          .filter((t) => t.projectId === projectId)
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        let i = 0
        return prev.map((t) =>
          t.projectId === projectId ? projectTasks[i++] : t,
        )
      })
      await reorderAiTasks(projectId, updates)
    },
    [],
  )

  if (loading)
    return (
      <div className="page">
        <div style={{ padding: '2rem' }}>Loading...</div>
      </div>
    )

  if (isMobile) {
    return (
      <div className="page ai-mobile" style={pageStyle}>
        <MobileHeader
          backHref="/ai-tasks"
          activeTab={activeMobileTab}
          onTabChange={handleTabChange}
          chatHasUnread={chatHasUnread}
          showDone={showDone}
          onToggleShowDone={toggleShowDone}
          doneCount={doneCount}
        />
        {activeMobileTab === 'tasks' ? (
          <TaskPanel
            mobile
            projects={projects}
            tasks={tasks}
            backHref="/ai-tasks"
            showDone={showDone}
            onToggleShowDone={toggleShowDone}
            onAddProject={handleAddProject}
            onRenameProject={handleRenameProject}
            onDeleteProject={handleDeleteProject}
            onReorderProjects={handleReorderProjects}
            onAddTask={handleAddTask}
            onToggleTask={handleToggleTask}
            onDeleteTask={handleDeleteTask}
            onBodyChange={handleBodyChange}
            onReorderTasks={handleReorderTasks}
          />
        ) : (
          <ChatPanel
            workspaceId={wsId}
            messages={messages}
            onMessagesChange={setMessages}
          />
        )}
      </div>
    )
  }

  return (
    <div className="page" style={pageStyle}>
      <TaskPanel
        projects={projects}
        tasks={tasks}
        backHref="/ai-tasks"
        showDone={showDone}
        onToggleShowDone={toggleShowDone}
        onAddProject={handleAddProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onReorderProjects={handleReorderProjects}
        onAddTask={handleAddTask}
        onToggleTask={handleToggleTask}
        onDeleteTask={handleDeleteTask}
        onBodyChange={handleBodyChange}
        onReorderTasks={handleReorderTasks}
      />
      <ChatPanel
        workspaceId={wsId}
        messages={messages}
        onMessagesChange={setMessages}
      />
    </div>
  )
}
