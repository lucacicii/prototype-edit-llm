import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { ArrowUp, Bot, ChevronRight, CornerDownLeft, FileText, Paperclip, Sparkles, X } from 'lucide-react'
import { getEngineIcon, getProviderIcon } from './providerIcon'
import { formatCompactTokens, formatDuration } from './chatFormat'
import type { ChatRunMetrics } from './useAgentChatStream'
import type { AcpControls } from './useAcpControls'
import type { AgentModelView } from '../../stores/useAgentModelConfigStore'

export interface PendingAttachment {
  id: string
  kind: 'image' | 'text'
  name: string
  mimeType: string
  bytes: number
  previewUrl?: string
  data?: string
  text?: string
  truncated?: boolean
}

/**
 * 底部输入区：停靠的问题卡 + 队列提示 + composer 盒子（附件 / 输入框 /
 * `#` 补全 / 指标条 / 工具栏）。
 *
 * 结构与 agent-resume-panel 的 composer 一致：浮起的圆角盒子、贴底的指标条、
 * 胶囊 chip 与右侧圆形发送钮。窄面板（最窄 320px）下 chip 换行、标签截断。
 */
export function ChatComposer({
  docked,
  queuedCount,
  promptInput,
  pendingAttachments,
  fileSuggestOpen,
  fileSuggestions,
  fileSuggestActive,
  textareaRef,
  fileInputRef,
  runElsewhere,
  isStreaming,
  elapsedMs,
  groupedModels,
  selectionId,
  selectedModel,
  thinkingLevel,
  thinkingLevels,
  acp,
  slashSuggestOpen,
  slashSuggestions,
  slashSuggestActive,
  metrics,
  streamingMetrics,
  contextTokensWithDraft,
  contextLimit,
  contextPercent,
  cacheCount,
  cachePct,
  sessionTotalTokens,
  onPromptChange,
  onCursorChange,
  onPaste,
  onDrop,
  onKeyDown,
  onAcceptFileSuggestion,
  onRemoveAttachment,
  onFileInputChange,
  onSendClick,
  onCancel,
  onSelectModel,
  onSelectThinkingLevel,
  onAcceptSlashCommand
}: {
  /** 停靠在输入框上方的卡片（问题卡）。 */
  docked?: React.ReactNode
  queuedCount: number
  promptInput: string
  pendingAttachments: PendingAttachment[]
  fileSuggestOpen: boolean
  fileSuggestions: string[]
  fileSuggestActive: number
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  runElsewhere: boolean
  isStreaming: boolean
  elapsedMs: number
  groupedModels: { provider: string; items: (AgentModelView & { label: string })[] }[]
  selectionId?: string
  selectedModel?: AgentModelView
  thinkingLevel: string
  thinkingLevels: string[]
  /** ACP 引擎的菜单与状态（thunder 下只用到 `engine` / `engineMenuItems`）。 */
  acp: AcpControls
  slashSuggestOpen: boolean
  slashSuggestions: { name: string; description?: string; inputHint?: string }[]
  slashSuggestActive: number
  metrics: ChatRunMetrics | null
  streamingMetrics: { tokensCount: number; tps: number; reasoningCount?: number }
  contextTokensWithDraft: number
  contextLimit: number
  contextPercent: number | null
  cacheCount: number
  cachePct: string | null
  sessionTotalTokens: number
  onPromptChange: (value: string, cursor: number) => void
  onCursorChange: (cursor: number) => void
  onPaste: (event: React.ClipboardEvent) => void
  onDrop: (event: React.DragEvent) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onAcceptFileSuggestion: (path: string) => void
  onRemoveAttachment: (id: string) => void
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSendClick: () => void
  onCancel: () => void
  onSelectModel: (selectionId: string) => void
  onSelectThinkingLevel: (level: string) => void
  onAcceptSlashCommand: (name: string) => void
}) {
  const modelMenuItems: MenuProps['items'] = groupedModels.flatMap((group) => [
    {
      type: 'group' as const,
      label: (
        <span className="pc-menu-group">
          {getProviderIcon(group.provider, 13)}
          <span>{group.provider}</span>
        </span>
      ),
      children: group.items.map((item) => ({
        key: item.selectionId,
        label: (
          <span className="pc-menu-item">
            <span className={item.selectionId === selectionId ? 'is-active' : ''}>
              {item.name || item.id}
            </span>
            {!item.available && <span className="pc-menu-note">不可用</span>}
          </span>
        ),
        disabled: !item.available,
        onClick: () => onSelectModel(item.selectionId)
      }))
    }
  ])

  const thinkingMenuItems: MenuProps['items'] = thinkingLevels.map((level) => ({
    key: level,
    label: <span className={level === thinkingLevel ? 'is-active' : ''}>{level.toUpperCase()}</span>,
    onClick: () => onSelectThinkingLevel(level)
  }))

  const hasInput = Boolean(promptInput.trim()) || pendingAttachments.length > 0
  const isAcp = acp.engine !== 'thunder'

  return (
    <div className="pc-composer-zone">
      {docked}

      {isStreaming && queuedCount > 0 && (
        <div className="pc-composer-queued">
          <strong>📥 已排队 {queuedCount} 条</strong>
          <span>Enter 插话 · ⌥Enter 追问</span>
        </div>
      )}

      <div
        className={`pc-composer-box${isStreaming ? ' is-active' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        {pendingAttachments.length > 0 && (
          <div className="pc-attachments">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.id} className="pc-attachment-chip">
                {attachment.kind === 'image' ? (
                  <img src={attachment.previewUrl} alt={attachment.name} />
                ) : (
                  <FileText size={12} />
                )}
                <span className="pc-attachment-name" title={attachment.name}>
                  {attachment.name}
                </span>
                <button
                  type="button"
                  className="pc-attachment-remove"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  title="移除"
                  aria-label={`移除 ${attachment.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="pc-composer-input-area">
          <textarea
            ref={textareaRef}
            className="pc-composer-textarea"
            value={promptInput}
            rows={1}
            onChange={(event) => {
              onPromptChange(event.target.value, event.currentTarget.selectionStart || event.target.value.length)
            }}
            onSelect={(event) => onCursorChange(event.currentTarget.selectionStart || 0)}
            onClick={(event) => onCursorChange(event.currentTarget.selectionStart || 0)}
            onKeyUp={(event) => onCursorChange(event.currentTarget.selectionStart || 0)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={
              runElsewhere
                ? '其他项目的 Agent 正在运行，请稍候...'
                : isStreaming
                  ? '运行中：Enter 插话引导（⌥Enter 待本轮结束后追问）...'
                  : isAcp
                    ? '描述你的产品需求（输入 / 调用命令，# 引用项目文件）...'
                    : '描述你的产品需求（输入 # 可引用项目文件）...'
            }
          />
        </div>

        {slashSuggestOpen && (
          <ul className="pc-file-suggest" role="listbox" aria-label="ACP 斜杠命令">
            {slashSuggestions.map((cmd, index) => (
              <li
                key={cmd.name}
                role="option"
                aria-selected={index === slashSuggestActive}
                className={index === slashSuggestActive ? 'is-active' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAcceptSlashCommand(cmd.name)}
              >
                <Bot size={12} className="pc-command-suggest-icon" />
                <span className="pc-file-suggest-path">/{cmd.name}</span>
                {cmd.description && <span className="pc-command-suggest-desc">{cmd.description}</span>}
                {cmd.inputHint && <span className="pc-command-suggest-hint">{cmd.inputHint}</span>}
                <span className="pc-file-suggest-kbd">Tab</span>
              </li>
            ))}
          </ul>
        )}

        {fileSuggestOpen && (
          <ul className="pc-file-suggest" role="listbox" aria-label="项目文件">
            {fileSuggestions.map((filePath, index) => (
              <li
                key={filePath}
                role="option"
                aria-selected={index === fileSuggestActive}
                className={index === fileSuggestActive ? 'is-active' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAcceptFileSuggestion(filePath)}
              >
                <FileText size={12} />
                <span className="pc-file-suggest-path">{filePath}</span>
                <span className="pc-file-suggest-kbd">Tab</span>
              </li>
            ))}
          </ul>
        )}

        {/* 指标条 */}
        <div className="pc-metrics">
          <div className="pc-metrics-group">
            {isStreaming ? (
              <>
                <span className="pc-metrics-pulse" />
                <span className="pc-metrics-speed">
                  ⚡ {streamingMetrics.tps > 0 ? streamingMetrics.tps.toFixed(1) : '0.0'} tok/s
                </span>
                <span className="pc-metrics-divider" />
                <span
                  title={
                    isAcp
                      ? 'ACP 下本轮 token 由流出的正文与思考估算，速率不含工具执行时间'
                      : '本轮流式生成量'
                  }
                >
                  {streamingMetrics.tokensCount} tokens
                  {streamingMetrics.reasoningCount
                    ? `（含思考 ${streamingMetrics.reasoningCount}）`
                    : ''}
                </span>
              </>
            ) : metrics && (metrics.totalTokens || metrics.tps) ? (
              <>
                {metrics.tps && metrics.tps > 0 ? (
                  <>
                    <span className="pc-metrics-speed">⚡ {metrics.tps.toFixed(1)} tok/s</span>
                    <span className="pc-metrics-divider" />
                  </>
                ) : null}
                <span title={isAcp ? 'ACP 下本轮 token 由流出的正文与思考估算，速率不含工具执行时间' : undefined}>
                  本轮 {metrics.totalTokens?.toLocaleString() ?? '—'}
                  {metrics.promptTokens !== undefined && metrics.completionTokens !== undefined ? (
                    <>
                      {' '}
                      (In {metrics.promptTokens.toLocaleString()} · Out{' '}
                      {metrics.completionTokens.toLocaleString()}
                      {metrics.reasoningTokens
                        ? ` · 思考 ${metrics.reasoningTokens.toLocaleString()}`
                        : ''}
                      )
                    </>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="pc-metrics-speed">⚡ 就绪</span>
            )}

            {/* Prompt Cache 只有 thunder 报；ACP 协议不回，宁可不显示也不显示 0。 */}
            {metrics && !isAcp ? (
              <>
                <span className="pc-metrics-divider" />
                <span
                  className={`pc-metrics-cache${cacheCount === 0 ? ' is-zero' : ''}`}
                  title={
                    cacheCount > 0
                      ? `Prompt Cache 命中 ${cacheCount.toLocaleString()} tokens`
                      : 'Prompt Cache 未命中'
                  }
                >
                  Cache {cacheCount.toLocaleString()}
                  {cachePct ? ` (${cachePct}%)` : ''}
                </span>
              </>
            ) : null}
          </div>

          <div className="pc-metrics-group">
            <span
              title={`当前上下文占用 / 模型窗口：${contextTokensWithDraft.toLocaleString()}${
                contextLimit ? ` / ${contextLimit.toLocaleString()}` : ''
              }`}
            >
              上下文{' '}
              <span className="pc-metrics-value">
                {contextTokensWithDraft.toLocaleString()}
                {contextLimit ? ` / ${formatCompactTokens(contextLimit)}` : ''}
              </span>
              {contextPercent !== null && (
                <span className={`pc-metrics-percent${contextPercent >= 80 ? ' is-warning' : ''}`}>
                  {' '}
                  ({contextPercent}%)
                </span>
              )}
            </span>
            <span className="pc-metrics-divider" />
            <span
              title={
                isAcp
                  ? '当前会话累计消耗：ACP 协议不回 token 用量，按流出的正文与思考估算'
                  : '当前会话全部轮次累计消耗的总 Token 数'
              }
            >
              总消耗 <span className="pc-metrics-value">{sessionTotalTokens.toLocaleString()}</span>
            </span>
            {metrics?.durationMs ? (
              <>
                <span className="pc-metrics-divider" />
                <span title="本轮总耗时">
                  总耗时 <span className="pc-metrics-value">{formatDuration(metrics.durationMs)}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* 工具栏 */}
        <div className="pc-composer-toolbar">
          <div className="pc-toolbar-left">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.vue,.html,.css"
              onChange={onFileInputChange}
            />
            <button
              type="button"
              className="pc-composer-chip is-button"
              disabled={isStreaming}
              onClick={() => fileInputRef.current?.click()}
              title="添加图片或文本附件"
              aria-label="添加附件"
            >
              <Paperclip size={12} />
            </button>

            <Dropdown menu={{ items: acp.engineMenuItems }} trigger={['click']} disabled={isStreaming}>
              <button type="button" className="pc-composer-chip is-button" title="切换 Agent 引擎">
                {getEngineIcon(acp.engine, 11)}
                <span>{acp.engineLabel}</span>
              </button>
            </Dropdown>

            {isAcp ? (
              <>
                {acp.modelMenuItems && (
                  <Dropdown menu={{ items: acp.modelMenuItems }} trigger={['click']} disabled={isStreaming}>
                    <button type="button" className="pc-composer-chip is-button" title="ACP 模型">
                      <span className="pc-chip-label">{acp.modelLabel || '选择模型'}</span>
                    </button>
                  </Dropdown>
                )}

                {acp.modeMenuItems && (
                  <Dropdown menu={{ items: acp.modeMenuItems }} trigger={['click']} disabled={isStreaming}>
                    <button type="button" className="pc-composer-chip is-button" title="ACP 模式">
                      <span className="pc-chip-label">{acp.modeLabel || '默认模式'}</span>
                    </button>
                  </Dropdown>
                )}

                {acp.thoughtMenuItems && (
                  <Dropdown menu={{ items: acp.thoughtMenuItems }} trigger={['click']} disabled={isStreaming}>
                    <button type="button" className="pc-composer-chip is-button" title="ACP 思考档位">
                      <Sparkles size={11} />
                      <span>{acp.thoughtLabel || '思考档位'}</span>
                    </button>
                  </Dropdown>
                )}

                <button
                  type="button"
                  className={`pc-composer-chip is-button${acp.permissionPolicy === 'allowAll' ? ' is-allow' : ' is-ask'}`}
                  disabled={isStreaming}
                  title={
                    acp.permissionPolicy === 'allowAll'
                      ? '当前：工作区操作自动批准（点击切换为手动审批）'
                      : '当前：每次操作手动审批（点击切换为自动批准）'
                  }
                  onClick={acp.togglePermissionPolicy}
                >
                  <span>{acp.permissionPolicy === 'allowAll' ? '⚡ 自动批准' : '✋ 手动审批'}</span>
                </button>
              </>
            ) : (
              <>
                <Dropdown menu={{ items: modelMenuItems }} trigger={['click']} disabled={isStreaming}>
                  <button type="button" className="pc-composer-chip is-button" title="选择模型">
                    {selectedModel ? getProviderIcon(selectedModel.provider, 11) : <Sparkles size={11} />}
                    <span className="pc-chip-label">
                      {selectedModel?.name || selectionId || '选择模型'}
                    </span>
                  </button>
                </Dropdown>

                <Dropdown menu={{ items: thinkingMenuItems }} trigger={['click']} disabled={isStreaming}>
                  <button type="button" className="pc-composer-chip is-button" title="思考档位">
                    <Sparkles size={11} />
                    <span>{thinkingLevel ? thinkingLevel.toUpperCase() : 'OFF'}</span>
                  </button>
                </Dropdown>
              </>
            )}
          </div>

          {isStreaming ? (
            <button
              type="button"
              className="pc-send-btn is-stop"
              onClick={onCancel}
              title="停止任务"
              aria-label="停止任务"
            >
              <span className="pc-stop-icon" />
            </button>
          ) : (
            <button
              type="button"
              className="pc-send-btn"
              onClick={onSendClick}
              disabled={runElsewhere || !hasInput}
              title="发送 (Enter)"
              aria-label="发送"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 运行提示行 */}
      {runElsewhere && (
        <div className="pc-run-hint">
          <span className="pc-run-hint-dot" />
          <span>其他项目的 Agent 正在运行，完成后才能在此发送</span>
        </div>
      )}
      {isStreaming && (
        <div className="pc-run-hint is-mono">
          <span className="pc-run-hint-dot" />
          <span>Agent 运行中 {(elapsedMs / 1000).toFixed(1)}s</span>
          <CornerDownLeft size={10} />
          <span>Enter 插话</span>
          <ChevronRight size={9} />
          <span>⌥Enter 追问</span>
        </div>
      )}
    </div>
  )
}
