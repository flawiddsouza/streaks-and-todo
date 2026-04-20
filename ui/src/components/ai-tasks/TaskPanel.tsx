import { useState } from 'react'
import { Link } from 'react-router'
import type { AiProject, AiTask } from '../../api'
import ProjectSection from './ProjectSection'

interface Props {
  projects: AiProject[]
  tasks: AiTask[]
  backHref: string
  onAddProject: (name: string) => void
  onRenameProject: (id: number, name: string) => void
  onDeleteProject: (id: number) => void
  onReorderProjects: (updates: { groupId: number; sortOrder: number }[]) => void
  onAddTask: (projectId: number, body: string) => void
  onToggleTask: (id: number) => void
  onDeleteTask: (id: number) => void
  onBodyChange: (id: number, body: string) => void
  onReorderTasks: (
    projectId: number,
    updates: { taskId: number; sortOrder: number }[],
  ) => void
}

export default function TaskPanel({
  projects,
  tasks,
  backHref,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onReorderProjects,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onBodyChange,
  onReorderTasks,
}: Props) {
  const [showDone, setShowDone] = useState(false)
  const doneCount = tasks.filter((t) => t.done).length

  function handleAddProject() {
    const addBtn = document.querySelector('.ai-add-project-btn') as HTMLElement
    if (!addBtn) return
    const container = document.createElement('div')
    container.className = 'ai-project'
    container.innerHTML = `
      <div class="ai-project-header">
        <span class="ai-project-drag-handle">⠿</span>
        <div class="ai-project-name" contenteditable="plaintext-only" style="min-width:80px;outline:none"></div>
      </div>`
    addBtn.parentNode?.insertBefore(container, addBtn)
    const nameEl = container.querySelector('.ai-project-name') as HTMLElement
    nameEl?.focus()
    function commit() {
      const name = nameEl?.textContent?.trim() ?? ''
      container.remove()
      if (name) onAddProject(name)
    }
    nameEl?.addEventListener('blur', commit)
    nameEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        nameEl.blur()
      }
      if (e.key === 'Escape') {
        nameEl.textContent = ''
        container.remove()
      }
    })
  }

  return (
    <div className="ai-task-panel">
      <div className="ai-task-panel-header">
        <Link to={backHref} className="ai-back-link">
          ←
        </Link>
        <span>Tasks</span>
        {doneCount > 0 && (
          <button
            type="button"
            className="ai-show-done-btn"
            onClick={() => setShowDone((s) => !s)}
          >
            {showDone ? 'Hide done' : `Show done (${doneCount})`}
          </button>
        )}
      </div>
      <div className="ai-task-panel-body">
        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            allProjects={projects}
            tasks={tasks.filter((t) => t.projectId === project.id)}
            showDone={showDone}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
            onAddTask={onAddTask}
            onToggleTask={onToggleTask}
            onDeleteTask={onDeleteTask}
            onBodyChange={onBodyChange}
            onReorderTasks={onReorderTasks}
            onReorderProjects={onReorderProjects}
          />
        ))}
        <button
          type="button"
          className="ai-add-project-btn"
          onClick={handleAddProject}
        >
          ＋ Add project
        </button>
      </div>
    </div>
  )
}
