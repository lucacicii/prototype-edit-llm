import { message } from 'antd'
import {
  useAgentModelConfigStore,
  type AgentModelView,
  type ProviderGroup
} from './useAgentModelConfigStore'

export interface ModelDraft {
  id: string
  name: string
  api: string
  baseUrl: string
  reasoning: boolean
  supportsImages: boolean
  contextWindow?: number
  maxTokens?: number
  thinkingLevels: string[]
  defaultThinkingLevel: string
  apiKey: string
  clearApiKey: boolean
  source?: AgentModelView
}

export function emptyDraft(
  api: string,
  baseUrl: string,
  defaults: { contextWindow: number; maxTokens: number; thinkingLevels: string[] }
): ModelDraft {
  return {
    id: '',
    name: '',
    api,
    baseUrl,
    reasoning: false,
    supportsImages: false,
    contextWindow: defaults.contextWindow || undefined,
    maxTokens: defaults.maxTokens || undefined,
    thinkingLevels: ['off'],
    defaultThinkingLevel: 'off',
    apiKey: '',
    clearApiKey: false
  }
}

export function draftFrom(view: AgentModelView): ModelDraft {
  return {
    id: view.id,
    name: view.name === view.id ? '' : view.name,
    api: view.api,
    baseUrl: view.baseUrl,
    reasoning: view.reasoning,
    supportsImages: Boolean(view.input?.includes('image')),
    contextWindow: view.contextWindow || undefined,
    maxTokens: view.maxTokens || undefined,
    thinkingLevels: view.thinkingLevels?.length ? [...view.thinkingLevels] : [],
    defaultThinkingLevel: view.defaultThinkingLevel || '',
    apiKey: '',
    clearApiKey: false,
    source: view
  }
}

function plain<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function payloadOf(provider: string, draft: ModelDraft) {
  const id = draft.id.trim()
  return {
    provider,
    id,
    name: draft.name.trim() || id,
    api: draft.api,
    baseUrl: draft.baseUrl.trim(),
    headers: draft.source?.headers,
    reasoning: draft.reasoning || undefined,
    input: draft.supportsImages ? ['text', 'image'] : undefined,
    contextWindow: draft.contextWindow || undefined,
    maxTokens: draft.maxTokens || undefined,
    thinkingLevels: draft.thinkingLevels.length ? draft.thinkingLevels : undefined,
    defaultThinkingLevel: draft.defaultThinkingLevel || undefined,
    thinkingLevelMap: draft.source?.thinkingLevelMap,
    cost: draft.source?.cost,
    promptCache: draft.source?.promptCache,
    apiKey: draft.apiKey.trim() || undefined,
    clearApiKey: draft.clearApiKey || undefined
  }
}

export async function saveModelItem(
  provider: string,
  draft: ModelDraft
): Promise<{ ok: boolean; error?: string }> {
  if (!window.agent?.saveModel) {
    return { ok: false, error: 'agent 桥接不可用' }
  }
  const payload = plain(payloadOf(provider, draft))
  const res = await window.agent.saveModel(payload)
  if (!res?.ok) {
    message.error(`保存失败：${res?.error ?? '未知错误'}`)
    return res ?? { ok: false, error: '未知错误' }
  }
  message.success(`已保存模型 ${draft.id.trim()}`)
  await useAgentModelConfigStore.getState().refresh()
  return res
}

export async function deleteModelItem(
  provider: string,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (!window.agent?.deleteModel) {
    return { ok: false, error: 'agent 桥接不可用' }
  }
  const res = await window.agent.deleteModel({ provider, id })
  if (!res?.ok) {
    message.error(`删除失败：${res?.error ?? '未知错误'}`)
    return res ?? { ok: false, error: '未知错误' }
  }
  message.info(`已删除模型 ${id}`)
  await useAgentModelConfigStore.getState().refresh()
  return res
}

export async function deleteProviderGroup(
  provider: string
): Promise<{ ok: boolean; error?: string }> {
  if (!window.agent?.deleteProvider) {
    return { ok: false, error: 'agent 桥接不可用' }
  }
  const res = await window.agent.deleteProvider({ provider })
  if (!res?.ok) {
    message.error(`删除服务商失败：${res?.error ?? '未知错误'}`)
    return res ?? { ok: false, error: '未知错误' }
  }
  message.info(`已移除服务商 ${provider} 及其全部模型`)
  await useAgentModelConfigStore.getState().refresh()
  return res
}

export async function saveProviderGroup(
  group: ProviderGroup,
  draft: { api: string; baseUrl: string; apiKey?: string; clearApiKey?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  if (!window.agent?.saveProvider) {
    return { ok: false, error: 'agent 桥接不可用' }
  }
  const res = await window.agent.saveProvider(
    plain({
      provider: group.provider,
      api: draft.api,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey?.trim() || undefined,
      clearApiKey: draft.clearApiKey || undefined
    })
  )
  if (!res?.ok) {
    message.error(`保存失败：${res?.error ?? '未知错误'}`)
    return res ?? { ok: false, error: '未知错误' }
  }
  message.success(`已更新服务商 ${group.provider}（覆盖 ${res.updated ?? 0} 个模型）`)
  await useAgentModelConfigStore.getState().refresh()
  return res
}
