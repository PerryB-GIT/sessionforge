'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Bot, X, Send, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
  suggestedCommand?: string
}

interface AiCopilotPanelProps {
  sessionId: string
  onSendToTerminal?: (cmd: string) => void
  isOpen: boolean
  onClose: () => void
}

export function AiCopilotPanel({
  sessionId,
  onSendToTerminal,
  isOpen,
  onClose,
}: AiCopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = useCallback(async () => {
    const userMessage = input.trim()
    if (!userMessage || isStreaming) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)

    // Add a placeholder for the assistant reply
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    abortRef.current = new AbortController()

    try {
      const res = await fetch(`/api/sessions/${sessionId}/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: 'Failed to connect to AI service.',
          }
          return updated
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let rawText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string }
            if (parsed.text) {
              rawText += parsed.text
              // Update the last assistant message with accumulated text (raw, not yet parsed)
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: rawText,
                }
                return updated
              })
            }
          } catch {
            // Partial JSON chunk — skip
          }
        }
      }

      // Once streaming is done, try to parse JSON to extract reply + suggestedCommand
      try {
        const parsed = JSON.parse(rawText) as { reply?: string; suggestedCommand?: string }
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: parsed.reply ?? rawText,
            suggestedCommand: parsed.suggestedCommand || undefined,
          }
          return updated
        })
      } catch {
        // Not JSON — show raw text as-is
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Connection error. Please try again.',
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, sessionId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage()
      }
    },
    [sendMessage]
  )

  if (!isOpen) return null

  return (
    <div className="flex flex-col h-full border-l border-[#1e1e2e] bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e2e] shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-white">AI Co-pilot</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-xs pt-8">
            <Bot className="h-8 w-8 mx-auto mb-2 text-gray-700" />
            <p>Ask about your terminal output,</p>
            <p>errors, or what to do next.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[90%] rounded-lg px-3 py-2 text-xs',
                msg.role === 'user'
                  ? 'bg-purple-500/20 text-purple-100 border border-purple-500/20'
                  : 'bg-[#1e1e2e] text-gray-200 border border-[#2a2a3e]'
              )}
            >
              {msg.content || <span className="text-gray-500 animate-pulse">Thinking...</span>}
            </div>

            {/* Suggested command button */}
            {msg.role === 'assistant' && msg.suggestedCommand && (
              <div className="max-w-[90%] w-full">
                <div className="flex items-center gap-1.5 bg-[#111118] border border-[#1e1e2e] rounded px-2 py-1.5">
                  <Terminal className="h-3 w-3 text-green-400 shrink-0" />
                  <code className="flex-1 text-xs text-green-300 font-mono truncate">
                    {msg.suggestedCommand}
                  </code>
                  {onSendToTerminal && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-5 w-5 shrink-0 text-gray-500 hover:text-white"
                      onClick={() => onSendToTerminal(msg.suggestedCommand! + '\r')}
                      title="Send to terminal"
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#1e1e2e] p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your session..."
            disabled={isStreaming}
            className="flex-1 bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
          <Button
            variant="default"
            size="icon-sm"
            onClick={() => void sendMessage()}
            disabled={isStreaming || !input.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
