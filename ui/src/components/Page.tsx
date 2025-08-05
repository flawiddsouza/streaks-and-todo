import { useEffect, useState } from 'react'
import { fetchGroupStreaks, fetchGroups, type StreakGroup } from '../api'
import StreakGroupTable from './StreakGroupTable'
import './Page.css'

export default function Page() {
  const [streamName, setStreamName] = useState('My Streaks')
  const [streakData, setStreakData] = useState<StreakGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleTitleChange = (event: React.FormEvent<HTMLHeadingElement>) => {
    setStreamName(event.currentTarget.textContent || 'My Streaks')
  }

  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true)
      setError(null)

      try {
        const groupsList = await fetchGroups()
        if (groupsList.length === 0) {
          setStreakData([])
          return
        }

        const streakGroupPromises = groupsList.map((group) =>
          fetchGroupStreaks(group.id),
        )
        const streakGroups = await Promise.all(streakGroupPromises)
        const validStreakGroups = streakGroups.filter(
          (group): group is StreakGroup => group !== null,
        )

        setStreakData(validStreakGroups)
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to fetch streak data')
      } finally {
        setLoading(false)
      }
    }

    fetchAllData()
  }, [])

  return (
    <div className="page">
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
