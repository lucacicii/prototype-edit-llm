import React, { useState } from 'react'
import {
  Sparkles,
  Copy,
  Check,
  FileText,
  Zap,
  RotateCcw,
  RefreshCw,
  Pencil,
  AlertCircle
} from 'lucide-react'
import { Markdown } from '@lobehub/ui'
import { ThinkingState } from './ThinkingState'
import { ToolCallsState } from './ToolCallsState'
import type { LiveSegment } from './useAgentChatStream'
import type { PrototypeChatMessage } from '../../stores/usePrototypeStore'

// 与 chat.css 中 .pc-bubble 的字号/行高保持一致，让用户纯文本与 Agent Markdown 同大。
const BUBBLE_FONT_SIZE = 13.5
const BUBBLE_LINE_HEIGHT = 1.6

interface ChatMessageItemProps {
  message: PrototypeChatMessage
  index?: number
  isStreaming?: boolean
  /** 本轮运行的时序切片（流式期间与冻结后都有）。 */
  segments?: LiveSegment[]
  /**
   * 本次 run 已完成的轮次圆点。作为容器的第一个子节点渲染，落在头像之后、
   * 正文之前 —— 一轮的过程属于 Agent 的回复，不属于整个面板。
   */
  turnDots?: React.ReactNode
  onEdit?: (text: string) => void
  onResend?: (index: number) => void
  onRegenerate?: (index: number) => void
}

/**
 * 单条消息渲染（对齐 agent-resume-panel 的 ChatMessageItem）。
 *
 * 有 segments 时按真实时间序渲染思考/工具/正文交错；没有时按消息
 * 自身形状（reasoning → 工具 → 正文）兜底。
 */
export function ChatMessageItem({
  message,
  index = 0,
  isStreaming = false,
  segments,
  turnDots,
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
      // 剪贴板不可用时静默失败
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
        if (segment.kind === 'notice') {
          return (
            <div className="pc-turn-notice" key={`seg_notice_${segmentIndex}`}>
              {segment.text}
            </div>
          )
        }
        return (
          <div className="pc-bubble" key={`seg_text_${segmentIndex}`}>
            <Markdown fontSize={BUBBLE_FONT_SIZE} lineHeight={BUBBLE_LINE_HEIGHT}>
              {segment.text}
            </Markdown>
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
              <div className="pc-bubble-text">{message.content}</div>
            ) : (
              <Markdown fontSize={BUBBLE_FONT_SIZE} lineHeight={BUBBLE_LINE_HEIGHT}>
                {message.content}
              </Markdown>
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

  const isErrorAnswer = !isUser && message.content?.startsWith('⚠️')

  return (
    <div className={`pc-message-row${isUser ? ' is-user' : ' is-assistant'}`}>
      <div className="pc-avatar">
        {isUser ? (
          <span className="pc-avatar-user">我</span>
        ) : (
          <span className="pc-avatar-agent">
            <Zap size={14} />
          </span>
        )}
      </div>

      <div className="pc-message-container">
        {turnDots}

        {message.inspectContext && (
          <div className="pc-msg-anchor">
            <Sparkles size={10} />
            <span>锚点: &lt;{message.inspectContext.tagName}&gt;</span>
          </div>
        )}

        {body}

        {/* 用户消息操作：复制 / 编辑引用 / 重发（悬停显示） */}
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
                <Pencil size={11} />
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

        {/* 失败回答：单独的「重试任务」横幅 */}
        {isErrorAnswer && onRegenerate && (
          <div className="pc-message-error-action">
            <button
              type="button"
              className="pc-message-retry-btn"
              onClick={() => onRegenerate(index)}
              disabled={isStreaming}
              title="重试本次任务"
            >
              <AlertCircle size={11} />
              <span>重试任务</span>
            </button>
          </div>
        )}

        {/* 助手消息 footer：复制 + 重新生成 + 统计 */}
        {!isUser && message.content && !isStreaming && (
          <div className="pc-msg-footer">
            <button
              type="button"
              className="pc-action-btn has-label"
              onClick={handleCopy}
              title="复制回答"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            {onRegenerate && !isErrorAnswer && (
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
              {(() => {
                const stats = message.stats
                if (!stats) return ''
                const turns = stats.totalTurns > 0 ? `${stats.totalTurns} 轮 · ` : ''
                // token 用量拿不到时（ACP 协议不回）就只报时长，不报一个 0 tok。
                const tokens =
                  stats.promptTokens + stats.completionTokens > 0
                    ? `${(stats.promptTokens + stats.completionTokens).toLocaleString()} tok`
                    : ''
                const duration = stats.durationMs ? `${(stats.durationMs / 1000).toFixed(1)}s` : ''
                const detail = [turns.replace(/ · $/, ''), tokens, duration].filter(Boolean).join(' · ')
                return detail ? ` · ${detail}` : ''
              })()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
