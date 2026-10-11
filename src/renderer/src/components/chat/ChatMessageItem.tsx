import { useState } from 'react'
import { Sparkles, Copy, Check, FileText, Zap, RotateCcw, RefreshCw } from 'lucide-react'
import { Markdown } from '@lobehub/ui'
import { ThinkingState } from './ThinkingState'
import { ToolCallsState } from './ToolCallsState'
import type { LiveSegment } from './useAgentChatStream'
import type { PrototypeChatMessage } from '../../stores/usePrototypeStore'

interface ChatMessageItemProps {
  message: PrototypeChatMessage
  index?: number
  isStreaming?: boolean
  /** 本轮运行的时序切片（流式期间与冻结后都有）。 */
  segments?: LiveSegment[]
  onEdit?: (text: string) => void
  onResend?: (index: number) => void
  onRegenerate?: (index: number) => void
}

/**
 * 单条消息渲染（移植自 agent-resume-panel 的 ChatMessageItem）。
 *
 * 有 segments 时按真实时间序渲染思考/工具/正文交错；没有时按消息
 * 自身形状（reasoning → 工具 → 正文）兜底。
 */
export function ChatMessageItem({
  message,
  index = 0,
  isStreaming = false,
  segments,
  onEdit,
  onResend,
  onRegenerate
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const handleCopy = async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const liveSegments = segments ?? []
  const lastSegmentIndex = liveSegments.length - 1

  const body =
    liveSegments.length > 0 ? (
      liveSegments.map((segment, segmentIndex) => {
        const isLast = segmentIndex === lastSegmentIndex
        if (segment.kind === 'reasoning') {
          return (
            <ThinkingState
              key={`seg_reasoning_${segmentIndex}`}
              reasoning={segment.text}
              isStreaming={isStreaming && isLast}
            />
          )
        }
        if (segment.kind === 'tools') {
          return <ToolCallsState key={`seg_tools_${segmentIndex}`} tools={segment.tools} />
        }
        return (
          <div className="pc-bubble" key={`seg_text_${segmentIndex}`}>
            <Markdown>{segment.text}</Markdown>
            {isStreaming && isLast && <span className="pc-caret" />}
          </div>
        )
      })
    ) : (
      <>
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="pc-msg-images">
            {message.attachments.map((att, ai) => (
              <span key={ai} className="pc-msg-image-chip">
                <FileText size={10} />
                <span>{att.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="pc-bubble">
          {message.content ? (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <Markdown>{message.content}</Markdown>
            )
          ) : isStreaming ? (
            <div className="pc-streaming-placeholder">
              <span className="pc-pulse-dot" />
              <span>Agent 正在思考...</span>
            </div>
          ) : null}
        </div>
      </>
    )

  return (
    <div className={`pc-message-row${isUser ? ' is-user' : ' is-assistant'}`}>
      <div className="pc-avatar">
        {isUser ? (
          <span className="pc-avatar-user">我</span>
        ) : (
          <span className="pc-avatar-agent">
            <Zap size={13} />
          </span>
        )}
      </div>

      <div className="pc-message-container">
        {message.inspectContext && (
          <div className="pc-msg-anchor">
            <Sparkles size={10} />
            <span>锚点: &lt;{message.inspectContext.tagName}&gt;</span>
          </div>
        )}

        {body}

        {/* 用户消息操作：复制 / 编辑引用 */}
        {isUser && message.content && !isStreaming && (
          <div className="pc-user-toolbar">
            <button type="button" className="pc-action-btn" onClick={handleCopy} title="复制消息">
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            {onEdit && (
              <button
                type="button"
                className="pc-action-btn"
                onClick={() => onEdit(message.content || '')}
                title="引用到输入框编辑"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </button>
            )}
            {onResend && (
              <button
                type="button"
                className="pc-action-btn"
                onClick={() => onResend(index)}
                disabled={isStreaming}
                title="在新会话中重发这条消息"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        )}

        {/* 助手消息 footer：复制 + 统计 */}
        {!isUser && message.content && !isStreaming && (
          <div className="pc-msg-footer">
            <button type="button" className="pc-action-btn has-label" onClick={handleCopy} title="复制回答">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="pc-action-btn has-label"
                onClick={() => onRegenerate(index)}
                disabled={isStreaming}
                title="重新生成（回退到上一条提问，在新会话中重跑）"
              >
                <RefreshCw size={11} />
                <span>重新生成</span>
              </button>
            )}
            <span className="pc-msg-stats">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
              })}
              {message.stats
                ? ` · ${message.stats.totalTurns > 0 ? `${message.stats.totalTurns} 轮 · ` : ''}${(
                    message.stats.promptTokens + message.stats.completionTokens
                  ).toLocaleString()} tok${
                    message.stats.durationMs ? ` · ${(message.stats.durationMs / 1000).toFixed(1)}s` : ''
                  }`
                : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
