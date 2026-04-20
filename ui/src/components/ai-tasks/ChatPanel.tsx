import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import type { AiChatMessage } from '../../api'
import { deleteAiChatFrom, sendAiChatMessage } from '../../api'
import DeleteConfirmPopover from './DeleteConfirmPopover'

interface Props {
  workspaceId: number
  messages: AiChatMessage[]
  onMessagesChange: (messages: AiChatMessage[]) => void
}

function normalizeAssistantMarkdown(content: string) {
  return content.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer" />
        ),
      }}
    >
      {normalizeAssistantMarkdown(content)}
    </ReactMarkdown>
  )
}

export default function ChatPanel({
  workspaceId,
  messages,
  onMessagesChange,
}: Props) {
  const MAX_INPUT_HEIGHT = 180
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(
    null,
  )
  const deleteButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Strip any <action>...</action> blocks (and partial opening tags) from streamed text
  function clean(text: string): string {
    return text
      .replace(/<action>[\s\S]*?<\/action>/g, '') // complete blocks
      .replace(/<action>[^<]*/g, '') // incomplete block still streaming
      .trimStart()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are scroll triggers, not values read in the effect
  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, streamingText])

  // biome-ignore lint/correctness/useExhaustiveDependencies: input change triggers resize; el.scrollHeight is read, not input directly
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
  }, [input])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setStreaming(true)
    setStreamingText('')

    // Optimistically add user message with a temp ID (will be replaced with real DB ID)
    const tempId = Date.now()
    const tempUserMsg: AiChatMessage = {
      id: tempId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    onMessagesChange([...messages, tempUserMsg])

    try {
      const res = await sendAiChatMessage(workspaceId, text)
      if (!res.ok) {
        setStreaming(false)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) {
        setStreaming(false)
        return
      }
      const decoder = new TextDecoder()
      let accumulated = ''
      let realUserMsgId: number | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        // Parse user message ID from the first line sent by server
        if (
          realUserMsgId === null &&
          accumulated.startsWith('__USERMSGID__:')
        ) {
          const newline = accumulated.indexOf('\n')
          if (newline !== -1) {
            realUserMsgId = parseInt(accumulated.slice(14, newline))
            accumulated = accumulated.slice(newline + 1)
          }
        }
        setStreamingText(accumulated)
      }
      // Parse assistant message ID from end of stream
      const idMarker = '\n__ASSISTANTID__:'
      const idIdx = accumulated.lastIndexOf(idMarker)
      let assistantId = Date.now()
      let finalText = accumulated
      if (idIdx !== -1) {
        assistantId = parseInt(accumulated.slice(idIdx + idMarker.length))
        finalText = accumulated.slice(0, idIdx)
      }
      // Build final state: real user message + assistant message - no DB fetch needed
      const userMsg: AiChatMessage = {
        ...tempUserMsg,
        id: realUserMsgId ?? tempId,
      }
      const assistantMsg: AiChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: clean(finalText).trim(),
        createdAt: new Date().toISOString(),
      }
      onMessagesChange([...messages, userMsg, assistantMsg])
      setStreamingText('')
    } catch (e) {
      console.error('Chat error:', e)
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function deleteFrom(msg: AiChatMessage) {
    await deleteAiChatFrom(workspaceId, msg.id)
    const idx = messages.findIndex((m) => m.id === msg.id)
    onMessagesChange(idx === -1 ? messages : messages.slice(0, idx))
  }

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-body" ref={bodyRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`ai-msg ${msg.role}`}>
            <div className="ai-msg-label">
              <span>{msg.role === 'user' ? 'You' : 'AI'}</span>
              {!streaming && (
                <div style={{ position: 'relative' }}>
                  <button
                    ref={(el) => {
                      if (el) deleteButtonRefs.current.set(msg.id, el)
                      else deleteButtonRefs.current.delete(msg.id)
                    }}
                    type="button"
                    className="ai-msg-delete"
                    title="Delete from here"
                    style={
                      confirmingDeleteId === msg.id
                        ? { opacity: 1, color: '#ff6b6b' }
                        : undefined
                    }
                    onClick={() => setConfirmingDeleteId(msg.id)}
                  >
                    ✕
                  </button>
                  {confirmingDeleteId === msg.id && (
                    <DeleteConfirmPopover
                      anchorEl={deleteButtonRefs.current.get(msg.id) ?? null}
                      message="Delete from here?"
                      onConfirm={() => {
                        setConfirmingDeleteId(null)
                        deleteFrom(msg)
                      }}
                      onCancel={() => setConfirmingDeleteId(null)}
                    />
                  )}
                </div>
              )}
            </div>
            <div
              className={`ai-bubble${msg.role === 'assistant' ? ' ai-bubble-markdown' : ''}`}
            >
              {msg.role === 'assistant' ? (
                <AssistantMarkdown content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {streaming && streamingText && (
          <div className="ai-msg assistant">
            <div className="ai-msg-label">
              <span>AI</span>
            </div>
            <div className="ai-bubble ai-bubble-markdown">
              <AssistantMarkdown content={clean(streamingText)} />
            </div>
          </div>
        )}
        {streaming && !streamingText && (
          <div className="ai-msg assistant">
            <div className="ai-msg-label">
              <span>AI</span>
            </div>
            <div className="ai-bubble ai-typing-bubble">
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
            </div>
          </div>
        )}
      </div>
      <div className="ai-chat-input">
        <div className="ai-chat-input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            rows={1}
            disabled={streaming}
          />
          <button
            type="button"
            className="ai-chat-send"
            onClick={send}
            disabled={streaming || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
