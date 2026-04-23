import { useCallback, useEffect, useState } from 'react'
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
import TaskPanel from '../components/ai-tasks/TaskPanel'
import { onEvent } from '../events'

export default function AiTaskWorkspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const wsId = parseInt(workspaceId ?? '0')
  const [projects, setProjects] = useState<AiProject[]>([])
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [loading, setLoading] = useState(true)

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
        fetchAiProjects(wsId).then(setProjects)
        fetchAiTasks(wsId).then(setTasks)
      }
    })
  }, [wsId])

  async function handleAddProject(name: string) {
    const project = await createAiProject(wsId, name)
    setProjects((prev) => [...prev, project])
  }

  async function handleRenameProject(id: number, name: string) {
    await updateAiProject(id, name)
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  async function handleDeleteProject(id: number) {
    await deleteAiProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setTasks((prev) => prev.filter((t) => t.projectId !== id))
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

  async function handleAddTask(projectId: number, body: string) {
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
    setTasks((prev) => [...prev, tempTask])
    const task = await createAiTask(projectId, body)
    setTasks((prev) => prev.map((t) => (t.id === tempId ? task : t)))
  }

  async function handleToggleTask(id: number) {
    const result = await toggleAiTask(id)
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, done: result.done, doneAt: result.doneAt } : t,
      ),
    )
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

  return (
    <div
      className="page"
      style={{
        padding: 0,
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      <TaskPanel
        projects={projects}
        tasks={tasks}
        backHref="/ai-tasks"
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
