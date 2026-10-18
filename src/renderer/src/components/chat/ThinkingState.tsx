import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, ChevronRight, Copy, Check } from 'lucide-react'

interface ThinkingStateProps {
  reasoning: string
  isStreaming?: boolean
  defaultExpanded?: boolean
}

const EMPTY_PLACEHOLDER = '正在分析上下文并规划下一步...'

/**
 * 可折叠思考块（对齐 agent-resume-panel 的扁平样式）。
 *
 * 容器无边框、无背景，只有一行 header：折叠时它是一个单行窗口，最新一行
 * 从底部滑入、旧行从顶部滑出，像滚轮一样翻动；展开后落成带左脊线的正文，
 * 并在 toolbar 上给出「N 行推理」与一键复制。
 */
export function ThinkingState({
  reasoning,
  isStreaming = false,
  defaultExpanded = false
}: ThinkingStateProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 为 true 时跟随最新思考；用户上滚后停止跟随。 */
  const stickToBottom = useRef(true)

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!reasoning) return
    try {
      await navigator.clipboard.writeText(reasoning)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  const scrollToBottom = useCallback((force = false) => {
    const node = contentRef.current
    if (!node) return
    if (!force && !stickToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [])

  useLayoutEffect(() => {
    scrollToBottom()
  }, [reasoning, expanded, scrollToBottom])

  useLayoutEffect(() => {
    if (!expanded) return
    stickToBottom.current = true
    scrollToBottom(true)
  }, [expanded, scrollToBottom])

  useEffect(() => {
    if (isStreaming) {
      const start = Date.now()
      timerRef.current = setInterval(() => {
        setSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)))
      }, 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isStreaming])

  const lines = useMemo(
    () =>
      reasoning
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [reasoning]
  )
  const currentLine = lines[lines.length - 1] ?? ''
  const previousLine = lines.length > 1 ? lines[lines.length - 2] : ''
  /**
   * 每来一个新行翻滚一次，而不是每个 token 翻一次：key 只在行数增长时变化，
   * 所以正在写的行就地更新，只有下一行到来时才把上一行滚出去。
   */
  const lineIndex = lines.length
  const firstLine = lines[0] ?? ''
  const lineCount = lines.length

  if (!reasoning && !isStreaming) return null

  return (
    <div className="pc-thinking">
      <button
        type="button"
        className="pc-thinking-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={isStreaming ? '思考中' : '思考过程'}
      >
        <div className="pc-thinking-header-left">
          <span className="pc-thinking-sparkle">
            <Sparkles size={12} />
          </span>
          <span className="pc-thinking-title">{isStreaming ? '思考中...' : '思考过程'}</span>
          {seconds > 0 && <span className="pc-thinking-time">{seconds}s</span>}
          {isStreaming && <span className="pc-thinking-pulse" aria-hidden="true" />}

          {expanded ? null : isStreaming ? (
            <span className="pc-thinking-ticker">
              {previousLine ? (
                <span className="pc-thinking-roll" key={lineIndex}>
                  <span className="pc-thinking-row">{previousLine}</span>
                  <span className="pc-thinking-row is-current">
                    {currentLine || EMPTY_PLACEHOLDER}
                  </span>
                </span>
              ) : (
                <span className="pc-thinking-row is-current">{currentLine || EMPTY_PLACEHOLDER}</span>
              )}
            </span>
          ) : (
            <span className="pc-thinking-excerpt">
              {lineCount > 0 ? `${lineCount} 行 · ${firstLine}` : EMPTY_PLACEHOLDER}
            </span>
          )}
        </div>
        <span className={`pc-chevron${expanded ? ' is-open' : ''}`}>
          <ChevronRight size={12} />
        </span>
      </button>

      {expanded && (
        <div className="pc-thinking-body">
          <div className="pc-thinking-toolbar">
            <span className="pc-thinking-toolbar-label">
              {lineCount} 行推理
            </span>
            <button
              type="button"
              className="pc-thinking-copy-btn"
              onClick={handleCopy}
              title="复制思考过程"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>
          <div
            className="pc-thinking-content"
            ref={contentRef}
            onScroll={(event) => {
              const node = event.currentTarget
              if (node.clientHeight <= 0) return
              stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
            }}
          >
            {reasoning || EMPTY_PLACEHOLDER}
            {isStreaming && <span className="pc-caret" />}
          </div>
        </div>
      )}
    </div>
  )
}
