import type { TaskGroup } from '../api'
import Modal from './Modal'

export interface GroupSettings {
  table?: {
    showOnlyDaysUntilToday?: boolean
  }
  kanban?: Record<string, unknown>
  calendar?: Record<string, unknown>
}

interface GroupSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  group: TaskGroup | null
  settings: GroupSettings
  onSettingsChange: (settings: GroupSettings) => void
}

export default function GroupSettingsModal({
  isOpen,
  onClose,
  group,
  settings,
  onSettingsChange,
}: GroupSettingsModalProps) {
  if (!group) return null

  const handleTableSettingChange = (
    key: keyof NonNullable<GroupSettings['table']>,
    value: boolean,
  ) => {
    onSettingsChange({
      ...settings,
      table: { ...settings.table, [key]: value },
    })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Settings: ${group.name}`}
      maxWidth="500px"
    >
      <div className="manage-section">
        <h3>Table View Settings</h3>
        <div style={{ marginTop: '12px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              padding: '8px 0',
            }}
          >
            <input
              type="checkbox"
              checked={settings.table?.showOnlyDaysUntilToday ?? false}
              onChange={(e) =>
                handleTableSettingChange(
                  'showOnlyDaysUntilToday',
                  e.target.checked,
                )
              }
              style={{ cursor: 'pointer' }}
            />
            <span>Show only days until today (hide future dates)</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
