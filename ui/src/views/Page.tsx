import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { fetchGroupStreaks, type StreakGroup } from '../api'
import StreakGroupTable from '../components/StreakGroupTable'
import './Page.css'

export default function Page() {
  const { groupId } = useParams<{ groupId: string }>()
  const [streamName, setStreamName] = useState('')
  const [streakData, setStreakData] = useState<StreakGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleTitleChange = (event: React.FormEvent<HTMLHeadingElement>) => {
    setStreamName(event.currentTarget.textContent || 'My Streaks')
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        if (groupId) {
          // Load specific group
          const groupIdNumber = parseInt(groupId, 10)
          if (Number.isNaN(groupIdNumber)) {
            setError('Invalid group ID')
            return
          }

          const streakGroup = await fetchGroupStreaks(groupIdNumber)
          if (streakGroup) {
            setStreakData([streakGroup])
            setStreamName(streakGroup.name)
          } else {
            setError('Group not found')
          }
        } else {
          // No group ID provided
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
      {groupId && (
        <Link to="/" className="back-link">
          ← Back to Groups
        </Link>
      )}
      <h1
        className="page-title"
        contentEditable="plaintext-only"
        spellCheck={false}
        onBlur={handleTitleChange}
        suppressContentEditableWarning={true}
      >
        {streamName}
      </h1>
      <StreakGroupTable
        streakData={streakData}
        loading={loading}
        error={error}
        onStreakDataChange={setStreakData}
      />
    </div>
  )
}
