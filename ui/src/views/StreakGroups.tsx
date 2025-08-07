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

export default function StreakGroups() {
  const config: ManageableListConfig<ApiGroup> = {
    pageTitle: 'Streak Groups',
    backLink: '/',
    backLinkText: '← Back to Home',
    manageButtonText: 'Manage Groups',
    createPlaceholder: 'Enter new group name...',
    createButtonText: 'Create Group',
    createFirstItemText: 'Create Your First Group',
    noItemsText: 'No groups found',
    confirmDeleteMessage: (groupName: string) =>
      `Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`,
    routePrefix: '/streaks',
    fetchItems: () => fetchGroups('streaks'),
    createItem: (name: string) => createGroup(name, 'streaks'),
    updateItem: updateGroup,
    deleteItem: deleteGroup,
    updateOrder: updateGroupOrder,
  }

  return <ManageableList config={config} />
}
