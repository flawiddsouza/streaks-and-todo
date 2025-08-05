import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { type ApiGroup, fetchGroups } from '../api'
import './Page.css'

export default function Home() {
  const [groups, setGroups] = useState<ApiGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchGroupsList = async () => {
      setLoading(true)
      setError(null)

      try {
        const groupsList = await fetchGroups()
        setGroups(groupsList)
      } catch (err) {
        console.error('Error fetching groups:', err)
        setError('Failed to fetch groups')
      } finally {
        setLoading(false)
      }
    }

    fetchGroupsList()
  }, [])

  if (loading) {
    return (
      <div className="page">
        <h1 className="page-title">Stream Groups</h1>
        <div>Loading groups...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <h1 className="page-title">Stream Groups</h1>
        <div style={{ color: 'red' }}>Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1 className="page-title">Stream Groups</h1>

      {groups.length === 0 ? (
        <div>No groups found</div>
      ) : (
        <div className="groups-list">
          {groups.map((group) => (
            <Link
              key={group.id}
              to={`/group/${group.id}`}
              className="group-item"
            >
              <div className="group-name">{group.name}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
