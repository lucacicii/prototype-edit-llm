import { useMemo } from 'react'
import type { MenuProps } from 'antd'
import {
  useAgentModelConfigStore,
  type AcpPermissionPolicy,
  type AcpProvider,
  type AcpSessionState,
  type AgentEngine
} from '../../stores/useAgentModelConfigStore'
import type {
  AcpConfigSelectGroup,
  AcpConfigSelectOption
} from '../../../../main/acp/types'
import { getEngineIcon } from './providerIcon'

/**
 * ACP（Claude Code / Codex）引擎的菜单与状态，供 header 与 composer 共用。
 *
 * ACP 的「模型 / 模式 / 思考档位」不是本应用的配置，而是 agent 连上后通过
 * `session/new` 回报的 `configOptions` —— 也就是说菜单内容取决于对面是谁，
 * 所以只能在这里按当前会话状态现算。thunder 那套选择器仍然走 store。
 */
export interface AcpControls {
  engine: AgentEngine
  /** 当前 `引擎:会话键` 的 ACP 会话状态；还没连过就是 undefined。 */
  state?: AcpSessionState
  engineMenuItems: MenuProps['items']
  engineLabel: string
  /** ACP 下用哪个 agent（'Claude Code' / 'Codex'）。 */
  providerLabel: string
  modelMenuItems: MenuProps['items'] | null
  modelLabel: string | null
  modeMenuItems: MenuProps['items'] | null
  modeLabel: string | null
  thoughtMenuItems: MenuProps['items'] | null
  thoughtLabel: string | null
  permissionPolicy: AcpPermissionPolicy
  togglePermissionPolicy: () => void
  /** 连接失败时重连（其它状态点标题只是打开设置）。 */
  reconnect: () => void
}

const ENGINE_LABELS: Record<AgentEngine, string> = {
  thunder: 'Thunder',
  claude: 'Claude',
  codex: 'Codex'
}

const PROVIDER_LABELS: Record<AgentEngine, string> = {
  thunder: 'Thunder 内置引擎',
  claude: 'Claude Code',
  codex: 'Codex'
}

function selectGroupChildren(
  group: AcpConfigSelectGroup,
  currentValue: string,
  onPick: (value: string) => void
): MenuProps['items'] {
  return group.options.map((sub) => ({
    key: sub.value,
    label: (
      <span className="pc-menu-item">
        <span className={sub.value === currentValue ? 'is-active' : ''}>{sub.name}</span>
      </span>
    ),
    onClick: () => onPick(sub.value)
  }))
}

/** 把一个 select 型 configOption 拍成菜单项（顶层是分组，或直接是选项）。 */
function selectMenuItems(
  options: Array<AcpConfigSelectOption | AcpConfigSelectGroup>,
  currentValue: string,
  onPick: (value: string) => void
): MenuProps['items'] {
  const items: MenuProps['items'] = []
  for (const opt of options) {
    if ('group' in opt) {
      items.push({
        type: 'group',
        label: opt.name,
        children: selectGroupChildren(opt, currentValue, onPick)
      })
    } else {
      items.push({
        key: opt.value,
        label: (
          <span className="pc-menu-item">
            <span className={opt.value === currentValue ? 'is-active' : ''}>{opt.name}</span>
          </span>
        ),
        onClick: () => onPick(opt.value)
      })
    }
  }
  return items
}

function currentSelectLabel(
  options: Array<AcpConfigSelectOption | AcpConfigSelectGroup>,
  currentValue: string
): string {
  for (const opt of options) {
    if ('group' in opt) {
      const found = opt.options.find((sub) => sub.value === currentValue)
      if (found) return found.name
    } else if (opt.value === currentValue) {
      return opt.name
    }
  }
  return currentValue
}

export function useAcpControls(runKey: string | undefined): AcpControls {
  const {
    engine,
    acpStates,
    acpPermissionPolicy,
    selectEngine,
    selectAcpPermissionPolicy,
    connectAcp,
    setAcpMode,
    setAcpConfigOption
  } = useAgentModelConfigStore()

  /** ACP 会话按 `引擎:会话键` 存状态，键与 store 里写入时一致。 */
  const state = acpStates[`${engine}:${runKey || 'default'}`]
  /** ACP 会话键就是原型/工作区 id；'default' 只在没有项目时兜底。 */
  const sessionKey = runKey || 'default'
  const provider = engine as AcpProvider

  const engineMenuItems = useMemo<MenuProps['items']>(
    () =>
      (['thunder', 'claude', 'codex'] as AgentEngine[]).map((item) => ({
        key: item,
        label: (
          <span className="pc-menu-item">
            <span className="pc-menu-leading">
              {getEngineIcon(item, 13)}
              <span className={item === engine ? 'is-active' : ''}>{PROVIDER_LABELS[item]}</span>
            </span>
            {item === engine && <span className="pc-menu-note">当前</span>}
          </span>
        ),
        onClick: () => void selectEngine(item)
      })),
    [engine, selectEngine]
  )

  const modelOpt = state?.configOptions?.find(
    (opt) => opt.type === 'select' && (opt.category === 'model' || opt.id === 'model')
  )
  const modeOpt = state?.configOptions?.find(
    (opt) => opt.type === 'select' && (opt.category === 'mode' || opt.id === 'mode')
  )
  const thoughtOpt = state?.configOptions?.find(
    (opt) =>
      opt.type === 'select' &&
      (opt.category === 'thought_level' || opt.id === 'reasoning_effort')
  )

  const setOption = (configId: string, value: string) =>
    void setAcpConfigOption(provider, sessionKey, configId, value)

  const modelMenuItems = useMemo<MenuProps['items'] | null>(() => {
    if (modelOpt && modelOpt.type === 'select') {
      return selectMenuItems(modelOpt.options, modelOpt.currentValue, (value) =>
        setOption(modelOpt.id, value)
      )
    }
    // 老版本 agent 只报 `models` 而没有 configOptions，退回那份列表。
    const available = state?.models?.availableModels
    if (available?.length) {
      const currentId = state?.models?.currentModelId
      return available.map((m) => ({
        key: m.modelId,
        label: (
          <span className="pc-menu-item">
            <span className={m.modelId === currentId ? 'is-active' : ''}>{m.name || m.modelId}</span>
          </span>
        ),
        onClick: () => setOption('model', m.modelId)
      }))
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelOpt, state?.models, provider, sessionKey, setAcpConfigOption])

  const modelLabel = useMemo(() => {
    if (modelOpt && modelOpt.type === 'select') {
      return currentSelectLabel(modelOpt.options, modelOpt.currentValue)
    }
    if (state?.models?.availableModels?.length) {
      const found = state.models.availableModels.find(
        (m) => m.modelId === state.models?.currentModelId
      )
      return found?.name || state.models.currentModelId
    }
    return null
  }, [modelOpt, state?.models])

  // 模式优先取 `modes`（ACP 标准字段），没有才退回 mode 类 configOption。
  const modeMenuItems = useMemo<MenuProps['items'] | null>(() => {
    if (state?.modes?.length) {
      const currentId = state.currentModeId
      return state.modes.map((m) => ({
        key: m.id,
        label: (
          <span className="pc-menu-item">
            <span className={m.id === currentId ? 'is-active' : ''}>{m.name || m.id}</span>
          </span>
        ),
        onClick: () => void setAcpMode(provider, sessionKey, m.id)
      }))
    }
    if (modeOpt && modeOpt.type === 'select') {
      return selectMenuItems(modeOpt.options, modeOpt.currentValue, (value) =>
        setOption(modeOpt.id, value)
      )
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.modes, state?.currentModeId, modeOpt, provider, sessionKey, setAcpMode])

  const modeLabel = useMemo(() => {
    if (state?.modes?.length) {
      const found = state.modes.find((m) => m.id === state.currentModeId)
      return found?.name || state.currentModeId || null
    }
    if (modeOpt && modeOpt.type === 'select') {
      return currentSelectLabel(modeOpt.options, modeOpt.currentValue)
    }
    return null
  }, [state?.modes, state?.currentModeId, modeOpt])

  const thoughtMenuItems = useMemo<MenuProps['items'] | null>(() => {
    if (!thoughtOpt || thoughtOpt.type !== 'select') return null
    return selectMenuItems(thoughtOpt.options, thoughtOpt.currentValue, (value) =>
      setOption(thoughtOpt.id, value)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thoughtOpt, provider, sessionKey, setAcpConfigOption])

  const thoughtLabel = useMemo(() => {
    if (!thoughtOpt || thoughtOpt.type !== 'select') return null
    return currentSelectLabel(thoughtOpt.options, thoughtOpt.currentValue)
  }, [thoughtOpt])

  return {
    engine,
    state,
    engineMenuItems,
    engineLabel: ENGINE_LABELS[engine],
    providerLabel: PROVIDER_LABELS[engine],
    modelMenuItems,
    modelLabel,
    modeMenuItems,
    modeLabel,
    thoughtMenuItems,
    thoughtLabel,
    permissionPolicy: acpPermissionPolicy,
    togglePermissionPolicy: () =>
      void selectAcpPermissionPolicy(acpPermissionPolicy === 'allowAll' ? 'ask' : 'allowAll'),
    reconnect: () => void connectAcp(provider, sessionKey, true)
  }
}
