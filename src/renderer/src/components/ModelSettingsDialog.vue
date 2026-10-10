<template>
  <el-dialog
    v-model="visible"
    title="⚙️ 模型与 Agent 设置"
    width="680px"
    destroy-on-close
    :close-on-click-modal="false"
    @closed="emit('closed')"
  >
    <!-- 运行时与配置文件状态 -->
    <div class="status-bar">
      <span class="dot" :class="statusClass"></span>
      <span class="status-text">{{ statusText }}</span>
      <span class="spacer"></span>
      <el-button size="small" text type="primary" :loading="checking" @click="handleCheck">
        检测运行时
      </el-button>
    </div>
    <!-- 两项就绪表：内核 / 数据根。打包版出问题时就靠它一眼看出缺哪一环，
         而不是又变成「模型调用莫名失败」。 -->
    <div class="readiness" v-if="readiness.length">
      <div v-for="item in readiness" :key="item.label" class="readiness-row">
        <span class="readiness-mark" :class="item.ok ? 'ok' : 'bad'">
          {{ item.ok ? '✓' : '✗' }}
        </span>
        <span class="readiness-label">{{ item.label }}</span>
        <span class="readiness-detail" :title="item.detail">{{ item.detail }}</span>
      </div>
    </div>
    <div class="status-path" v-else-if="runtimePath">{{ runtimePath }}</div>

    <el-alert
      v-if="envLocked"
      type="warning"
      :closable="false"
      show-icon
      title="环境变量 PROTOTYPE_AGENT_MODEL 正在覆盖此配置，保存后下次启动仍以环境变量为准。"
      style="margin-bottom: 12px;"
    />

    <!-- 没有 keyring 的平台：密钥只能明文落盘，这是降级，要说出来 -->
    <el-alert
      v-if="!keyStoreEncrypted"
      type="warning"
      :closable="false"
      show-icon
      title="本机没有可用的系统钥匙串，API Key 将以明文存放在 0600 权限的文件里。"
      style="margin-bottom: 12px;"
    />

    <!-- 模型库：本机自己的 provider/模型清单，与 ~/.thunder 无关 -->
    <div class="source-head">
      <span class="source-title">模型库（{{ models.length }}）</span>
      <span>
        <el-button size="small" text type="primary" :loading="loading" @click="load">
          刷新
        </el-button>
        <el-button size="small" text type="primary" @click="startNew">
          新建模型
        </el-button>
      </span>
    </div>
    <div class="status-path" v-if="libraryPath">模型库保存在 {{ libraryPath }}</div>

    <el-alert
      v-if="problem"
      type="info"
      :closable="false"
      show-icon
      :title="problem"
      style="margin-bottom: 12px;"
    />

    <el-form label-position="top" :model="form" class="settings-form">
      <el-form-item v-if="models.length" label="选择已有模型（或直接新建一个）">
        <el-select
          v-model="selectionId"
          filterable
          clearable
          placeholder="搜索并选择模型"
          style="width: 100%"
          @change="handleSelectModel"
        >
          <el-option-group v-for="group in groupedModels" :key="group.provider" :label="group.provider">
            <el-option
              v-for="item in group.items"
              :key="item.selectionId"
              :value="item.selectionId"
              :label="item.label"
            />
          </el-option-group>
        </el-select>
      </el-form-item>

      <!-- 选中项不可用（缺密钥 / 方言不支持）时把原因摆在表单上方，
           而不是让用户按了发送才发现 -->
      <el-alert
        v-if="selectedEntry && !selectedEntry.available"
        type="warning"
        :closable="false"
        show-icon
        :title="`当前选中项不可用：${selectedEntry.unavailableReason ?? '原因未知'}`"
        style="margin-bottom: 12px;"
      />

      <div class="grid-2">
        <el-form-item label="服务商标识 provider" required>
          <el-input v-model="form.provider" placeholder="例如 openai / anthropic / deepseek" />
        </el-form-item>
        <el-form-item label="模型 ID id" required>
          <el-input v-model="form.id" placeholder="例如 gpt-4o / claude-sonnet-4" />
        </el-form-item>
      </div>

      <div class="grid-2">
        <el-form-item label="API 协议 api" required>
          <el-select v-model="form.api" style="width: 100%">
            <el-option v-for="api in apiOptions" :key="api" :label="api" :value="api" />
          </el-select>
          <div class="hint">只列出本机内核实现的方言；其余会以明确报错拒绝。</div>
        </el-form-item>
        <el-form-item label="显示名称 name">
          <el-input v-model="form.name" placeholder="留空则使用模型 ID" />
        </el-form-item>
      </div>

      <el-form-item label="Base URL baseUrl" required>
        <el-input v-model="form.baseUrl" placeholder="例如 https://api.openai.com/v1" />
      </el-form-item>

      <el-form-item label="API Key apiKey">
        <el-input
          v-model="form.apiKey"
          type="password"
          show-password
          :placeholder="keyPlaceholder"
        />
        <div class="hint">
          密钥加密保存在本机（不进工作区、不进 .prototype-agent.json）。
          <template v-if="selectedEntry?.hasApiKey">
            留空 = 保持已存的那把。
            <el-checkbox v-model="form.clearApiKey" size="small" style="margin-left: 6px">
              清除已存密钥
            </el-checkbox>
          </template>
        </div>
      </el-form-item>

      <div class="grid-2">
        <el-form-item label="允许的思考档位">
          <el-select
            v-model="form.thinkingLevels"
            multiple
            style="width: 100%"
            placeholder="不选则只有 off"
          >
            <el-option v-for="lv in thinkingVocabulary" :key="lv" :label="lv" :value="lv" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认档位">
          <el-select v-model="form.defaultThinkingLevel" clearable placeholder="使用 off" style="width: 100%">
            <el-option v-for="lv in form.thinkingLevels" :key="lv" :label="lv" :value="lv" />
          </el-select>
        </el-form-item>
      </div>

      <el-collapse class="advanced">
        <el-collapse-item title="高级：模型能力与 Agent 参数" name="advanced">
          <div class="grid-3">
            <el-form-item label="支持推理 reasoning">
              <el-switch v-model="form.reasoning" />
            </el-form-item>
            <el-form-item label="支持图片输入">
              <el-switch v-model="form.supportsImages" />
            </el-form-item>
            <el-form-item label="上下文窗口">
              <el-input-number v-model="form.contextWindow" :min="0" :step="1000" controls-position="right" />
            </el-form-item>
          </div>

          <div class="grid-3">
            <el-form-item label="最大输出 tokens">
              <el-input-number v-model="form.maxTokens" :min="0" :step="1024" controls-position="right" />
            </el-form-item>
            <el-form-item label="最大轮次 maxTurns">
              <el-input-number v-model="form.maxTurns" :min="1" :step="1" controls-position="right" />
            </el-form-item>
            <el-form-item label="温度 temperature">
              <el-input-number
                v-model="form.temperature"
                :min="0"
                :max="2"
                :step="0.1"
                controls-position="right"
              />
            </el-form-item>
          </div>

          <el-form-item label="请求超时 requestTimeoutMs">
            <el-input-number
              v-model="form.requestTimeoutMs"
              :min="1000"
              :step="5000"
              controls-position="right"
            />
          </el-form-item>

          <el-form-item label="系统提示词 systemPrompt">
            <el-input
              v-model="form.systemPrompt"
              type="textarea"
              :rows="4"
              placeholder="留空则使用内置的原型编辑提示词"
            />
          </el-form-item>
        </el-collapse-item>
      </el-collapse>
    </el-form>

    <!-- Agent 可调用的业务工具 -->
    <div class="tools">
      <div class="tools-title">Agent 可调用的业务工具（{{ tools.length }}）</div>
      <div class="tool-list">
        <span v-for="tool in tools" :key="tool.name" class="tool-chip" :title="tool.description">
          {{ tool.name }}
          <em>{{ tool.effect }}</em>
        </span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="save-path" v-if="configPath">保存至 {{ configPath }}</span>
        <el-button
          v-if="selectedEntry"
          type="danger"
          text
          :loading="deleting"
          @click="handleDelete"
        >
          从模型库删除
        </el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canSave" @click="handleSave">
          保存配置
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAgentModelConfig, type AgentModelView } from '../composables/useAgentModelConfig'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', info: { configured: boolean }): void
  (e: 'closed'): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const form = reactive({
  provider: '',
  id: '',
  name: '',
  api: '',
  baseUrl: '',
  apiKey: '',
  clearApiKey: false,
  reasoning: false,
  supportsImages: false,
  contextWindow: undefined as number | undefined,
  maxTokens: undefined as number | undefined,
  thinkingLevels: [] as string[],
  defaultThinkingLevel: '',
  systemPrompt: '',
  maxTurns: undefined as number | undefined,
  temperature: undefined as number | undefined,
  thinkingLevel: '',
  requestTimeoutMs: undefined as number | undefined
})

const modelConfig = useAgentModelConfig()

// 词汇表（api 方言 / 思考档位 / 默认值）只有主进程那一份，这里只渲染。
const apiOptions = computed(() => modelConfig.vocabularies.value.apiOptions)
const thinkingVocabulary = computed(() => modelConfig.vocabularies.value.thinkingVocabulary)

// 模型库走共享 composable：输入区的下拉读的是同一份，弹窗里刷新过它也就跟着新。
// selectionId 仍按弹窗自己的待保存状态推导 —— 选中模型后直接改共享状态的话，
// 用户点「取消」也会把输入区改掉。
const models = modelConfig.models
const groupedModels = modelConfig.groupedModels
const selectionId = ref('')
const tools = ref<{ name: string; description: string; effect: string }[]>([])
const runtimePath = ref('')
interface ReadinessItem {
  label: string
  ok: boolean
  detail: string
}
const readiness = ref<ReadinessItem[]>([])
const configPath = ref('')
const libraryPath = computed(() => modelConfig.libraryPath.value)
const problem = computed(() => modelConfig.problem.value)
const keyStoreEncrypted = computed(() => modelConfig.keyStoreEncrypted.value)
const envLocked = ref(false)
const loading = ref(false)
const checking = ref(false)
const saving = ref(false)
const deleting = ref(false)
const runtimeOk = ref<boolean | null>(null)
const runtimeVersion = ref('')
const runtimeError = ref('')

/** 表单里当前载入/保存的那条库记录（新建时为空）。 */
const selectedEntry = computed<AgentModelView | undefined>(() =>
  models.value.find((m) => m.selectionId === selectionId.value)
)

const keyPlaceholder = computed(() =>
  selectedEntry.value?.hasApiKey
    ? '已保存（留空则不变）'
    : '粘贴 API Key；留空表示由环境变量 PROTOTYPE_AGENT_API_KEY 提供'
)

const canSave = computed(() =>
  Boolean(form.provider.trim() && form.id.trim() && form.api && form.baseUrl.trim())
)

const statusClass = computed(() => {
  if (runtimeOk.value === null) return 'dot-idle'
  return runtimeOk.value ? 'dot-ok' : 'dot-error'
})

const statusText = computed(() => {
  if (runtimeOk.value === null) return '尚未检测 thunder-runtime'
  if (runtimeOk.value) return `thunder-runtime 就绪（协议 v${runtimeVersion.value}）`
  return `thunder-runtime 不可用：${runtimeError.value}`
})

// immediate：万一将来有人把它挂进 v-if（挂载时 visible 已经是 true），
// 不 fire 的 watch 会让弹窗永远停在「尚未检测」。今天父组件是常驻挂载，
// 这一条只是把那个坑堵死。
watch(
  () => props.visible,
  (open) => {
    if (open) void load()
  },
  { immediate: true }
)

async function load() {
  if (!window.agent?.getConfig) {
    runtimeError.value = 'agent 桥接不可用'
    runtimeOk.value = false
    return
  }

  loading.value = true
  try {
    // 模型库走共享 composable（输入区的下拉读同一份），这里只取表单要用的字段
    await modelConfig.refresh()

    const res = await window.agent.getConfig()
    runtimePath.value = res.runtimePath ?? ''
    readiness.value = res.readiness ?? []
    configPath.value = res.path ?? ''
    envLocked.value = Boolean(res.envLocked)
    tools.value = res.tools ?? []

    // 表单载入当前生效的那个模型；没有就用库里的第一个可用项，再没有就留空
    // 让人新建。
    const stored = res.config?.model as { provider?: string; id?: string } | undefined
    const entry =
      byRef(stored) ?? byRef(res.defaultModel) ?? undefined

    fillForm(entry, res)

    void handleCheck()
  } finally {
    loading.value = false
  }
}

/** 把库记录 + 配置里的 tuning 一起填进表单。 */
function fillForm(entry: AgentModelView | undefined, res: Awaited<ReturnType<typeof window.agent.getConfig>>) {
  const defaults = modelConfig.vocabularies.value.defaults

  selectionId.value = entry?.selectionId ?? ''
  form.provider = entry?.provider ?? ''
  form.id = entry?.id ?? ''
  form.name = entry?.name ?? ''
  form.api = entry?.api ?? apiOptions.value[0] ?? ''
  form.baseUrl = entry?.baseUrl ?? ''
  form.reasoning = Boolean(entry?.reasoning)
  form.supportsImages = Boolean(entry?.input?.includes('image'))
  form.thinkingLevels = entry?.thinkingLevels?.length
    ? [...entry.thinkingLevels]
    : [...defaults.thinkingLevels]
  form.defaultThinkingLevel = entry?.defaultThinkingLevel ?? ''
  form.contextWindow = entry?.contextWindow ?? defaults.contextWindow ?? undefined
  form.maxTokens = entry?.maxTokens ?? defaults.maxTokens ?? undefined

  // 密钥永远不显示：留空 = 保留已存的那把。
  form.apiKey = ''
  form.clearApiKey = false

  form.systemPrompt = res.config?.systemPrompt ?? ''
  form.maxTurns = res.config?.maxTurns
  form.temperature = res.config?.temperature
  form.thinkingLevel = res.config?.thinkingLevel ?? ''
  form.requestTimeoutMs = res.config?.requestTimeoutMs
}

/** 按 provider+id 找库里的那条（id 里可能有 `/`，所以不拆 selectionId）。 */
function byRef(ref?: { provider?: string; id?: string } | null): AgentModelView | undefined {
  if (!ref?.provider || !ref?.id) return undefined
  return models.value.find((m) => m.provider === ref.provider && m.id === ref.id)
}

/** 把已存的一条库记录载入表单（改它，或拿它做模板）。 */
function handleSelectModel(value: string) {
  if (!value) return
  const entry = models.value.find((m) => m.selectionId === value)
  if (!entry) return
  // 只换模型相关的字段；tuning（提示词 / 轮次 / 温度）留在用户手上
  form.provider = entry.provider
  form.id = entry.id
  form.name = entry.name
  form.api = entry.api
  form.baseUrl = entry.baseUrl
  form.reasoning = entry.reasoning
  form.supportsImages = Boolean(entry.input?.includes('image'))
  form.thinkingLevels = entry.thinkingLevels?.length
    ? [...entry.thinkingLevels]
    : form.thinkingLevels
  form.defaultThinkingLevel = entry.defaultThinkingLevel ?? ''
  form.contextWindow = entry.contextWindow
  form.maxTokens = entry.maxTokens
  form.apiKey = ''
  form.clearApiKey = false
  if (!entry.thinkingLevels?.includes(form.thinkingLevel)) {
    form.thinkingLevel = entry.defaultThinkingLevel || ''
  }
}

/** 清空模型字段，保留 tuning：新建一条库记录。 */
function startNew() {
  const defaults = modelConfig.vocabularies.value.defaults
  selectionId.value = ''
  form.provider = ''
  form.id = ''
  form.name = ''
  form.api = apiOptions.value[0] ?? ''
  form.baseUrl = ''
  form.apiKey = ''
  form.clearApiKey = false
  form.reasoning = false
  form.supportsImages = false
  form.thinkingLevels = [...defaults.thinkingLevels]
  form.defaultThinkingLevel = ''
  form.contextWindow = defaults.contextWindow || undefined
  form.maxTokens = defaults.maxTokens || undefined
}

async function handleCheck() {
  if (!window.agent?.ping) return
  checking.value = true
  try {
    const res = await window.agent.ping()
    runtimeOk.value = Boolean(res?.ok)
    runtimeVersion.value = res?.version ?? ''
    runtimeError.value = res?.error ?? ''
    if (res?.runtimePath) runtimePath.value = res.runtimePath
    if (res?.readiness) readiness.value = res.readiness
  } catch (err: any) {
    runtimeOk.value = false
    runtimeError.value = err?.message ?? String(err)
  } finally {
    checking.value = false
  }
}

async function handleSave() {
  if (!window.agent?.setConfig || !window.agent?.saveModel) {
    ElMessage.error('agent 桥接不可用，无法保存')
    return
  }
  if (!canSave.value) {
    ElMessage.warning('请填写 provider / id / api / baseUrl')
    return
  }

  saving.value = true
  try {
    // 1) 先把模型写进模型库（端点进 providers.json，密钥进加密存储）
    const saved = await window.agent.saveModel({
      provider: form.provider.trim(),
      id: form.id.trim(),
      name: form.name.trim() || form.id.trim(),
      api: form.api,
      baseUrl: form.baseUrl.trim(),
      reasoning: form.reasoning || undefined,
      input: form.supportsImages ? ['text', 'image'] : undefined,
      contextWindow: form.contextWindow || undefined,
      maxTokens: form.maxTokens || undefined,
      thinkingLevels: form.thinkingLevels.length ? form.thinkingLevels : undefined,
      defaultThinkingLevel: form.defaultThinkingLevel || undefined,
      apiKey: form.apiKey.trim() || undefined,
      clearApiKey: form.clearApiKey || undefined
    })
    if (!saved?.ok) {
      ElMessage.error(`保存模型失败：${saved?.error ?? '未知错误'}`)
      return
    }

    // 2) 再把「选它」和 tuning 写进工作区配置（只留 {provider, id} 引用）
    const res = await window.agent.setConfig({
      systemPrompt: form.systemPrompt.trim() || undefined,
      maxTurns: form.maxTurns || undefined,
      temperature: form.temperature,
      thinkingLevel: form.thinkingLevel || undefined,
      requestTimeoutMs: form.requestTimeoutMs || undefined,
      model: {
        provider: form.provider.trim(),
        id: form.id.trim(),
        name: form.name.trim() || form.id.trim()
      }
    })
    if (!res?.ok) {
      ElMessage.error(`保存失败：${res?.error ?? '未知错误'}`)
      return
    }

    configPath.value = res.path ?? configPath.value
    // 输入区的两个下拉读的是同一份共享状态，保存完立刻让它跟上
    await modelConfig.refresh()
    ElMessage.success('模型配置已保存')
    emit('saved', { configured: true })
    visible.value = false
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  const entry = selectedEntry.value
  if (!entry || !window.agent?.deleteModel) return

  try {
    await ElMessageBox.confirm(
      `从模型库删除 ${entry.selectionId}？` +
        (!entry.available ? '' : '它的密钥也会一起删除。'),
      '删除模型',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }

  deleting.value = true
  try {
    const res = await window.agent.deleteModel({ provider: entry.provider, id: entry.id })
    if (!res?.ok) {
      ElMessage.error(`删除失败：${res?.error ?? '未知错误'}`)
      return
    }
    await modelConfig.refresh()
    // 删掉的那条正是表单里载入的 → 表单退回新建态（无论是当前选中项还是别的）
    startNew()
    if (res.clearedSelection) ElMessage.info('被删除的正是当前选中的模型，选择已清空')
    ElMessage.success('已从模型库删除')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #606266;
}

.status-text {
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #c0c4cc;
}

.dot-ok {
  background-color: #67c23a;
}

.dot-error {
  background-color: #f56c6c;
}

.status-path {
  margin: 4px 0 12px 16px;
  font-size: 11px;
  color: #a8abb2;
  word-break: break-all;
}

.readiness {
  margin: 4px 0 12px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.readiness-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
}

.readiness-mark {
  width: 10px;
  flex: none;
  font-weight: 600;
}

.readiness-mark.ok {
  color: #67c23a;
}

.readiness-mark.bad {
  color: #f56c6c;
}

.readiness-label {
  flex: none;
  color: #606266;
}

/* 路径通常很长：允许省略，完整值仍在 title 里 */
.readiness-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #a8abb2;
}

.source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.source-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.settings-form {
  margin-top: 4px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 16px;
}

.advanced {
  margin-bottom: 8px;
}

.hint {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.7;
}

.tools {
  border-top: 1px solid #ebeef5;
  padding-top: 10px;
}

.tools-title {
  font-size: 12px;
  color: #606266;
  margin-bottom: 6px;
}

.tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  background-color: #f4f4f5;
  font-size: 11px;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: help;
}

.tool-chip em {
  font-style: normal;
  color: #909399;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.save-path {
  margin-right: auto;
  font-size: 11px;
  color: #a8abb2;
  word-break: break-all;
}
</style>
