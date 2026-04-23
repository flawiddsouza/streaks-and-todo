import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop) return
    const margin = 8
    let left = x
    let top = y
    const popW = pop.offsetWidth
    const popH = pop.offsetHeight
    if (left + popW + margin > window.innerWidth) {
      left = window.innerWidth - popW - margin
    }
    if (left < margin) left = margin
    if (top + popH + margin > window.innerHeight) {
      top = window.innerHeight - popH - margin
    }
    if (top < margin) top = margin
    setPos({ top, left })
  }, [x, y])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onScroll() {
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="ai-context-menu"
      style={{ top: pos.top, left: pos.left }}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          className="ai-context-menu-item"
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

export function shouldSkipCustomMenu(e: React.MouseEvent): boolean {
  if (window.getSelection()?.toString()) return true
  const target = e.target as HTMLElement | null
  if (target?.isContentEditable) return true
  return false
}
