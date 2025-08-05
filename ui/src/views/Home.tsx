import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  type ApiGroup,
  createGroup,
  deleteGroup,
  fetchGroups,
  updateGroup,
  updateGroupOrder,
} from '../api'
import './Page.css'
import './Home.css'

export default function Home() {
  const [groups, setGroups] = useState<ApiGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isManaging, setIsManaging] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')

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

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim() || isCreating) return

    setIsCreating(true)
    try {
      const newGroup = await createGroup(newGroupName.trim())
      setGroups([...groups, newGroup])
      setNewGroupName('')
    } catch (err) {
      console.error('Error creating group:', err)
      setError('Failed to create group')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteGroup = async (groupId: number, groupName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`,
      )
    ) {
      return
    }

    try {
      await deleteGroup(groupId)
      setGroups(groups.filter((g) => g.id !== groupId))
    } catch (err) {
      console.error('Error deleting group:', err)
      setError('Failed to delete group')
    }
  }

  const handleEditGroup = (group: ApiGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const handleSaveEdit = async (groupId: number) => {
    if (!editingGroupName.trim()) return

    try {
      const updatedGroup = await updateGroup(groupId, editingGroupName.trim())
      setGroups(groups.map((g) => (g.id === groupId ? updatedGroup : g)))
      setEditingGroupId(null)
      setEditingGroupName('')
    } catch (err) {
      console.error('Error updating group:', err)
      setError('Failed to update group')
    }
  }

  const handleCancelEdit = () => {
    setEditingGroupId(null)
    setEditingGroupName('')
  }

  const moveGroup = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return

    const newGroups = [...groups]
    const [movedGroup] = newGroups.splice(fromIndex, 1)
    newGroups.splice(toIndex, 0, movedGroup)

    // Update local state immediately for responsive UI
    setGroups(newGroups)

    try {
      // Update sort order on server
      const groupUpdates = newGroups.map((group, index) => ({
        groupId: group.id,
        sortOrder: index,
      }))
      await updateGroupOrder(groupUpdates)
    } catch (err) {
      console.error('Error updating group order:', err)
      setError('Failed to update group order')
      // Revert on error
      const groupsList = await fetchGroups()
      setGroups(groupsList)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <h1 className="page-title">Streak Groups</h1>
        <div>Loading groups...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <h1 className="page-title">Streak Groups</h1>
        <div style={{ color: 'red' }}>Error: {error}</div>
        <button
          type="button"
          onClick={() => setError(null)}
          style={{ marginTop: '10px' }}
        >
          Clear Error
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Streak Groups</h1>
        <button
          type="button"
          onClick={() => setIsManaging(!isManaging)}
          className={`manage-btn ${isManaging ? 'active' : ''}`}
        >
          {isManaging ? 'Done Managing' : 'Manage Groups'}
        </button>
      </div>

      {isManaging && (
        <div className="create-group-section">
          <form onSubmit={handleCreateGroup} className="create-group-form">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Enter new group name..."
              className="group-name-input"
              disabled={isCreating}
            />
            <button
              type="submit"
              disabled={!newGroupName.trim() || isCreating}
              className="create-btn"
            >
              {isCreating ? 'Creating...' : 'Create Group'}
            </button>
          </form>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="no-groups">
          <p>No groups found</p>
          {!isManaging && (
            <button
              type="button"
              onClick={() => setIsManaging(true)}
              className="create-first-btn"
            >
              Create Your First Group
            </button>
          )}
        </div>
      ) : (
        <div className="groups-list">
          {groups.map((group, index) => (
            <div
              key={group.id}
              className={`group-item ${isManaging ? 'managing' : ''}`}
            >
              {isManaging ? (
                <div className="group-manage-content">
                  <div className="group-reorder-controls">
                    <button
                      type="button"
                      onClick={() => moveGroup(index, index - 1)}
                      disabled={index === 0}
                      className="reorder-btn"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveGroup(index, index + 1)}
                      disabled={index === groups.length - 1}
                      className="reorder-btn"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>

                  <div className="group-info">
                    {editingGroupId === group.id ? (
                      <div className="edit-group-form">
                        <input
                          type="text"
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          className="edit-group-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(group.id)}
                          className="save-btn"
                          disabled={!editingGroupName.trim()}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="group-display">
                        <span className="group-name">{group.name}</span>
                        <Link to={`/group/${group.id}`} className="view-link">
                          View →
                        </Link>
                      </div>
                    )}
                  </div>

                  <div className="group-actions">
                    {editingGroupId !== group.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEditGroup(group)}
                          className="edit-btn"
                          title="Edit group name"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteGroup(group.id, group.name)
                          }
                          className="delete-btn"
                          title="Delete group"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <Link to={`/group/${group.id}`} className="group-link">
                  <div className="group-name">{group.name}</div>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
