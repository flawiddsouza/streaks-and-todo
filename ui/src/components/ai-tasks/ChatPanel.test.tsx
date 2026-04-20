import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatPanel from './ChatPanel'

describe('ChatPanel', () => {
  it('renders assistant messages as markdown but keeps user messages literal', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        workspaceId={1}
        messages={[
          {
            id: 1,
            role: 'assistant',
            content: '**bold**',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
          {
            id: 2,
            role: 'user',
            content: '**literal**',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
        ]}
        onMessagesChange={() => {}}
      />,
    )

    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('**literal**')
  })

  it('renders single newlines in assistant messages as hard breaks', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        workspaceId={1}
        messages={[
          {
            id: 1,
            role: 'assistant',
            content: 'first line\nsecond line',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
        ]}
        onMessagesChange={() => {}}
      />,
    )

    expect(html).toContain('<br/>')
  })

  it('renders escaped newline sequences in assistant messages as hard breaks', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        workspaceId={1}
        messages={[
          {
            id: 1,
            role: 'assistant',
            content: 'first line\\nsecond line',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
        ]}
        onMessagesChange={() => {}}
      />,
    )

    expect(html).toContain('<br/>')
  })

  it('does not bold plain quoted database text in comparison responses', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        workspaceId={1}
        messages={[
          {
            id: 1,
            role: 'assistant',
            content: `Here are the specific differences:\n\nCooking Buddy\n\n- The final task regarding dish leftovers contains an extra string at the end.\n  - Actual text in database: "Dish gets leftover even if there are no more memories under it - also are we deleting embedding when we delete the memories? please check21111"`,
            createdAt: '2026-04-20T00:00:00.000Z',
          },
        ]}
        onMessagesChange={() => {}}
      />,
    )

    expect(html).not.toContain('<strong>Dish gets leftover')
  })
})
