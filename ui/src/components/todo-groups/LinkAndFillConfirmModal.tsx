import { useMemo, useState } from 'react'
import type { ApiFamilyFill } from '../../api'
import Modal from '../shared/Modal'

interface LinkAndFillConfirmModalProps {
  isOpen: boolean
  title: string
  fills: ApiFamilyFill[]
  onCancel: () => void
  onLinkOnly: () => Promise<void> | void
  onLinkAndFill: () => Promise<void> | void
}

export default function LinkAndFillConfirmModal({
  isOpen,
  title,
  fills,
  onCancel,
  onLinkOnly,
  onLinkAndFill,
}: LinkAndFillConfirmModalProps) {
  const [busy, setBusy] = useState(false)
  const [confirmingLinkOnly, setConfirmingLinkOnly] = useState(false)

  const { allDates, totalEntries, dateSetByTask } = useMemo(() => {
    const dateSet = new Set<string>()
    const byTask = new Map<number, Set<string>>()
    let total = 0
    for (const f of fills) {
      const fillSet = new Set(f.dates)
      byTask.set(f.taskId, fillSet)
      for (const d of f.dates) dateSet.add(d)
      total += f.dates.length
    }
    return {
      allDates: Array.from(dateSet).sort(),
      totalEntries: total,
      dateSetByTask: byTask,
    }
  }, [fills])

  const handleCancel = () => {
    if (busy) return
    setConfirmingLinkOnly(false)
    onCancel()
  }

  const wrap = async (fn: () => Promise<void> | void) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      setConfirmingLinkOnly(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      maxWidth="720px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          {totalEntries} streak {totalEntries === 1 ? 'entry' : 'entries'} will
          be added across {fills.length} {fills.length === 1 ? 'task' : 'tasks'}
          .
        </div>

        <div
          style={{
            maxHeight: 360,
            overflow: 'auto',
            border: '1px solid #eee',
            borderRadius: 4,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '6px 10px',
                    borderBottom: '1px solid #eee',
                    position: 'sticky',
                    top: 0,
                    background: '#fafafa',
                    fontWeight: 500,
                    width: 110,
                  }}
                >
                  Date
                </th>
                {fills.map((f) => (
                  <th
                    key={f.taskId}
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #eee',
                      position: 'sticky',
                      top: 0,
                      background: '#fafafa',
                      fontWeight: 400,
                    }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {allDates.map((date) => (
                <tr key={date}>
                  <td
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #f4f4f4',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {date}
                  </td>
                  {fills.map((f) => (
                    <td
                      key={f.taskId}
                      style={{
                        padding: '6px 10px',
                        borderBottom: '1px solid #f4f4f4',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {dateSetByTask.get(f.taskId)?.has(date) ? f.taskName : ''}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td
                  style={{
                    padding: '8px 10px',
                    borderTop: '2px solid #ddd',
                    fontWeight: 500,
                  }}
                >
                  Totals
                </td>
                {fills.map((f) => (
                  <td
                    key={f.taskId}
                    style={{
                      padding: '8px 10px',
                      borderTop: '2px solid #ddd',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ({f.dates.length})
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {confirmingLinkOnly ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 12px',
              background: '#fff7e6',
              border: '1px solid #ffd591',
              borderRadius: 4,
            }}
          >
            <span style={{ fontSize: 13 }}>
              Skip filling {totalEntries}{' '}
              {totalEntries === 1 ? 'entry' : 'entries'}? You can fill them
              later via the per-task Fill button.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmingLinkOnly(false)}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => wrap(onLinkOnly)}
                disabled={busy}
              >
                {busy ? 'Linking...' : 'Yes, link only'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={handleCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmingLinkOnly(true)}
              disabled={busy}
            >
              Link only
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => wrap(onLinkAndFill)}
              disabled={busy}
            >
              {busy ? 'Working...' : 'Link and fill'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
