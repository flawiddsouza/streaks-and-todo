import {
  type AiWorkspace,
  createAiWorkspace,
  deleteAiWorkspace,
  fetchAiWorkspaces,
  reorderAiWorkspaces,
  updateAiWorkspace,
} from '../api'
import ManageableList, {
  type ManageableListConfig,
} from '../components/shared/ManageableList'

export default function AiTaskWorkspaces() {
  const config: ManageableListConfig<AiWorkspace> = {
    pageTitle: 'AI Tasks',
    backLink: '/',
    backLinkText: '← Back to Home',
    manageButtonText: 'Manage Workspaces',
    createPlaceholder: 'Enter new workspace name...',
    createButtonText: 'Create Workspace',
    createFirstItemText: 'Create Your First Workspace',
    noItemsText: 'No workspaces found',
    confirmDeleteMessage: (name: string) =>
      `Are you sure you want to delete the workspace "${name}"? This will delete all projects, tasks, and chat history inside it.`,
    routePrefix: '/ai-tasks',
    fetchItems: fetchAiWorkspaces,
    createItem: createAiWorkspace,
    updateItem: updateAiWorkspace,
    deleteItem: deleteAiWorkspace,
    updateOrder: reorderAiWorkspaces,
  }

  return <ManageableList config={config} />
}
