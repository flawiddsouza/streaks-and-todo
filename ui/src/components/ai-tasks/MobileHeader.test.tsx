import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import MobileHeader from './MobileHeader'

function render(
  props: Partial<React.ComponentProps<typeof MobileHeader>> = {},
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MobileHeader
        backHref="/ai-tasks"
        activeTab="tasks"
        onTabChange={() => {}}
        chatHasUnread={false}
        showDone={false}
        onToggleShowDone={() => {}}
        doneCount={0}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('MobileHeader', () => {
  it('renders Tasks and Chat tabs', () => {
    const html = render()
    expect(html).toContain('>Tasks<')
    expect(html).toContain('>Chat')
  })

  it('shows the Show-done button only when on Tasks tab and doneCount > 0', () => {
    expect(render({ activeTab: 'tasks', doneCount: 0 })).not.toContain(
      'ai-show-done-btn',
    )
    expect(render({ activeTab: 'tasks', doneCount: 3 })).toContain(
      'Show done (3)',
    )
    expect(render({ activeTab: 'chat', doneCount: 3 })).not.toContain(
      'ai-show-done-btn',
    )
  })

  it('shows the unread dot only when chatHasUnread is true', () => {
    expect(render({ chatHasUnread: false })).not.toContain(
      'ai-mobile-tab-unread-dot',
    )
    expect(render({ chatHasUnread: true })).toContain(
      'ai-mobile-tab-unread-dot',
    )
  })

  it('marks the active tab with aria-selected and the active class', () => {
    const html = render({ activeTab: 'chat' })
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('ai-mobile-tab-active')
  })
})
