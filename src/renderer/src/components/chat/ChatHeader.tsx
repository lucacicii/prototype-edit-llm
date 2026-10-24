import { useEffect, useRef, useState } from 'react'
import {
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  Sparkles,
  Search,
  ChevronUp,
  ChevronDown,
  X
} from 'lucide-react'
import type { ThunderAgentStatus, ThunderAgentPhase } from './useAgentChatStream'
import type { AcpControls } from './useAcpControls'

/** 值得占一个徽标的阶段，以及每个阶段对应的色调。 */
const TONES: Partial<Record<ThunderAgentPhase, 'running' | 'awaiting' | 'error'>> = {
  thinking: 'running',
  streaming: 'running',
  tool: 'running',
  compacting: 'running',
  awaiting_user: 'awaiting',
  paused: 'awaiting',
  error: 'error'
}

const LABELS: Partial<Record<ThunderAgentPhase, string>> = {
  thinking: '思考中',
  streaming: '生成中',
  tool: '运行工具',
  compacting: '压缩上下文',
  awaiting_user: '等待回答',
  paused: '已暂停',
  error: '出错'
}

/** 消息流内搜索的受控面板；由 ChatPanel 持有高亮状态，这里只管输入与导航。 */
export interface ChatSearchControls {
  query: string
  totalMatches: number
  currentMatchIndex: number
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * 对话面板顶部：折叠按钮、标题、会话名、当前模型、运行阶段、消息内搜索。
 *
 * 阶段来自 `agent_status` 事件 —— 今天只有 ACP 引擎会发它（thunder 内核重写时
 * 删掉了产生它的插件），而不是靠观察
 * 消息流 —— 停在问题上的 run 和正在思考的 run 从外面看完全一样，只有
 * thunder 知道是哪一个。空闲与已完成不显示徽标：那两种状态消息流已经说清楚了。
 *
 * 会话名只在 thunder 引擎下显示（ACP 会话没有标题存储）：点击行内改名，
 * 手动名会被 daemon 锁定、不再被自动改名覆盖；✨ 用 utility 模型重新起名。
 */
export function ChatHeader({
  modelLabel,
  providerIcon,
  configured,
  agentStatus,
  acp,
  mode,
  onToggleMode,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  conversationTitle,
  titleBusy,
  onRenameTitle,
  onAiTitle,
  search
}: {
  modelLabel: string
  providerIcon?: React.ReactNode
  configured: boolean
  agentStatus?: ThunderAgentStatus | null
  acp: AcpControls
  /**
   * The mode the daemon judges this session by — `plan` refuses writes, `yolo` runs
   * every call. Not a UI preference: it is what the daemon will do on the next tool
   * call, which is why it is read back from `get_permission_state` rather than
   * assumed.
   */
  mode: 'plan' | 'yolo'
  onToggleMode: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
  /** undefined = 引擎没有会话名（ACP）；null = thunder 会话还没有标题。 */
  conversationTitle?: string | null
  titleBusy?: boolean
  onRenameTitle?: (title: string) => void
  onAiTitle?: () => void
  search?: ChatSearchControls | null
}) {
  const tone = agentStatus ? TONES[agentStatus.phase] : undefined
  const label = agentStatus ? LABELS[agentStatus.phase] : undefined
  const acpStatus = acp.state?.status
  const acpTone =
    acpStatus === 'ready' || acpStatus === 'running'
      ? 'ready'
      : acpStatus === 'connecting'
        ? 'connecting'
        : acpStatus === 'error'
          ? 'error'
          : 'idle'
  const acpLabel =
    acpTone === 'ready'
      ? `${acp.providerLabel} 就绪`
      : acpTone === 'connecting'
        ? '连接中...'
        : acpTone === 'error'
          ? '连接失败 · 重连'
          : '未连接'

  return (
    <header className="pc-header app-drag">
      <div className="pc-header-left">
        <button
          type="button"
          className="pc-header-collapse"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? '展开工作空间侧栏' : '折叠工作空间侧栏'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <span className="pc-header-title">
          <Zap size={15} />
          {conversationTitle === undefined ? (
            <span>AI 原型对话</span>
          ) : (
            <TitleLabel
              title={conversationTitle}
              busy={titleBusy}
              onRename={onRenameTitle}
              onAi={onAiTitle}
            />
          )}
        </span>
        {acp.engine === 'thunder' && (
          <button
            type="button"
            className={`pc-header-mode is-${mode}`}
            onClick={onToggleMode}
            title={
              mode === 'plan'
                ? 'Plan 模式：只读，写操作会被拦下（点击切到 Yolo）'
                : 'Yolo 模式：每次工具调用直接执行（点击切到 Plan）'
            }
          >
            <span>{mode === 'plan' ? '📋 Plan' : '⚡ Yolo'}</span>
          </button>
        )}
        {acp.engine === 'thunder' ? (
          <button
            type="button"
            className={`pc-header-model${configured ? '' : ' is-unconfigured'}`}
            onClick={onOpenSettings}
            title={configured ? `当前模型：${modelLabel}` : '尚未配置模型，点击设置'}
          >
            {configured ? providerIcon ?? <Bot size={11} /> : <Bot size={11} />}
            <span>{configured ? modelLabel : '未配置模型'}</span>
          </button>
        ) : (
          <button
            type="button"
            className={`pc-header-acp is-${acpTone}`}
            onClick={() => (acpTone === 'error' ? acp.reconnect() : onOpenSettings())}
            title={
              acp.state?.error
                ? `${acp.state.error}（点击重连）`
                : acpTone === 'error'
                  ? '点击重连'
                  : `${acp.providerLabel} · ACP 会话`
            }
          >
            <span className="pc-header-acp-dot" aria-hidden="true" />
            <span>{acpLabel}</span>
          </button>
        )}
      </div>

      {search && <SearchBar search={search} />}

      {tone && label && (
        <span className={`pc-agent-status is-${tone}`} title={agentStatus?.detail || label}>
          <span className="pc-agent-status-dot" aria-hidden="true" />
          <span>{agentStatus?.phase === 'tool' && agentStatus.tool ? agentStatus.tool : label}</span>
          {agentStatus && agentStatus.turn > 0 && (
            <span className="pc-agent-status-turn">R{agentStatus.turn}</span>
          )}
        </span>
      )}
    </header>
  )
}

/** 会话名：展示态点击进入行内编辑；✨ 让 daemon 的 utility 模型重新起名。 */
function TitleLabel({
  title,
  busy,
  onRename,
  onAi
}: {
  title: string | null
  busy?: boolean
  onRename?: (title: string) => void
  onAi?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    if (!onRename) return
    setDraft(title ?? '')
    setEditing(true)
  }

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== title) onRename?.(next)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="pc-header-title-input"
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
        }}
        aria-label="会话名称"
      />
    )
  }

  return (
    <span className="pc-header-title-name">
      <button
        type="button"
        className="pc-header-title-btn"
        onClick={startEdit}
        disabled={!onRename}
        title={title ? '点击重命名（手动名不会被自动改名覆盖）' : '点击命名这个对话'}
      >
        <span className="pc-header-title-text">{title || '未命名对话'}</span>
      </button>
      {onAi && (
        <button
          type="button"
          className="pc-header-title-ai"
          onClick={onAi}
          disabled={busy}
          title="AI 重新命名（daemon 的辅助模型生成）"
          aria-label="AI 命名"
        >
          <Sparkles size={11} className={busy ? 'pc-spin' : undefined} />
        </button>
      )}
    </span>
  )
}

function SearchBar({ search }: { search: ChatSearchControls }) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="pc-chat-search">
      <Search size={11} className="pc-chat-search-icon" />
      <input
        ref={inputRef}
        type="search"
        className="pc-chat-search-input"
        value={search.query}
        placeholder="搜索对话"
        aria-label="在对话中搜索"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => search.onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) search.onPrev()
            else search.onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            search.onClose()
          }
        }}
      />
      {search.query.trim() ? (
        <span className={`pc-chat-search-count${search.totalMatches === 0 ? ' is-empty' : ''}`}>
          {search.totalMatches > 0 ? `${search.currentMatchIndex + 1}/${search.totalMatches}` : '0/0'}
        </span>
      ) : null}
      {search.query.trim() && search.totalMatches > 0 ? (
        <span className="pc-chat-search-nav">
          <button type="button" onClick={search.onPrev} title="上一个 (Shift+Enter)" aria-label="上一个匹配">
            <ChevronUp size={11} />
          </button>
          <button type="button" onClick={search.onNext} title="下一个 (Enter)" aria-label="下一个匹配">
            <ChevronDown size={11} />
          </button>
        </span>
      ) : null}
      <button type="button" className="pc-chat-search-close" onClick={search.onClose} title="关闭 (Esc)" aria-label="关闭搜索">
        <X size={11} />
      </button>
    </div>
  )
}
