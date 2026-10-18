import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Terminal, Check, Sparkles } from 'lucide-react'
import { ThinkingState } from './ThinkingState'
import { ToolCallsState } from './ToolCallsState'
import type { LiveSegment, LiveTurn } from './useAgentChatStream'

/**
 * 本次 run 已完成的轮次，挂在助手回复内部（对齐 agent-resume-panel）。
 *
 * 主体区只直播当前轮，跑完的轮折叠成这里的一排圆点：上面一行汇总
 * 「N 步 · M 个工具 · 1.2s」，点开某个圆点在该轮的详情抽屉里回看它的
 * 思考与工具。正在跑的那一轮不出圆点 —— 它已经在屏幕上，圆点只会是更旧的副本。
 *
 * 圆点由调用方作为 ChatMessageItem 的 `turnDots` 插槽传入，位置在正文之前。
 */
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
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)

  /** 已完成的轮次，带上它在 `turns` 里的下标 —— 抽屉按下标取轮，过滤不能重编号。 */
  const finished = turns
    .map((turn, index) => ({ turn, index }))
    .filter((entry) => entry.turn.status !== 'running')

  // 一轮跑很久时会走出可见区；始终把最新的圆点带进视野。
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    track.scrollLeft = track.scrollWidth
  }, [finished.length])

  if (finished.length === 0) return null

  const showSteps = openIndex !== null || (userExpanded ?? finished.length <= 3)

  const totalTurns = finished.length
  const totalTools = finished.reduce((sum, entry) => sum + entry.turn.toolCount, 0)
  const totalDurationMs = finished.reduce((sum, entry) => sum + (entry.turn.durationMs || 0), 0)
  const errorCount = finished.filter((entry) => entry.turn.status === 'error').length

  return (
    <div className="pc-turn-dots" role="tablist" aria-label="Agent 轮次">
      <div
        className="pc-turn-process-bar"
        role="button"
        tabIndex={0}
        onClick={() => setUserExpanded((prev) => !(prev ?? finished.length <= 3))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setUserExpanded((prev) => !(prev ?? finished.length <= 3))
        }}
      >
        <div className="pc-turn-process-info">
          <span className="pc-turn-process-icon">
            <Sparkles size={12} />
          </span>
          <span className="pc-turn-process-label">
            {totalTurns} 步
          </span>
          {totalTools > 0 && (
            <span className="pc-turn-process-chip">
              <Terminal size={10} />
              <span>{totalTools} 个工具</span>
            </span>
          )}
          {totalDurationMs > 0 && (
            <span className="pc-turn-process-time">{(totalDurationMs / 1000).toFixed(1)}s</span>
          )}
          {errorCount > 0 && <span className="pc-turn-process-error">{errorCount} 个失败</span>}
        </div>
        <span className="pc-turn-process-hint">
          {showSteps ? '收起步骤 ▴' : '查看步骤 ▾'}
        </span>
      </div>

      {showSteps && (
        <div className="pc-turn-dots-track" ref={trackRef}>
          {finished.map(({ turn, index }) => {
            const isOpen = openIndex === index
            const title = turnTitle(turn)
            return (
              <button
                key={turn.turn}
                type="button"
                role="tab"
                aria-selected={isOpen}
                aria-label={title}
                title={title}
                className={`pc-turn-dot ${kindOf(turn)}${isOpen ? ' is-open' : ''}${
                  turn.status === 'error' ? ' is-error' : ''
                }`}
                onClick={() => (isOpen ? onClose() : onOpen(index))}
              >
                <span className="pc-turn-dot-num">{turn.turn}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 圆点颜色说明这一轮做了什么：调过工具是 `is-tools`，只在脑子里想过是
 * `is-thinking`。两者都有的轮次按「出去做过事」算 —— 这是眼睛在圆点条上
 * 读到的差别，也是 tooltip 与 aria-label 报给读屏用户的信息。
 */
function kindOf(turn: LiveTurn): 'is-tools' | 'is-thinking' {
  return turn.toolCount > 0 ? 'is-tools' : 'is-thinking'
}

function turnTitle(turn: LiveTurn): string {
  const parts = [`第 ${turn.turn} 轮`]
  if (turn.toolCount > 0) parts.push(`${turn.toolCount} 个工具`)
  if (turn.durationMs !== undefined) parts.push(`${(turn.durationMs / 1000).toFixed(1)}s`)
  parts.push(turn.status === 'error' ? '出错' : '已完成')
  parts.push('点击查看思考与工具')
  return parts.join(' · ')
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
