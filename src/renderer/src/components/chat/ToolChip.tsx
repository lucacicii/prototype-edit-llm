import React, { useState } from 'react'
import { Terminal, FileCode, Search, GitBranch, Bot, Check, ChevronRight } from 'lucide-react'
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

function truncateText(text: string, max = 4000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...（已截断，共 ${text.length} 字符）`
}

/** 单个工具调用 chip：可展开查看入参 / 输出，一键复制。 */
export function ToolChip({ tool }: { tool: ActiveToolInfo }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

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

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const textToCopy = formattedResult || formattedArgs
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch {
        // ignore
      }
    }
  }

  return (
    <div
      className={`pc-tool-chip${expanded ? ' is-expanded' : ''}${tool.isRunning ? ' is-running' : ''}${
        tool.isError ? ' is-error' : ''
      }`}
    >
      <button type="button" className="pc-tool-chip-header" onClick={() => setExpanded((prev) => !prev)}>
        <div className="pc-tool-chip-header-left">
          <span className="pc-tool-icon">{resolveToolIcon(tool.name)}</span>
          <span className="pc-tool-name">{tool.name}</span>
          {tool.isRunning && (
            <span className="pc-tool-status is-running">
              <span className="pc-tool-spinner" />
              <span>执行中</span>
            </span>
          )}
          {!tool.isRunning && !tool.isError && (
            <span className="pc-tool-status is-success">
              <Check size={10} />
              <span>完成</span>
            </span>
          )}
          {tool.isError && (
            <span className="pc-tool-status is-error">
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
          {formattedArgs && formattedArgs !== '{}' && (
            <div className="pc-tool-section">
              <div className="pc-tool-section-label">入参</div>
              <pre className="pc-tool-code">{truncateText(formattedArgs)}</pre>
            </div>
          )}
          {formattedResult && (
            <div className="pc-tool-section">
              <div className="pc-tool-section-header">
                <span className="pc-tool-section-label">输出</span>
                <button type="button" className="pc-tool-copy" onClick={handleCopy} title="复制输出">
                  {copied ? <Check size={10} /> : null}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className="pc-tool-code">{truncateText(formattedResult)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
