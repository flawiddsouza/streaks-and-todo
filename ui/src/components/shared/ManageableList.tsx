import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import './ManageableList.css'
import confirmAsync from './confirmAsync'

export interface ManagedItem {
  id: number
  name: string
  sortOrder: number
}

export interface ManageableListConfig<T extends ManagedItem> {
  pageTitle: string
  backLink: string
  backLinkText: string
  manageButtonText: string
  createPlaceholder: string
  createButtonText: string
  createFirstItemText: string
  noItemsText: string
  confirmDeleteMessage: (itemName: string) => string
  routePrefix: string
  fetchItems: () => Promise<T[]>
  createItem: (name: string) => Promise<T>
  updateItem: (id: number, name: string) => Promise<T>
  deleteItem: (id: number) => Promise<void>
  updateOrder: (
    updates: { groupId: number; sortOrder: number }[],
  ) => Promise<void>
}

interface ManageableListProps<T extends ManagedItem> {
  config: ManageableListConfig<T>
}

export default function ManageableList<T extends ManagedItem>({
  config,
}: ManageableListProps<T>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isManaging, setIsManaging] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editingItemName, setEditingItemName] = useState('')

  useEffect(() => {
    const fetchItemsList = async () => {
      setLoading(true)
      setError(null)

      try {
        const itemsList = await config.fetchItems()
        setItems(itemsList)
      } catch (err) {
        console.error('Error fetching items:', err)
        setError('Failed to fetch items')
      } finally {
        setLoading(false)
      }
    }

    fetchItemsList()
  }, [config])

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemName.trim() || isCreating) return

    setIsCreating(true)
    try {
      const newItem = await config.createItem(newItemName.trim())
      setItems([...items, newItem])
      setNewItemName('')
    } catch (err) {
      console.error('Error creating item:', err)
      setError('Failed to create item')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteItem = async (itemId: number, itemName: string) => {
    const ok = await confirmAsync(config.confirmDeleteMessage(itemName))
    if (!ok) return

    try {
      await config.deleteItem(itemId)
      setItems(items.filter((item) => item.id !== itemId))
    } catch (err) {
      console.error('Error deleting item:', err)
      setError('Failed to delete item')
    }
  }

  const handleEditItem = (item: T) => {
    setEditingItemId(item.id)
    setEditingItemName(item.name)
  }

  const handleSaveEdit = async (itemId: number) => {
    if (!editingItemName.trim()) return

    try {
      const updatedItem = await config.updateItem(
        itemId,
        editingItemName.trim(),
      )
      setItems(items.map((item) => (item.id === itemId ? updatedItem : item)))
      setEditingItemId(null)
      setEditingItemName('')
    } catch (err) {
      console.error('Error updating item:', err)
      setError('Failed to update item')
    }
  }

  const handleCancelEdit = () => {
    setEditingItemId(null)
    setEditingItemName('')
  }

  const moveItem = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return

    const newItems = [...items]
    const [movedItem] = newItems.splice(fromIndex, 1)
    newItems.splice(toIndex, 0, movedItem)

    setItems(newItems)

    try {
      const itemUpdates = newItems.map((item, index) => ({
        groupId: item.id,
        sortOrder: index,
      }))
      await config.updateOrder(itemUpdates)
    } catch (err) {
      console.error('Error updating item order:', err)
      setError('Failed to update item order')
      const itemsList = await config.fetchItems()
      setItems(itemsList)
    }
  }

  return (
    <div className="page" style={{ gridTemplateRows: 'auto auto auto 1fr' }}>
      <nav className="page-nav">
        <div className="nav-left">
          <Link to={config.backLink} className="back-link">
            {config.backLinkText}
          </Link>
        </div>
        <div className="nav-right">
          <button
            type="button"
            onClick={() => setIsManaging(!isManaging)}
            className={`btn btn-primary ${isManaging ? 'active' : ''}`}
            disabled={loading}
          >
            {isManaging ? 'Done Managing' : config.manageButtonText}
          </button>
        </div>
      </nav>

      <h1 className="page-title">{config.pageTitle}</h1>

      {loading && <div>Loading...</div>}

      {error && (
        <div>
          <div style={{ color: 'red' }}>Error: {error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginTop: '10px' }}
          >
            Clear Error
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {isManaging && (
            <div className="create-item-section">
              <form onSubmit={handleCreateItem} className="create-item-form">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={config.createPlaceholder}
                  className="item-name-input"
                  disabled={isCreating}
                />
                <button
                  type="submit"
                  disabled={!newItemName.trim() || isCreating}
                  className="btn btn-success"
                >
                  {isCreating ? 'Creating...' : config.createButtonText}
                </button>
              </form>
            </div>
          )}

          {items.length === 0 ? (
            <div className="no-items">
              <p>{config.noItemsText}</p>
              {!isManaging && (
                <button
                  type="button"
                  onClick={() => setIsManaging(true)}
                  className="btn btn-primary btn-lg"
                >
                  {config.createFirstItemText}
                </button>
              )}
            </div>
          ) : (
            <div className="items-list">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className={`item ${isManaging ? 'managing' : ''}`}
                >
                  {isManaging ? (
                    <div className="item-manage-content">
                      <div className="item-reorder-controls">
                        <button
                          type="button"
                          onClick={() => moveItem(index, index - 1)}
                          disabled={index === 0}
                          className="btn btn-secondary btn-sm"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(index, index + 1)}
                          disabled={index === items.length - 1}
                          className="btn btn-secondary btn-sm"
                          title="Move down"
                        >
                          ↓
                        </button>
                      </div>

                      <div className="item-info">
                        {editingItemId === item.id ? (
                          <div className="edit-item-form">
                            <input
                              type="text"
                              value={editingItemName}
                              onChange={(e) =>
                                setEditingItemName(e.target.value)
                              }
                              className="edit-item-input"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(item.id)}
                              className="btn btn-success btn-md"
                              disabled={!editingItemName.trim()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="btn btn-secondary btn-md"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="item-display">
                            <span className="item-name">{item.name}</span>
                            <Link
                              to={`${config.routePrefix}/${item.id}`}
                              className="view-link"
                            >
                              View →
                            </Link>
                          </div>
                        )}
                      </div>

                      <div className="item-actions">
                        {editingItemId !== item.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditItem(item)}
                              className="btn btn-warning btn-md"
                              title="Edit item name"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteItem(item.id, item.name)
                              }
                              className="btn btn-danger btn-md"
                              title="Delete item"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Link
                      to={`${config.routePrefix}/${item.id}`}
                      className="item-link"
                    >
                      <div className="item-name">{item.name}</div>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
