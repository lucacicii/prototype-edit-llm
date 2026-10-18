import { useState } from 'react'
import { Terminal, ChevronRight } from 'lucide-react'
import { ToolChip, parseToolCall } from './ToolChip'
import type { ActiveToolInfo } from './useAgentChatStream'

/**
 * 一组工具调用的折叠容器（对齐 agent-resume-panel）。
 *
 * 无边框、无背景的扁平行；标题由 parseToolCall 汇总成一句话：
 * 单个工具读作 `Read foo.ts`，多个工具读作
 * `5 actions executed (Read 2 files, Edit 1 file)`，运行中读作
 * `Running: Run npm test...`。
 */
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

  let title = ''
  if (runningTool) {
    const parsed = parseToolCall(runningTool.name, runningTool.arguments)
    title = `正在执行：${parsed.verb} ${parsed.target}...`
  } else if (tools.length === 1) {
    const parsed = parseToolCall(tools[0].name, tools[0].arguments)
    title = `${parsed.verb} ${parsed.target}`
  } else {
    let readCount = 0
    let editCount = 0
    let runCount = 0
    let searchCount = 0
    for (const tool of tools) {
      const parsed = parseToolCall(tool.name, tool.arguments)
      if (parsed.kind === 'read') readCount++
      else if (parsed.kind === 'edit') editCount++
      else if (parsed.kind === 'run') runCount++
      else if (parsed.kind === 'search') searchCount++
    }
    const breakdown: string[] = []
    if (readCount > 0) breakdown.push(`Read ${readCount} ${readCount === 1 ? 'file' : 'files'}`)
    if (editCount > 0) breakdown.push(`Edit ${editCount} ${editCount === 1 ? 'file' : 'files'}`)
    if (runCount > 0) breakdown.push(`Run ${runCount} ${runCount === 1 ? 'command' : 'commands'}`)
    if (searchCount > 0) breakdown.push(`Search ${searchCount}`)
    const details = breakdown.length > 0 ? `（${breakdown.slice(0, 2).join('，')}）` : ''
    title = `执行了 ${tools.length} 个操作${details}`
  }

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
          <span className="pc-tool-group-title" title={title}>
            {title}
          </span>
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
          <div className="pc-tool-group-list">
            {tools.map((tool) => (
              <ToolChip key={tool.toolCallId} tool={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
