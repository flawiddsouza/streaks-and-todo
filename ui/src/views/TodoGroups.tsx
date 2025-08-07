import {
  type ApiGroup,
  createGroup,
  deleteGroup,
  fetchGroups,
  updateGroup,
  updateGroupOrder,
} from '../api'
import ManageableList, {
  type ManageableListConfig,
} from '../components/ManageableList'

export default function TodoGroups() {
  const config: ManageableListConfig<ApiGroup> = {
    pageTitle: 'Todo Groups',
    backLink: '/',
    backLinkText: '← Back to Home',
    manageButtonText: 'Manage Todo Groups',
    createPlaceholder: 'Enter new todo group name...',
    createButtonText: 'Create Todo Group',
    createFirstItemText: 'Create Your First Todo Group',
    noItemsText: 'No todo groups found',
    confirmDeleteMessage: (groupName: string) =>
      `Are you sure you want to delete the todo group "${groupName}"? This action cannot be undone.`,
    routePrefix: '/todo',
    fetchItems: () => fetchGroups('tasks'),
    createItem: (name: string) => createGroup(name, 'tasks'),
    updateItem: updateGroup,
    deleteItem: deleteGroup,
    updateOrder: updateGroupOrder,
  }

  return <ManageableList config={config} />
}
