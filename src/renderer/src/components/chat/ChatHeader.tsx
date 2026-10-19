import { Zap, PanelLeftClose, PanelLeftOpen, Bot } from 'lucide-react'
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

/**
 * 对话面板顶部：折叠按钮、标题、当前模型、运行阶段。
 *
 * 阶段来自 thunder 的 execution-status 插件（`agent_status`），而不是靠观察
 * 消息流 —— 停在问题上的 run 和正在思考的 run 从外面看完全一样，只有
 * thunder 知道是哪一个。空闲与已完成不显示徽标：那两种状态消息流已经说清楚了。
 *
 * ACP 引擎下这个位置换成一个**连接状态**：那里没有「本应用的模型配置」可显示，
 * 用户真正需要知道的是对面那个 agent 进程连上了没有。
 */
export function ChatHeader({
  modelLabel,
  providerIcon,
  configured,
  agentStatus,
  acp,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings
}: {
  modelLabel: string
  providerIcon?: React.ReactNode
  configured: boolean
  agentStatus?: ThunderAgentStatus | null
  acp: AcpControls
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
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
          <span>AI 原型对话</span>
        </span>
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
