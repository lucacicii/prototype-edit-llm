import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * 模型库与思考档位的单一数据源。
 *
 * 输入区的两个下拉和「⚙️ 模型设置」弹窗都要读写同一份配置，两边各拉一次
 * `getConfig()` 必然走神（弹窗保存完，输入区还显示旧模型）。所以状态放在
 * 模块作用域，两个组件共享同一批 ref，谁改完谁调 `refresh()`。
 *
 * 注意 agent:set-config 是**整体覆盖**（model-config.ts 写的是 normalizeConfig
 * 的完整结果），所以写入必须先把当前配置读回来再合写 —— 见 §persist。
 *
 * 模型从哪来：本机自己的模型库（`providers.json`），不再是 `~/.thunder`。可选的
 * 候选、可用性判定和「为什么不可用」都由主进程给（`redactLibrary`），渲染层只
 * 负责显示 —— 判定只写一遍才不会两边打架。
 */

/** 模型库里一项在渲染层的视图（密钥只剩 hasApiKey 布尔）。 */
export interface AgentModelView {
  selectionId: string
  provider: string
  id: string
  name: string
  api: string
  baseUrl: string
  hasApiKey: boolean
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  thinkingLevels: string[]
  defaultThinkingLevel: string
  available: boolean
  /** available 为 false 时的具体原因。 */
  unavailableReason?: string
  /** 支持的输入模态；含 'image' 才吃图。 */
  input?: string[]
}

/** `get-config` 给出的、渲染层只读的三份词表（权威在主进程）。 */
export interface AgentModelVocabularies {
  /** 内核（rpi-ai）真正能连的 api 方言。 */
  apiOptions: string[]
  /** 思考档位的合法取值，弱 → 强。 */
  thinkingVocabulary: string[]
  defaults: { contextWindow: number; maxTokens: number; thinkingLevels: string[] }
}

const EMPTY_VOCABULARIES: AgentModelVocabularies = {
  apiOptions: [],
  thinkingVocabulary: [],
  defaults: { contextWindow: 0, maxTokens: 0, thinkingLevels: ['off'] }
}

// —— 模块级单例状态 ——
// 编辑本文件会因 HMR 重新执行模块、把这些 ref 清空；调用方在 onMounted 里
// refresh() 即自愈（与 prototypeStore.ts 的处理方式一致）。
const models = ref<AgentModelView[]>([])
const selectionId = ref('')
const thinkingLevel = ref('')
const envLocked = ref(false)
const configured = ref(false)
const loaded = ref(false)
/** 没有模型时主进程给的原因，原样展示。 */
const problem = ref('')
const libraryPath = ref('')
/** 密钥是否真的加密了（无 keyring 的平台上为 false）。 */
const keyStoreEncrypted = ref(true)
const vocabularies = ref<AgentModelVocabularies>(EMPTY_VOCABULARIES)

export function useAgentModelConfig() {
  const selectedModel = computed(() => models.value.find((m) => m.selectionId === selectionId.value))

  const groupedModels = computed(() => {
    const groups: { provider: string; items: (AgentModelView & { label: string })[] }[] = []
    for (const item of models.value) {
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
  })

  const thinkingOptions = computed(() =>
    selectedModel.value?.thinkingLevels?.length
      ? selectedModel.value.thinkingLevels
      : vocabularies.value.defaults.thinkingLevels
  )

  /** 上下文窗口上限（指标条的分母）。 */
  const selectedContextWindow = computed(() => selectedModel.value?.contextWindow ?? 0)

  /** 当前模型是否吃图。不支持时附件按钮要禁用并说明原因。 */
  const supportsImages = computed(() => selectedModel.value?.input?.includes('image') ?? false)

  /** 读回配置，填满共享状态。任何写入之后都要调它，否则界面留着旧值。 */
  async function refresh() {
    if (!window.agent?.getConfig) return
    const res = await window.agent.getConfig()
    models.value = (res.models ?? []) as AgentModelView[]
    envLocked.value = Boolean(res.envLocked)
    configured.value = Boolean(res.configured)
    problem.value = res.problem ?? ''
    libraryPath.value = res.libraryPath ?? ''
    keyStoreEncrypted.value = res.keyStore?.encrypted !== false
    if (res.apiOptions?.length) {
      vocabularies.value = {
        apiOptions: res.apiOptions,
        thinkingVocabulary: res.thinkingVocabulary ?? [],
        defaults: res.defaults ?? EMPTY_VOCABULARIES.defaults
      }
    }

    const model = res.config?.model as { provider?: string; id?: string } | undefined
    const match = models.value.find((m) => m.provider === model?.provider && m.id === model?.id)
    selectionId.value = match?.selectionId ?? ''
    thinkingLevel.value = res.config?.thinkingLevel ?? match?.defaultThinkingLevel ?? ''
    loaded.value = true

    // 旧版把整个模型（含密钥）写在 .prototype-agent.json 里；主进程读到会顺手
    // 迁进模型库。迁移是用户看得到的动作，不静默。
    if (res.migrated?.length) {
      ElMessage.info(`已把 ${res.migrated.join('、')} 从旧配置迁入模型库，密钥已移入加密存储`)
    }
  }

  /**
   * 把当前选择写回 .prototype-agent.json。
   *
   * 必须先 getConfig() 读回：set-config 是整体覆盖，只写 model+thinkingLevel
   * 会把弹窗里设的温度 / maxTurns / 系统提示词一起抹掉。
   */
  async function persist() {
    const entry = selectedModel.value
    if (!entry || envLocked.value) return
    const current = await window.agent.getConfig()
    const res = await window.agent.setConfig({
      systemPrompt: current.config?.systemPrompt,
      maxTurns: current.config?.maxTurns,
      temperature: current.config?.temperature,
      requestTimeoutMs: current.config?.requestTimeoutMs,
      model: { provider: entry.provider, id: entry.id, name: entry.name },
      thinkingLevel: thinkingLevel.value || undefined
    })
    if (!res?.ok) {
      ElMessage.error(`保存失败：${res?.error ?? '未知错误'}`)
      return
    }
    await refresh()
  }

  /** 换模型：档位仍在新模型的列表里就保留，否则退回该模型的默认档。 */
  async function selectModel(value: string) {
    if (!value || envLocked.value) return
    selectionId.value = value
    const entry = selectedModel.value
    if (!entry) return
    if (!entry.thinkingLevels.includes(thinkingLevel.value)) {
      thinkingLevel.value = entry.defaultThinkingLevel
    }
    await persist()
  }

  async function selectThinkingLevel(value: string) {
    if (!value || envLocked.value) return
    thinkingLevel.value = value
    await persist()
  }

  return {
    models,
    groupedModels,
    selectedModel,
    thinkingOptions,
    selectedContextWindow,
    supportsImages,
    selectionId,
    thinkingLevel,
    envLocked,
    configured,
    loaded,
    problem,
    libraryPath,
    keyStoreEncrypted,
    vocabularies,
    refresh,
    persist,
    selectModel,
    selectThinkingLevel
  }
}
