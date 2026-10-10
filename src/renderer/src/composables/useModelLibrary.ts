import { ElMessage } from 'element-plus'
import { useAgentModelConfig, type AgentModelView, type ProviderGroup } from './useAgentModelConfig'

/**
 * 模型库（`providers.json`）的**写入**出口。
 *
 * 读侧全在 `useAgentModelConfig`：那一份是模块级单例，输入区的两个下拉和设置页
 * 读的是同一批 ref。写入单独放这里，是为了让 `<script setup>` 里的组件只管显示和
 * 交互 —— 每次写完统一 `refresh()`，界面不会留着旧值。
 *
 * 另一个反复出现的坑：`agent:save-model` 是**整条覆盖**，payload 里没给的字段就
 * 没了。所以下面每个 payload 都把读到的内容原样带回，包括那四个不做判定的透传
 * 字段（headers / thinkingLevelMap / cost / promptCache）—— 改服务商端点会重写整
 * 组模型，漏一样就不是丢一条。
 */

/** 模型表单的本地草稿。密钥永远留空：读不到，也就不可能回传。 */
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
  /**
   * 编辑已有条目时带着原视图，用来把那些表单里没有的透传字段原样回传。
   * 新建时为空。
   */
  source?: AgentModelView
}

/** 新建一条：端点从所属服务商继承，档位用主进程给的默认值。 */
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
    thinkingLevels: [...defaults.thinkingLevels],
    defaultThinkingLevel: '',
    apiKey: '',
    clearApiKey: false
  }
}

/** 把库里已有的一条载进表单（改它）。 */
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

export function useModelLibrary() {
  const modelConfig = useAgentModelConfig()

  /**
   * IPC 只吃能结构化克隆的纯数据，而 Vue 的 ref/reactive 取出来的值是 Proxy。
   *
   * `draft.thinkingLevels`、从视图上读的 `headers` / `cost` 这些就是这样一路变成
   * Proxy 的：主进程那边收不到，抛 `An object could not be cloned.`。这个错误的
   * 症状特别难查 —— 它只是一个 unhandled rejection，控制台之外什么都看不见，
   * 界面上表现为「按钮点下去毫无反应」。所以出 IPC 之前统一过一遍 JSON。
   *
   * 顺带把值为 undefined 的键抹掉，而 saveModel 本来就把「字段缺失」和「undefined」
   * 当同一件事（留空＝不改），所以这层剥离不会改变语义。
   */
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

  /** 新增/更新一条模型。不碰「当前选中」—— 那是显式的另一个动作。 */
  async function saveModelEntry(
    provider: string,
    draft: ModelDraft
  ): Promise<{ ok: boolean; error?: string }> {
    if (!window.agent?.saveModel) return { ok: false, error: 'agent 桥接不可用' }
    if (!draft.id.trim() || !draft.api || !draft.baseUrl.trim()) {
      return { ok: false, error: '模型 ID / API 协议 / Base URL 都是必填' }
    }
    const res = await window.agent.saveModel(plain(payloadOf(provider, draft)))
    if (!res?.ok) return { ok: false, error: res?.error ?? '未知错误' }
    await modelConfig.refresh()
    return { ok: true }
  }

  /**
   * 改服务商端点：**一次写完整组**。
   *
   * 早先这里是「逐条 saveModel 循环」，而且我还在注释里断言过它不可能撞上
   * `validateModel` 的冲突检查 —— 断言是错的，实测直接写不进去。那条检查拿候选去
   * 比**磁盘上还没改的**同组模型，所以循环的第一次就和自己剩下的模型撞车。端点属于
   * 服务商，这个操作也就得由主进程一次做完（见 `updateProviderEndpoint`）。
   *
   * 顺带就没有了「部分成功」这种状态。
   */
  async function saveProviderEndpoint(
    group: ProviderGroup,
    patch: { api: string; baseUrl: string; apiKey?: string; clearApiKey?: boolean }
  ): Promise<{ ok: boolean; error?: string; updated: number }> {
    if (!window.agent?.saveProvider) {
      return { ok: false, error: 'agent 桥接不可用', updated: 0 }
    }
    const baseUrl = patch.baseUrl.trim()
    if (!patch.api || !baseUrl) {
      return { ok: false, error: 'API 协议与 Base URL 都是必填', updated: 0 }
    }

    const res = await window.agent.saveProvider({
      provider: group.provider,
      api: patch.api,
      baseUrl,
      apiKey: patch.apiKey?.trim() || undefined,
      clearApiKey: patch.clearApiKey || undefined
    })
    await modelConfig.refresh()
    if (!res?.ok) return { ok: false, error: res?.error ?? '未知错误', updated: 0 }
    return { ok: true, updated: res.updated ?? group.modelCount }
  }

  /** 从模型库删除一条。删掉的若是当前选中项，主进程会一并清掉引用。 */
  async function deleteModelEntry(provider: string, id: string): Promise<{ ok: boolean; error?: string }> {
    if (!window.agent?.deleteModel) return { ok: false, error: 'agent 桥接不可用' }
    const res = await window.agent.deleteModel({ provider, id })
    if (!res?.ok) return { ok: false, error: res?.error ?? '未知错误' }
    await modelConfig.refresh()
    if (res.clearedSelection) ElMessage.info('被删除的正是当前选中的模型，选择已清空')
    ElMessage.success('已从模型库删除')
    return { ok: true }
  }

  /** 删除一个服务商：它名下的全部模型 + 它的密钥。 */
  async function deleteProviderEntry(provider: string): Promise<{ ok: boolean; error?: string }> {
    if (!window.agent?.deleteProvider) return { ok: false, error: 'agent 桥接不可用' }
    const res = await window.agent.deleteProvider({ provider })
    if (!res?.ok) return { ok: false, error: res?.error ?? '未知错误' }
    await modelConfig.refresh()
    if (res.clearedSelection) ElMessage.info('被删除的正是当前选中的模型，选择已清空')
    if (res.droppedKeys?.length) {
      ElMessage.info(`顺带清掉了 ${res.droppedKeys.length} 个孤儿密钥（${res.droppedKeys.join('、')}）`)
    }
    ElMessage.success(`已删除服务商 ${provider}${res.removed ? `（${res.removed} 个模型）` : ''}`)
    return { ok: true }
  }

  return { saveModelEntry, saveProviderEndpoint, deleteModelEntry, deleteProviderEntry }
}
