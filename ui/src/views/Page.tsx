import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  type ApiStreak,
  addStreakToGroup,
  createStreak,
  fetchAllStreaks,
  fetchGroupStreaks,
  removeStreakFromGroup,
  type StreakGroup,
  updateGroup,
  updateStreakOrder,
} from '../api'
import ManageGroupModal from '../components/ManageGroupModal'
import StreakGroupTable from '../components/StreakGroupTable'
import './Page.css'

export default function Page() {
  const { groupId } = useParams<{ groupId: string }>()
  const [streakData, setStreakData] = useState<StreakGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showManageModal, setShowManageModal] = useState(false)
  const [allStreaks, setAllStreaks] = useState<ApiStreak[]>([])
  const [managingGroup, setManagingGroup] = useState<StreakGroup | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  const handleTitleChange = async (
    event: React.FormEvent<HTMLHeadingElement>,
  ) => {
    const newName = event.currentTarget.textContent || ''
    await updateGroup(parseInt(groupId || '0'), newName)
  }

  const handleTitleKeyDown = (
    event: React.KeyboardEvent<HTMLHeadingElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
    }
  }

  const handleTitlePaste = (
    event: React.ClipboardEvent<HTMLHeadingElement>,
  ) => {
    event.preventDefault()
    const paste = event.clipboardData.getData('text/plain')
    const cleanPaste = paste.replace(/\r?\n|\r/g, ' ').trim()
    document.execCommand('insertText', false, cleanPaste)
  }

  const handleManageGroup = async () => {
    if (streakData.length > 0) {
      setManagingGroup(streakData[0])
      try {
        const allStreaksData = await fetchAllStreaks()
        setAllStreaks(allStreaksData)
        setShowManageModal(true)
      } catch (err) {
        console.error('Error fetching all streaks:', err)
      }
    }
  }

  const handleRemoveStreak = async (streakId: number) => {
    if (!managingGroup || !groupId) return

    try {
      await removeStreakFromGroup(parseInt(groupId), streakId)
      const updatedGroup = await fetchGroupStreaks(parseInt(groupId))
      if (updatedGroup) {
        setStreakData([updatedGroup])
        setManagingGroup(updatedGroup)
      }
    } catch (err) {
      console.error('Error removing streak from group:', err)
    }
  }

  const handleAddStreak = async (streakId: number) => {
    if (!managingGroup || !groupId) return

    try {
      const sortOrder = managingGroup.streaks.length
      await addStreakToGroup(parseInt(groupId), streakId, sortOrder)
      const updatedGroup = await fetchGroupStreaks(parseInt(groupId))
      if (updatedGroup) {
        setStreakData([updatedGroup])
        setManagingGroup(updatedGroup)
      }
    } catch (err) {
      console.error('Error adding streak to group:', err)
    }
  }

  const handleReorderStreak = async (fromIndex: number, toIndex: number) => {
    if (!managingGroup || !groupId) return

    const newStreaks = [...managingGroup.streaks]
    const [moved] = newStreaks.splice(fromIndex, 1)
    newStreaks.splice(toIndex, 0, moved)

    try {
      const updates = newStreaks.map((streak, index) => ({
        streakId: streak.id,
        sortOrder: index,
      }))

      await updateStreakOrder(parseInt(groupId), updates)

      const updatedGroup = { ...managingGroup, streaks: newStreaks }
      setStreakData([updatedGroup])
      setManagingGroup(updatedGroup)
    } catch (err) {
      console.error('Error reordering streaks:', err)
    }
  }

  const handleCreateStreak = async (name: string) => {
    if (!managingGroup || !groupId) return

    try {
      const newStreak = await createStreak(name)

      const sortOrder = managingGroup.streaks.length
      await addStreakToGroup(parseInt(groupId), newStreak.id, sortOrder)

      const [updatedGroup, allStreaksData] = await Promise.all([
        fetchGroupStreaks(parseInt(groupId)),
        fetchAllStreaks(),
      ])

      if (updatedGroup) {
        setStreakData([updatedGroup])
        setManagingGroup(updatedGroup)
        setAllStreaks(allStreaksData)
      }
    } catch (err) {
      console.error('Error creating and adding streak:', err)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        if (groupId) {
          const groupIdNumber = parseInt(groupId, 10)
          if (Number.isNaN(groupIdNumber)) {
            setError('Invalid group ID')
            return
          }

          const streakGroup = await fetchGroupStreaks(groupIdNumber)
          if (streakGroup) {
            setStreakData([streakGroup])
            if (titleRef.current) {
              titleRef.current.textContent = streakGroup.name || ''
            }
          } else {
            setError('Group not found')
          }
        } else {
          setError('No group ID provided')
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to fetch streak data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [groupId])

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="nav-left">
          {groupId && (
            <Link to="/" className="back-link">
              ← Back to Groups
            </Link>
          )}
        </div>
        <div className="nav-right">
          {groupId && (
            <button
              type="button"
              className="manage-group-btn"
              onClick={handleManageGroup}
            >
              Manage Group
            </button>
          )}
        </div>
      </nav>

      {/** biome-ignore lint/a11y/useHeadingContent: dynamic replacement */}
      <h1
        ref={titleRef}
        className="page-title"
        contentEditable="plaintext-only"
        spellCheck={false}
        onInput={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        onPaste={handleTitlePaste}
        suppressContentEditableWarning={true}
      ></h1>

      <StreakGroupTable
        streakData={streakData}
        loading={loading}
        error={error}
        onStreakDataChange={setStreakData}
      />

      <ManageGroupModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
        group={managingGroup}
        allStreaks={allStreaks}
        onRemoveStreak={handleRemoveStreak}
        onAddStreak={handleAddStreak}
        onReorderStreak={handleReorderStreak}
        onCreateStreak={handleCreateStreak}
      />
    </div>
  )
}
