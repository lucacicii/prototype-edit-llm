import type React from 'react'
import { ChatMessageItem } from './ChatMessageItem'
import { ChatEmptyState } from './ChatEmptyState'
import type { LiveSegment } from './useAgentChatStream'
import type { ProductScenario, PrototypeChatMessage } from '../../stores/usePrototypeStore'

/**
 * 消息流：滚动容器 + 历史消息 + 正在流式的那一轮。
 *
 * 空状态与消息列表二选一；两者都占满同一块滚动区，所以切换时不会跳动。
 */
export function ChatFeed({
  feedRef,
  messages,
  isStreaming,
  liveSegments,
  isEmpty,
  scenario,
  projectName,
  onScroll,
  onMouseDown,
  onSelectPrompt,
  onEdit,
  onResend,
  onRegenerate,
  liveTurnDots,
  turnDotsOf
}: {
  feedRef: React.RefObject<HTMLDivElement | null>
  messages: PrototypeChatMessage[]
  isStreaming: boolean
  liveSegments: LiveSegment[]
  /** 没有历史消息且没有在跑的 run —— 展示快捷起点而不是空列表。 */
  isEmpty: boolean
  scenario?: ProductScenario
  projectName?: string
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  onSelectPrompt: (prompt: string) => void
  onEdit: (text: string) => void
  onResend: (index: number) => void
  onRegenerate: (index: number) => void
  /** 正在跑的那一轮所属的圆点条。 */
  liveTurnDots?: React.ReactNode
  /** 已跑完的 run：圆点条挂在它最后一条回答上。 */
  turnDotsOf?: (messageIndex: number) => React.ReactNode
}) {
  return (
    <div className="pc-feed" ref={feedRef} onScroll={onScroll} onMouseDown={onMouseDown}>
      {isEmpty ? (
        <ChatEmptyState
          scenario={scenario}
          projectName={projectName}
          onSelectPrompt={onSelectPrompt}
        />
      ) : (
        <div className="pc-messages">
          {messages.map((message, index) => (
            <ChatMessageItem
              key={index}
              message={message}
              index={index}
              onEdit={onEdit}
              onResend={onResend}
              onRegenerate={onRegenerate}
              turnDots={turnDotsOf?.(index)}
            />
          ))}

          {/* 实时流式回合（时序 segments） */}
          {isStreaming && (
            <ChatMessageItem
              message={{ role: 'assistant', content: '', timestamp: Date.now() }}
              index={messages.length}
              isStreaming
              segments={liveSegments}
              turnDots={liveTurnDots}
            />
          )}
        </div>
      )}
    </div>
  )
}
