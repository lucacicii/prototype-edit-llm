import { create } from 'zustand'
import { message } from 'antd'
import type {
  AgentEngine,
  AcpProvider,
  AcpPermissionPolicy,
  AcpSessionState
} from '../../../main/acp/types'

export type { AgentEngine, AcpProvider, AcpPermissionPolicy, AcpSessionState }

export interface AgentModelView {
  selectionId: string
  provider: string
  id: string
  name: string
  api: string
  baseUrl: string
  hasApiKey: boolean
  keySource?: 'stored' | 'env' | null
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  thinkingLevels: string[]
  defaultThinkingLevel: string
  available: boolean
  unavailableReason?: string
  input?: string[]
  headers?: Record<string, string>
  thinkingLevelMap?: Record<string, string | null>
  cost?: Record<string, unknown>
  promptCache?: Record<string, unknown>
}

export interface AgentModelVocabularies {
  apiOptions: string[]
  thinkingVocabulary: string[]
  defaults: { contextWindow: number; maxTokens: number; thinkingLevels: string[] }
}

export const EMPTY_VOCABULARIES: AgentModelVocabularies = {
  apiOptions: [],
  thinkingVocabulary: [],
  defaults: { contextWindow: 0, maxTokens: 0, thinkingLevels: ['off'] }
}

export interface AgentTuningPatch {
  systemPrompt?: string
  maxTurns?: number
  temperature?: number
  thinkingLevel?: string
  requestTimeoutMs?: number
}

export interface ProviderGroup {
  provider: string
  api: string
  baseUrl: string
  models: AgentModelView[]
  modelCount: number
  hasApiKey: boolean
  keySource: 'stored' | 'env' | null
  availableCount: number
  unavailableReason?: string
  endpointConflict: boolean
}

export function groupByProvider(models: AgentModelView[]): ProviderGroup[] {
  const groups: ProviderGroup[] = []
  for (const model of models) {
    let group = groups.find((g) => g.provider === model.provider)
    if (!group) {
      group = {
        provider: model.provider,
        api: model.api,
        baseUrl: model.baseUrl,
        models: [],
        modelCount: 0,
        hasApiKey: false,
        keySource: null,
        availableCount: 0,
        endpointConflict: false
      }
      groups.push(group)
    }
    group.models.push(model)
    group.modelCount += 1
    if (!group.keySource && model.keySource) group.keySource = model.keySource
    if (model.hasApiKey) group.hasApiKey = true
    if (model.available) group.availableCount += 1
    if (!model.available && !group.unavailableReason) group.unavailableReason = model.unavailableReason
    if (model.api !== group.api || model.baseUrl !== group.baseUrl) group.endpointConflict = true
  }
  return groups
}

interface AgentModelConfigState {
  models: AgentModelView[]
  selectionId: string
  thinkingLevel: string
  envLocked: boolean
  configured: boolean
  loaded: boolean
  problem: string
  libraryPath: string
  keyStoreEncrypted: boolean
  vocabularies: AgentModelVocabularies

  engine: AgentEngine
  acpPermissionPolicy: AcpPermissionPolicy
  acpAgents: Partial<Record<AcpProvider, { command?: string; args?: string[]; env?: Record<string, string> }>>
  acpStates: Record<string, AcpSessionState>

  selectEngine: (engine: AgentEngine) => Promise<void>
  selectAcpPermissionPolicy: (policy: AcpPermissionPolicy) => Promise<void>
  saveAcpAgents: (
    acpAgents: Partial<Record<AcpProvider, { command?: string; args?: string[]; env?: Record<string, string> }>>
  ) => Promise<{ ok: boolean; error?: string }>
  connectAcp: (provider: AcpProvider, prototypeId: string, force?: boolean) => Promise<AcpSessionState | null>
  setAcpMode: (provider: AcpProvider, prototypeId: string, modeId: string) => Promise<void>
  setAcpConfigOption: (
    provider: AcpProvider,
    prototypeId: string,
    configId: string,
    value: string | boolean
  ) => Promise<void>
  applyAcpState: (state: AcpSessionState) => void
  refresh: () => Promise<void>
  selectModel: (value: string) => Promise<void>
  selectThinkingLevel: (value: string) => Promise<void>
  saveTuning: (patch: AgentTuningPatch) => Promise<{ ok: boolean; error?: string; path?: string }>
}

export const useAgentModelConfigStore = create<AgentModelConfigState>((set, get) => ({
  models: [],
  selectionId: '',
  thinkingLevel: '',
  envLocked: false,
  configured: false,
  loaded: false,
  problem: '',
  libraryPath: '',
  keyStoreEncrypted: true,
  vocabularies: EMPTY_VOCABULARIES,
  engine: 'thunder',
  acpPermissionPolicy: 'allowAll',
  acpAgents: {},
  acpStates: {},

  refresh: async () => {
    if (!window.agent?.getConfig) return
    try {
      const res = await window.agent.getConfig()
      const models = (res.models ?? []) as AgentModelView[]
      const envLocked = Boolean(res.envLocked)
      const configured = Boolean(res.configured)
      const problem = res.problem ?? ''
      const libraryPath = res.libraryPath ?? ''
      const keyStoreEncrypted = res.keyStore?.encrypted !== false

      const vocabularies: AgentModelVocabularies = res.apiOptions?.length
        ? {
            apiOptions: res.apiOptions,
            thinkingVocabulary: res.thinkingVocabulary ?? [],
            defaults: res.defaults ?? EMPTY_VOCABULARIES.defaults
          }
        : get().vocabularies

      const model = res.config?.model as { provider?: string; id?: string } | undefined
      const match = models.find((m) => m.provider === model?.provider && m.id === model?.id)
      const selectionId = match?.selectionId ?? ''
      const thinkingLevel = res.config?.thinkingLevel ?? match?.defaultThinkingLevel ?? ''

      const engine = (res.config?.engine as AgentEngine) || 'thunder'
      const acpPermissionPolicy = (res.config?.acpPermissionPolicy as AcpPermissionPolicy) || 'allowAll'
      const acpAgents = (res.config?.acpAgents ?? {}) as Partial<
        Record<AcpProvider, { command?: string; args?: string[]; env?: Record<string, string> }>
      >
      set({
        models,
        envLocked,
        configured,
        problem,
        libraryPath,
        keyStoreEncrypted,
        vocabularies,
        selectionId,
        thinkingLevel,
        loaded: true,
        engine,
        acpPermissionPolicy,
        acpAgents
      })

      if (res.migrated?.length) {
        message.info(`已把 ${res.migrated.join('、')} 从旧配置迁入模型库，密钥已移入加密存储`)
      }
    } catch {
      set({ configured: false, loaded: true })
    }
  },

  selectModel: async (value: string) => {
    const { models, envLocked, thinkingLevel } = get()
    if (!value || envLocked) return
    const entry = models.find((m) => m.selectionId === value)
    if (!entry) return

    let nextThinkingLevel = thinkingLevel
    if (!entry.thinkingLevels?.includes(thinkingLevel)) {
      nextThinkingLevel = entry.defaultThinkingLevel || ''
    }

    set({ selectionId: value, thinkingLevel: nextThinkingLevel })

    if (window.agent?.getConfig && window.agent?.setConfig) {
      const current = await window.agent.getConfig()
      const res = await window.agent.setConfig({
        systemPrompt: current.config?.systemPrompt,
        maxTurns: current.config?.maxTurns,
        temperature: current.config?.temperature,
        requestTimeoutMs: current.config?.requestTimeoutMs,
        model: { provider: entry.provider, id: entry.id, name: entry.name },
        thinkingLevel: nextThinkingLevel || undefined
      })
      if (!res?.ok) {
        message.error(`保存失败：${res?.error ?? '未知错误'}`)
        return
      }
      await get().refresh()
    }
  },

  selectThinkingLevel: async (value: string) => {
    const { envLocked, models, selectionId } = get()
    if (!value || envLocked) return
    const entry = models.find((m) => m.selectionId === selectionId)
    set({ thinkingLevel: value })

    if (entry && window.agent?.getConfig && window.agent?.setConfig) {
      const current = await window.agent.getConfig()
      const res = await window.agent.setConfig({
        systemPrompt: current.config?.systemPrompt,
        maxTurns: current.config?.maxTurns,
        temperature: current.config?.temperature,
        requestTimeoutMs: current.config?.requestTimeoutMs,
        model: { provider: entry.provider, id: entry.id, name: entry.name },
        thinkingLevel: value || undefined
      })
      if (!res?.ok) {
        message.error(`保存失败：${res?.error ?? '未知错误'}`)
        return
      }
      await get().refresh()
    }
  },

  saveTuning: async (patch: AgentTuningPatch) => {
    if (!window.agent?.getConfig || !window.agent?.setConfig) {
      return { ok: false, error: 'agent 桥接不可用' }
    }
    const current = await window.agent.getConfig()
    const res = await window.agent.setConfig({
      ...(current.config ?? {}),
      ...patch,
      model: current.config?.model
    })
    if (res?.ok) await get().refresh()
    return res ?? { ok: false, error: '未知错误' }
  },

  selectEngine: async (engine: AgentEngine) => {
    set({ engine })
    if (window.agent?.getConfig && window.agent?.setConfig) {
      const current = await window.agent.getConfig()
      await window.agent.setConfig({
        ...(current.config ?? {}),
        engine
      })
      await get().refresh()
    }
  },

  selectAcpPermissionPolicy: async (policy: AcpPermissionPolicy) => {
    set({ acpPermissionPolicy: policy })
    if (window.agent?.getConfig && window.agent?.setConfig) {
      const current = await window.agent.getConfig()
      await window.agent.setConfig({
        ...(current.config ?? {}),
        acpPermissionPolicy: policy
      })
      await get().refresh()
    }
  },

  saveAcpAgents: async (acpAgents) => {
    if (!window.agent?.getConfig || !window.agent?.setConfig) {
      return { ok: false, error: 'agent 桥接不可用' }
    }
    const current = await window.agent.getConfig()
    const res = await window.agent.setConfig({
      ...(current.config ?? {}),
      acpAgents
    })
    if (res?.ok) await get().refresh()
    return res ?? { ok: false, error: '未知错误' }
  },

  connectAcp: async (provider: AcpProvider, prototypeId: string, force?: boolean) => {
    if (!window.agent?.acpConnect) return null
    try {
      const res = await window.agent.acpConnect({ provider, prototypeId, force })
      if (res?.ok && res.state) {
        const state = res.state as AcpSessionState
        set((prev) => ({
          acpStates: {
            ...prev.acpStates,
            [`${provider}:${prototypeId}`]: state
          }
        }))
        return state
      }
      return null
    } catch (err) {
      console.warn('[ACP Store] connectAcp error:', err)
      return null
    }
  },

  setAcpMode: async (provider: AcpProvider, prototypeId: string, modeId: string) => {
    if (!window.agent?.acpSetMode) return
    await window.agent.acpSetMode({ provider, prototypeId, modeId })
  },

  setAcpConfigOption: async (
    provider: AcpProvider,
    prototypeId: string,
    configId: string,
    value: string | boolean
  ) => {
    if (!window.agent?.acpSetConfigOption) return
    await window.agent.acpSetConfigOption({ provider, prototypeId, configId, value })
  },

  applyAcpState: (state: AcpSessionState) => {
    set((prev) => ({
      acpStates: {
        ...prev.acpStates,
        [`${state.provider}:${state.workspaceKey}`]: state
      }
    }))
  }
}))

// Convenient hooks
export function useSelectedModel(): AgentModelView | undefined {
  const models = useAgentModelConfigStore((s) => s.models)
  const selectionId = useAgentModelConfigStore((s) => s.selectionId)
  return models.find((m) => m.selectionId === selectionId)
}

export function useGroupedModels() {
  const models = useAgentModelConfigStore((s) => s.models)
  const groups: { provider: string; items: (AgentModelView & { label: string })[] }[] = []
  for (const item of models) {
    const label = `${item.name === item.id ? item.id : `${item.name} (${item.id})`}${
      item.available ? '' : ` · ${item.unavailableReason ?? '不可用'}`
    }`
    let group = groups.find((g) => g.provider === item.provider)
    if (!group) {
      group = { provider: item.provider, items: [] }
      groups.push(group)
    }
    group.items.push({ ...item, label })
  }
  return groups
}

export function useProviderGroups(): ProviderGroup[] {
  const models = useAgentModelConfigStore((s) => s.models)
  return groupByProvider(models)
}
