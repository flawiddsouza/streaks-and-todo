import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface AddTaskRowHandle {
  flush: () => string | null
}

interface Props {
  onCommit: (body: string) => void
  onCancel: () => void
}

const AddTaskRow = forwardRef<AddTaskRowHandle, Props>(function AddTaskRow(
  { onCommit, onCancel },
  ref,
) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const addedDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  useEffect(() => {
    bodyRef.current?.focus()
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      flush() {
        if (committedRef.current) return null
        committedRef.current = true
        const text = bodyRef.current?.textContent?.trim() ?? ''
        return text || null
      },
    }),
    [],
  )

  function finalize() {
    if (committedRef.current) return
    committedRef.current = true
    const text = bodyRef.current?.textContent?.trim() ?? ''
    if (text) onCommit(text)
    else onCancel()
  }

  return (
    <div className="ai-task-row adding">
      <span className="ai-drag-handle">⠿</span>
      <div className="ai-checkbox" />
      <div className="ai-task-content">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: contentEditable inline editor for new task body */}
        <div
          ref={bodyRef}
          className="ai-task-body ai-task-body-editing"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          onBlur={finalize}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              committedRef.current = true
              onCancel()
            }
          }}
        />
        <div className="ai-task-ts">added {addedDate}</div>
      </div>
    </div>
  )
})

export default AddTaskRow
