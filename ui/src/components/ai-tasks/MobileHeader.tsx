import { Link } from 'react-router'

export type MobileTab = 'tasks' | 'chat'

interface Props {
  backHref: string
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  chatHasUnread: boolean
  showDone: boolean
  onToggleShowDone: () => void
  doneCount: number
}

export default function MobileHeader({
  backHref,
  activeTab,
  onTabChange,
  chatHasUnread,
  showDone,
  onToggleShowDone,
  doneCount,
}: Props) {
  return (
    <div className="ai-mobile-header">
      <Link to={backHref} className="ai-back-link" aria-label="Back">
        ←
      </Link>
      <div className="ai-mobile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tasks'}
          className={`ai-mobile-tab${activeTab === 'tasks' ? ' ai-mobile-tab-active' : ''}`}
          onClick={() => onTabChange('tasks')}
        >
          Tasks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          className={`ai-mobile-tab${activeTab === 'chat' ? ' ai-mobile-tab-active' : ''}`}
          onClick={() => onTabChange('chat')}
        >
          Chat
          {chatHasUnread && (
            <span className="ai-mobile-tab-unread-dot" aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="ai-mobile-header-right">
        {activeTab === 'tasks' && doneCount > 0 && (
          <button
            type="button"
            className="ai-show-done-btn"
            onClick={onToggleShowDone}
          >
            {showDone ? 'Hide done' : `Show done (${doneCount})`}
          </button>
        )}
      </div>
    </div>
  )
}
