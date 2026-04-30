import { useRef, useState } from 'react'
import type { AiTask } from '../../api'
import DeleteConfirmPopover from './DeleteConfirmPopover'

interface Props {
  task: AiTask
  showDone: boolean
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onBodyChange: (id: number, body: string) => void
  mobile?: boolean
  onOpenMenu?: (anchor: { x: number; y: number }) => void
}

export default function TaskRow({
  task,
  showDone,
  onToggle,
  onDelete,
  onBodyChange,
  mobile = false,
  onOpenMenu,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const addedDate = new Date(task.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const doneDate = task.doneAt
    ? new Date(task.doneAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null
  const ts = doneDate
    ? `added ${addedDate} · done ${doneDate}`
    : `added ${addedDate}`

  function startEdit(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    const el = bodyRef.current
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
      const newBody = el.textContent?.trim() ?? ''
      if (newBody && newBody !== task.body) onBodyChange(task.id, newBody)
      else el.textContent = task.body // restore if empty or unchanged
      el.removeEventListener('blur', done)
      el.removeEventListener('keydown', onKey)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') done()
    }
    el.addEventListener('blur', done)
    el.addEventListener('keydown', onKey)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: conditional interactivity only when task is done
    <div
      className={`ai-task-row${task.done ? ' done' : ''}`}
      role={task.done && showDone ? 'button' : undefined}
      tabIndex={task.done && showDone ? 0 : undefined}
      onClick={task.done && showDone ? () => onToggle(task.id) : undefined}
      onKeyDown={
        task.done && showDone
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onToggle(task.id)
            }
          : undefined
      }
    >
      <span className="ai-drag-handle">⠿</span>
      {/* biome-ignore lint/a11y/useSemanticElements: custom styled checkbox with icon, not replaceable with input */}
      <div
        className={`ai-checkbox${task.done ? ' checked' : ''}`}
        role="checkbox"
        aria-checked={task.done}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(task.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            onToggle(task.id)
          }
        }}
      >
        {task.done ? '✓' : ''}
      </div>
      <div className="ai-task-content">
        {/* biome-ignore lint/a11y/useSemanticElements: needs contentEditable for inline edit, not replaceable with button */}
        <div
          ref={bodyRef}
          className="ai-task-body"
          role="button"
          tabIndex={0}
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation()
              ;(e.currentTarget as HTMLElement).click()
            } else if (e.key === ' ') {
              // prevent bubbling to row's Space toggle while focused/editing
              e.stopPropagation()
            }
          }}
        >
          {task.body}
        </div>
        <div className="ai-task-ts">{ts}</div>
      </div>
      <div
        className="ai-task-actions"
        style={confirmingDelete ? { opacity: 1 } : undefined}
      >
        {mobile && onOpenMenu && (
          <button
            type="button"
            className="ai-row-overflow-btn"
            title="More"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onOpenMenu({ x: rect.right, y: rect.bottom })
            }}
          >
            ⋯
          </button>
        )}
        <button
          ref={deleteRef}
          type="button"
          className="ai-action-btn delete"
          title="Delete"
          style={
            confirmingDelete
              ? { color: '#ff6b6b', background: '#252540' }
              : undefined
          }
          onClick={(e) => {
            e.stopPropagation()
            setConfirmingDelete(true)
          }}
        >
          ✕
        </button>
        {confirmingDelete && (
          <DeleteConfirmPopover
            anchorEl={deleteRef.current}
            onConfirm={() => {
              setConfirmingDelete(false)
              onDelete(task.id)
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </div>
  )
}
