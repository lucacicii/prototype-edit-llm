import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X, Terminal, Check, Sparkles } from 'lucide-react'
import { ThinkingState } from './ThinkingState'
import { ToolCallsState } from './ToolCallsState'
import type { LiveSegment, LiveTurn } from './useAgentChatStream'

/** 已完成/进行中的一轮圆点：跑完的轮折叠回这里，点开可回看该轮全部思考与工具。 */
export function TurnDots({
  turns,
  openIndex,
  onOpen,
  onClose
}: {
  turns: LiveTurn[]
  openIndex: number | null
  onOpen: (index: number) => void
  onClose: () => void
}) {
  if (turns.length === 0) return null

  return (
    <div className="pc-turn-dots" role="tablist" aria-label="Agent 轮次">
      <span className="pc-turn-dots-label">轮次</span>
      <div className="pc-turn-dots-track">
        {turns.map((turn, index) => {
          const isCurrent = turn.status === 'running'
          const isOpen = openIndex === index
          return (
            <button
              key={turn.turn}
              type="button"
              role="tab"
              aria-selected={isOpen}
              className={`pc-turn-dot is-${turn.status}${isOpen ? ' is-open' : ''}`}
              onClick={() => (isOpen ? onClose() : onOpen(index))}
              title={turnTitle(turn)}
            >
              <span className="pc-turn-dot-num">{turn.turn}</span>
              {isCurrent && <span className="pc-turn-dot-ring" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function turnTitle(turn: LiveTurn): string {
  const parts = [`第 ${turn.turn} 轮`]
  if (turn.toolCount > 0) parts.push(`${turn.toolCount} 个工具`)
  if (turn.durationMs !== undefined) parts.push(`${(turn.durationMs / 1000).toFixed(1)}s`)
  parts.push(turn.status === 'running' ? '进行中' : turn.status === 'error' ? '出错' : '已完成')
  return `${parts.join(' · ')}（点击查看思考与工具）`
}

/**
 * 单轮详情浮层（绝对定位在对话面板内，不挤压消息流）。
 *
 * `segments` 由调用方给：正在跑的那一轮给实时切片，已完成的轮给冻结切片。
 */
export function TurnDetailOverlay({
  turn,
  segments,
  isStreaming,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  liveElapsedMs
}: {
  turn: LiveTurn
  segments: LiveSegment[]
  isStreaming: boolean
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  /** run 的实时总时长：正在跑的那一轮没有最终时长，用它减出该轮已耗时。 */
  liveElapsedMs?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const lastIndex = segments.length - 1
  // 跑着的轮用实时值，跑完的轮用它自己的最终时长（`turn_end` 给的）。
  const shownMs =
    turn.durationMs ??
    (turn.status === 'running' && liveElapsedMs !== undefined
      ? Math.max(0, liveElapsedMs - turn.startedAtOffset)
      : undefined)

  return (
    <>
      <div className="pc-turn-overlay-mask" onClick={onClose} />
      <div className="pc-turn-overlay" role="dialog" aria-label={`第 ${turn.turn} 轮详情`}>
        <header className="pc-turn-overlay-header">
          <span className="pc-turn-overlay-title">
            <Sparkles size={12} />
            <span>第 {turn.turn} 轮</span>
            {turn.status === 'running' ? (
              <span className="pc-turn-badge is-running">
                <span className="pc-tool-spinner" />
                进行中
              </span>
            ) : turn.status === 'error' ? (
              <span className="pc-turn-badge is-error">出错</span>
            ) : (
              <span className="pc-turn-badge is-done">
                <Check size={10} />
                已完成
              </span>
            )}
          </span>
          <span className="pc-turn-overlay-meta">
            {turn.toolCount > 0 && (
              <span className="pc-turn-meta-chip">
                <Terminal size={10} />
                {turn.toolCount}
              </span>
            )}
            {shownMs !== undefined && (
              <span className="pc-turn-meta-chip">{(shownMs / 1000).toFixed(1)}s</span>
            )}
            {(turn.promptTokens !== undefined || turn.completionTokens !== undefined) && (
              <span className="pc-turn-meta-chip">
                {((turn.promptTokens ?? 0) + (turn.completionTokens ?? 0)).toLocaleString()} tok
              </span>
            )}
          </span>
          <span className="pc-turn-overlay-actions">
            <button
              type="button"
              className="pc-turn-nav"
              onClick={onPrev}
              disabled={index <= 0}
              title="上一轮"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="pc-turn-nav-pos">
              {index + 1}/{total}
            </span>
            <button
              type="button"
              className="pc-turn-nav"
              onClick={onNext}
              disabled={index >= total - 1}
              title="下一轮"
            >
              <ChevronRight size={13} />
            </button>
            <button type="button" className="pc-turn-nav" onClick={onClose} title="关闭 (Esc)">
              <X size={13} />
            </button>
          </span>
        </header>

        <div className="pc-turn-overlay-body">
          {segments.length === 0 ? (
            <div className="pc-turn-empty">这一轮还没有内容。</div>
          ) : (
            segments.map((segment, segmentIndex) => {
              if (segment.kind === 'reasoning') {
                return (
                  <ThinkingState
                    key={`turn_${turn.turn}_reasoning_${segmentIndex}`}
                    reasoning={segment.text}
                    isStreaming={isStreaming && segmentIndex === lastIndex}
                    defaultExpanded
                  />
                )
              }
              if (segment.kind === 'tools') {
                return (
                  <ToolCallsState
                    key={`turn_${turn.turn}_tools_${segmentIndex}`}
                    tools={segment.tools}
                    defaultExpanded
                  />
                )
              }
              return (
                <div className="pc-turn-text" key={`turn_${turn.turn}_text_${segmentIndex}`}>
                  {segment.text}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
