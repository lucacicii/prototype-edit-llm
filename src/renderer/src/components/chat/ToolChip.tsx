import { useState } from 'react'
import { Terminal, FileCode, Search, GitBranch, Bot, Check, ChevronRight, Copy } from 'lucide-react'
import type { ActiveToolInfo } from './useAgentChatStream'

function resolveToolIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('cmd') || lower.includes('exec')) {
    return <Terminal size={12} />
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('write')) {
    return <FileCode size={12} />
  }
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) {
    return <Search size={12} />
  }
  if (lower.includes('git')) {
    return <GitBranch size={12} />
  }
  return <Bot size={12} />
}

export interface ParsedToolSummary {
  verb: string
  target: string
  fullTarget?: string
  badge?: string
  kind: 'read' | 'edit' | 'run' | 'search' | 'mcp' | 'other'
  command?: string
  diffContent?: string
}

/**
 * 把一次工具调用解析成「动词 + 目标」，让工具行读起来像一句话
 * （`Read foo.ts`、`Edit 3 files (+12 -4)`、`Run npm test`）。
 *
 * 移植自 agent-resume-panel 的 parseToolCall：参数名在不同工具集里并不统一，
 * 所以按语义分六类匹配，匹配不上就退回工具原名，绝不猜。
 */
export function parseToolCall(name: string, rawArgs: unknown): ParsedToolSummary {
  let args: Record<string, unknown> = {}
  if (typeof rawArgs === 'object' && rawArgs !== null) {
    args = rawArgs as Record<string, unknown>
  } else if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs)
    } catch {
      args = { raw: rawArgs }
    }
  }

  const lower = name.toLowerCase()

  // 1. 读取文件
  if (lower.includes('read') || lower.includes('view') || lower === 'cat' || lower === 'fetch') {
    const rawPath = String(
      args.AbsolutePath || args.TargetFile || args.path || args.file_path || args.target || args.file || ''
    )
    const base = rawPath ? rawPath.split('/').filter(Boolean).pop() || rawPath : ''
    let lineRange = ''
    if (args.StartLine !== undefined && args.EndLine !== undefined) {
      lineRange = `L${args.StartLine}-${args.EndLine}`
    } else if (args.StartLine !== undefined) {
      lineRange = `L${args.StartLine}+`
    }
    return {
      verb: 'Read',
      target: base || name,
      fullTarget: rawPath || undefined,
      badge: lineRange || undefined,
      kind: 'read'
    }
  }

  // 2. 编辑 / 写入 / 新建
  if (lower.includes('replace') || lower.includes('write') || lower.includes('edit') || lower.includes('patch')) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file_path || '')
    const base = rawPath ? rawPath.split('/').filter(Boolean).pop() || rawPath : ''
    const isCreate = lower.includes('write') && args.Overwrite !== true
    let badge = ''
    let diffContent = ''
    if (typeof args.diff === 'string' || typeof args.Diff === 'string' || typeof args.patch === 'string') {
      diffContent = String(args.diff || args.Diff || args.patch)
      const added = (diffContent.match(/^\+[^+]/gm) || []).length
      const removed = (diffContent.match(/^-[^-]/gm) || []).length
      if (added > 0 || removed > 0) badge = `+${added} -${removed}`
    } else if (typeof args.new_str === 'string' && typeof args.old_str === 'string') {
      const added = args.new_str.split('\n').length
      const removed = args.old_str.split('\n').length
      badge = `+${added} -${removed}`
      diffContent = args.new_str
    }
    return {
      verb: isCreate ? 'Create' : 'Edit',
      target: base || name,
      fullTarget: rawPath || undefined,
      badge: badge || undefined,
      kind: 'edit',
      diffContent: diffContent || undefined
    }
  }

  // 3. 命令执行
  if (lower.includes('bash') || lower.includes('command') || lower.includes('shell') || lower.includes('exec')) {
    const cmd = String(args.CommandLine || args.command || args.cmd || args.raw || '').trim()
    return {
      verb: 'Run',
      target: cmd ? (cmd.length > 42 ? `${cmd.slice(0, 39)}...` : cmd) : name,
      fullTarget: cmd || undefined,
      command: cmd || undefined,
      kind: 'run'
    }
  }

  // 4. 搜索
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) {
    const query = String(args.query || args.pattern || args.search || '').trim()
    const scope = String(args.path || args.dir || args.target || '').trim()
    const badge = scope ? scope.split('/').filter(Boolean).pop() : undefined
    return {
      verb: 'Search',
      target: query ? (query.length > 35 ? `"${query.slice(0, 32)}..."` : `"${query}"`) : name,
      fullTarget: query || undefined,
      badge,
      kind: 'search'
    }
  }

  // 5. MCP 工具
  if (lower.includes('mcp') && (args.ToolName || args.name)) {
    const toolName = String(args.ToolName || args.name)
    const serverName = args.ServerName ? `${args.ServerName}:` : ''
    return {
      verb: 'MCP',
      target: `${serverName}${toolName}`,
      fullTarget: JSON.stringify(args),
      kind: 'mcp'
    }
  }

  return { verb: 'Call', target: name, kind: 'other' }
}

function truncateText(text: string, max = 4000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...（已截断，共 ${text.length} 字符）`
}

/** 单个工具调用 chip：可展开查看入参 / 输出，一键复制。 */
export function ToolChip({ tool }: { tool: ActiveToolInfo }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const parsed = parseToolCall(tool.name, tool.arguments)

  const formattedArgs =
    typeof tool.arguments === 'string'
      ? tool.arguments
      : JSON.stringify(tool.arguments, null, 2) || '{}'

  const formattedResult =
    tool.result !== undefined
      ? typeof tool.result === 'string'
        ? tool.result
        : JSON.stringify(tool.result, null, 2)
      : ''

  const handleCopy = async (event: React.MouseEvent, text: string) => {
    event.stopPropagation()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <div
      className={`pc-tool-chip${expanded ? ' is-expanded' : ''}${tool.isRunning ? ' is-running' : ''}${
        tool.isError ? ' is-error' : ''
      }`}
    >
      <button
        type="button"
        className="pc-tool-chip-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="pc-tool-chip-header-left">
          <span className="pc-tool-icon">{resolveToolIcon(tool.name)}</span>
          <span className="pc-tool-verb">{parsed.verb}</span>
          <span className="pc-tool-target" title={parsed.fullTarget || parsed.target}>
            {parsed.target}
          </span>
          {parsed.badge && (
            <span className="pc-tool-meta-badge" title={parsed.badge}>
              {parsed.badge}
            </span>
          )}
          <span className="pc-tool-name">{tool.name}</span>
          {tool.isRunning && (
            <span className="pc-tool-status running">
              <span className="pc-tool-spinner" />
              <span>执行中</span>
            </span>
          )}
          {!tool.isRunning && !tool.isError && (
            <span className="pc-tool-status success">
              <Check size={10} />
              <span>完成</span>
            </span>
          )}
          {tool.isError && (
            <span className="pc-tool-status error">
              <span>失败</span>
            </span>
          )}
        </div>
        <span className={`pc-chevron${expanded ? ' is-open' : ''}`}>
          <ChevronRight size={12} />
        </span>
      </button>

      {expanded && (
        <div className="pc-tool-chip-details">
          {parsed.kind === 'run' && parsed.command && (
            <div className="pc-tool-inline-preview">
              <div className="pc-tool-terminal-header">
                <div className="pc-tool-terminal-prompt-box">
                  <span className="pc-tool-terminal-prompt">$</span>
                  <span className="pc-tool-terminal-cmd" title={parsed.command}>
                    {parsed.command}
                  </span>
                </div>
                <button
                  type="button"
                  className="pc-tool-copy-btn"
                  onClick={(event) => void handleCopy(event, parsed.command || '')}
                  title="复制命令"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              {formattedResult && (
                <div className="pc-tool-terminal-body">
                  <pre className="pc-tool-code-preview">{truncateText(formattedResult)}</pre>
                </div>
              )}
            </div>
          )}

          {parsed.kind === 'edit' && (parsed.diffContent || formattedResult) && (
            <div className="pc-tool-inline-preview">
              <div className="pc-tool-section-header" style={{ padding: '4px 8px' }}>
                <span className="pc-tool-section-label">
                  {parsed.fullTarget || parsed.target} {parsed.badge ? `(${parsed.badge})` : ''}
                </span>
                <button
                  type="button"
                  className="pc-tool-copy-btn"
                  onClick={(event) => void handleCopy(event, parsed.diffContent || formattedResult)}
                  title="复制改动"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className="pc-tool-code-preview">{truncateText(parsed.diffContent || formattedResult)}</pre>
            </div>
          )}

          {parsed.kind !== 'run' && parsed.kind !== 'edit' && formattedArgs && formattedArgs !== '{}' && (
            <div className="pc-tool-section">
              <div className="pc-tool-section-label">入参</div>
              <pre className="pc-tool-code-preview">{truncateText(formattedArgs)}</pre>
            </div>
          )}

          {parsed.kind !== 'run' && parsed.kind !== 'edit' && formattedResult && (
            <div className="pc-tool-section">
              <div className="pc-tool-section-header">
                <span className="pc-tool-section-label">输出</span>
                <button
                  type="button"
                  className="pc-tool-copy-btn"
                  onClick={(event) => void handleCopy(event, formattedResult)}
                  title="复制输出"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className="pc-tool-code-preview">{truncateText(formattedResult)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
