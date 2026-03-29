import { useState } from 'react'
import { type ApiTaskFamily, addTaskToFamily } from '../../api'

interface TaskFamilySuggestionBannerProps {
  taskId: number
  taskName: string
  matches: ApiTaskFamily[]
  onDismiss: () => void
}

export default function TaskFamilySuggestionBanner({
  taskId,
  taskName,
  matches,
  onDismiss,
}: TaskFamilySuggestionBannerProps) {
  const [linking, setLinking] = useState(false)

  const handleLink = async (family: ApiTaskFamily) => {
    setLinking(true)
    try {
      await addTaskToFamily(family.id, taskId)
      onDismiss()
    } catch (err) {
      alert((err as Error).message)
      setLinking(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: '#fff',
        border: '1px solid #d0d0d0',
        borderRadius: 6,
        padding: '12px 16px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        zIndex: 1000,
        maxWidth: 360,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 8 }}>
        "{taskName}" matches {matches.length === 1 ? 'a family' : 'families'}:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {matches.map((f) => (
          <div
            key={f.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ flex: 1 }}>{f.name}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleLink(f)}
              disabled={linking}
            >
              Link
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={linking}
        style={{
          marginTop: 10,
          fontSize: 12,
          opacity: 0.6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
