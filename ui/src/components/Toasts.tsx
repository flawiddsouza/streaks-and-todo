import { useEffect, useState } from 'react'
import type { Notice } from '../notify'
import { onNotice } from '../notify'

export default function Toasts() {
  const [items, setItems] = useState<Notice[]>([])

  useEffect(() => {
    const off = onNotice((n) => {
      setItems((prev) => [...prev, n])
      if (n.timeoutMs && n.timeoutMs > 0) {
        setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== n.id))
        }, n.timeoutMs)
      }
    })
    return off
  }, [])

  return (
    <div className="toasts">
      {items.map((n) => (
        <div key={n.id} className={`toast toast-${n.level}`}>
          <div className="toast-msg">{n.message}</div>
          <button
            type="button"
            className="toast-close"
            aria-label="Close"
            onClick={() =>
              setItems((prev) => prev.filter((x) => x.id !== n.id))
            }
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
