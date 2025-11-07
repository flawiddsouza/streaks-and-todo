import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import './DatePickerDialog.css'

interface DatePickerDialogProps {
  onSelectDate: (date: string) => void
  onCancel: () => void
  initialDate?: string
}

export default function DatePickerDialog({
  onSelectDate,
  onCancel,
  initialDate,
}: DatePickerDialogProps) {
  const [selectedDate, setSelectedDate] = useState(
    initialDate || dayjs().format('YYYY-MM-DD'),
  )
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedDate) {
      onSelectDate(selectedDate)
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Overlay is intentionally interactive
    // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard handled by form submit
    <div className="date-picker-overlay" onClick={onCancel}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Dialog prevents event propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Click only prevents propagation */}
      <div className="date-picker-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Schedule Task</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="date-picker-input"
            ref={inputRef}
          />
          <div className="date-picker-actions">
            <button type="button" onClick={onCancel} className="btn-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-schedule">
              Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
