import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchorEl: HTMLElement | null
  message?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirmPopover({
  anchorEl,
  message = 'Delete?',
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 8, left: 8 })

  useLayoutEffect(() => {
    function updatePosition() {
      if (!anchorEl || !ref.current) return

      const rect = anchorEl.getBoundingClientRect()
      const pop = ref.current
      const margin = 8

      let left = rect.left
      let top = rect.bottom + 4

      const popW = pop.offsetWidth
      const popH = pop.offsetHeight

      // Keep within viewport horizontally.
      if (left + popW + margin > window.innerWidth) {
        left = window.innerWidth - popW - margin
      }
      if (left < margin) left = margin

      // If it would overflow bottom, place above the anchor.
      if (top + popH + margin > window.innerHeight) {
        top = rect.top - popH - 4
      }
      if (top < margin) top = margin

      setPos({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorEl])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      )
        onCancel()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onCancel, anchorEl])

  return createPortal(
    <div
      ref={ref}
      className="ai-delete-popover"
      style={{ top: pos.top, left: pos.left }}
    >
      <span>{message}</span>
      <button
        type="button"
        className="ai-delete-popover-yes"
        onClick={onConfirm}
      >
        Yes
      </button>
      <button type="button" className="ai-delete-popover-no" onClick={onCancel}>
        No
      </button>
    </div>,
    document.body,
  )
}
