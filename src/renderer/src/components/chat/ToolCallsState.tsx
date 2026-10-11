import { useState } from 'react'
import { Terminal, ChevronRight } from 'lucide-react'
import { ToolChip } from './ToolChip'
import type { ActiveToolInfo } from './useAgentChatStream'

/** 一组工具调用的折叠容器：`Used N tools (...)` 汇总行 → 展开 ToolChip 列表。 */
export function ToolCallsState({
  tools,
  defaultExpanded = false
}: {
  tools: ActiveToolInfo[]
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!tools || tools.length === 0) return null

  const runningTool = tools.find((t) => t.isRunning)
  const errorCount = tools.filter((t) => t.isError).length
  const toolNames = Array.from(new Set(tools.map((t) => t.name))).join(', ')

  let title = `使用 ${tools.length} 个工具`
  if (toolNames) title += `（${toolNames}）`
  if (runningTool) title = `正在执行 ${runningTool.name}...`

  return (
    <div className={`pc-tool-group${expanded ? ' is-expanded' : ''}${runningTool ? ' is-running' : ''}`}>
      <button
        type="button"
        className="pc-tool-group-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="pc-tool-group-header-left">
          <span className="pc-tool-group-icon">
            <Terminal size={12} />
          </span>
          <span className="pc-tool-group-title">{title}</span>
          <span className="pc-tool-group-count">{tools.length}</span>
          {runningTool && <span className="pc-tool-group-spinner" aria-hidden="true" />}
          {errorCount > 0 && !runningTool && (
            <span className="pc-tool-group-error">{errorCount} 个失败</span>
          )}
        </div>
        <span className={`pc-chevron${expanded ? ' is-open' : ''}`}>
          <ChevronRight size={12} />
        </span>
      </button>

      {expanded && (
        <div className="pc-tool-group-body">
          {tools.map((tool) => (
            <ToolChip key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
