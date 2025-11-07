import type { ApiStreak, StreakGroup } from '../../api'
import Modal from './Modal'
import './ManageGroupModal.css'
import { useState } from 'react'
import { updateStreakNotifications } from '../../api'

interface ManageGroupModalProps {
  isOpen: boolean
  onClose: () => void
  group: StreakGroup | null
  allStreaks: ApiStreak[]
  onRemoveStreak: (streakId: number) => Promise<void>
  onAddStreak: (streakId: number) => Promise<void>
  onReorderStreak: (fromIndex: number, toIndex: number) => Promise<void>
  onCreateStreak: (name: string) => Promise<void>
  onUpdateStreak?: (streakId: number, updates: Partial<ApiStreak>) => void
}

export default function ManageGroupModal({
  isOpen,
  onClose,
  group,
  allStreaks,
  onRemoveStreak,
  onAddStreak,
  onReorderStreak,
  onCreateStreak,
  onUpdateStreak,
}: ManageGroupModalProps) {
  const [newStreakName, setNewStreakName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  if (!group) return null

  const availableStreaks = allStreaks.filter(
    (streak) => !group.streaks.some((gs) => gs.id === streak.id),
  )

  const handleCreateStreak = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStreakName.trim() || isCreating) return

    setIsCreating(true)
    try {
      await onCreateStreak(newStreakName.trim())
      setNewStreakName('')
    } finally {
      setIsCreating(false)
    }
  }

  const handleToggleNotifications = async (
    streakId: number,
    currentValue: boolean,
  ) => {
    try {
      const updated = await updateStreakNotifications(streakId, !currentValue)
      if (onUpdateStreak) {
        onUpdateStreak(streakId, {
          notificationsEnabled: updated.notificationsEnabled,
        })
      }
    } catch (error) {
      console.error('Failed to toggle notifications:', error)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Manage Group: ${group.name}`}
      maxWidth="600px"
    >
      <div className="manage-section">
        <h3>Current Streaks</h3>
        <div className="streak-list">
          {group.streaks.map((streak, index) => (
            <div key={streak.id} className="streak-item">
              <div className="streak-info">
                <span className="streak-name">{streak.name}</span>
                <label className="notification-toggle">
                  <input
                    type="checkbox"
                    checked={streak.notificationsEnabled || false}
                    onChange={() =>
                      handleToggleNotifications(
                        streak.id,
                        streak.notificationsEnabled || false,
                      )
                    }
                    title="Enable evening reminders if incomplete"
                  />
                  <span className="notification-label">🔔 Reminders</span>
                </label>
              </div>
              <div className="streak-actions">
                <button
                  type="button"
                  onClick={() => onReorderStreak(index, Math.max(0, index - 1))}
                  disabled={index === 0}
                  className="btn btn-secondary btn-sm"
                  aria-label={`Move ${streak.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onReorderStreak(
                      index,
                      Math.min(group.streaks.length - 1, index + 1),
                    )
                  }
                  disabled={index === group.streaks.length - 1}
                  className="btn btn-secondary btn-sm"
                  aria-label={`Move ${streak.name} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveStreak(streak.id)}
                  className="btn btn-danger btn-sm"
                  aria-label={`Remove ${streak.name} from group`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {group.streaks.length === 0 && (
            <p className="no-streaks">No streaks in this group</p>
          )}
        </div>
      </div>

      <div className="manage-section">
        <h3>Add Streaks</h3>
        <div className="available-streaks">
          {availableStreaks.map((streak) => (
            <div key={streak.id} className="available-streak-item">
              <span className="streak-name">{streak.name}</span>
              <button
                type="button"
                onClick={() => onAddStreak(streak.id)}
                className="btn btn-success btn-sm"
                aria-label={`Add ${streak.name} to group`}
              >
                Add
              </button>
            </div>
          ))}
          {availableStreaks.length === 0 && (
            <p className="no-streaks">No additional streaks available</p>
          )}
        </div>
      </div>

      <div className="manage-section">
        <h3>Create New Streak</h3>
        <form onSubmit={handleCreateStreak} className="create-streak-form">
          <div className="form-group">
            <input
              type="text"
              value={newStreakName}
              onChange={(e) => setNewStreakName(e.target.value)}
              placeholder="Enter streak name..."
              className="streak-name-input"
              disabled={isCreating}
            />
            <button
              type="submit"
              disabled={!newStreakName.trim() || isCreating}
              className="btn btn-primary"
            >
              {isCreating ? 'Creating...' : 'Create & Add'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
