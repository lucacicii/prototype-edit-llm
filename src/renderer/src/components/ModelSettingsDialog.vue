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
    <div class="status-path" v-if="runtimePath">{{ runtimePath }}</div>

    <el-alert
      v-if="envLocked"
      type="warning"
      :closable="false"
      show-icon
      title="环境变量 PROTOTYPE_AGENT_MODEL 正在覆盖此配置，保存后下次启动仍以环境变量为准。"
      style="margin-bottom: 12px;"
    />

    <!-- 模型来源切换 -->
    <div class="source-head">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button label="thunder">
          从 .thunder 选择（{{ models.length }}）
        </el-radio-button>
        <el-radio-button label="manual">手动填写</el-radio-button>
      </el-radio-group>
      <el-button
        v-if="mode === 'thunder'"
        size="small"
        text
        type="primary"
        :loading="loading"
        @click="load"
      >
        刷新列表
      </el-button>
    </div>
    <div class="status-path" v-if="mode === 'thunder'">
      {{ models.length ? `读取自 ${modelSources.join(' , ')}` : '未在 .thunder 中找到任何模型配置' }}
    </div>

    <!-- 模式一：从 .thunder 目录选择 -->
    <template v-if="mode === 'thunder'">
      <el-alert
        v-if="!models.length"
        type="info"
        :closable="false"
        show-icon
        title="没有读到模型。请确认 ~/.thunder/models.json 存在，或切到「手动填写」。"
        style="margin-bottom: 12px;"
      />

      <el-form label-position="top" class="settings-form">
        <el-form-item label="模型（来自 ~/.thunder）" required>
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
                :disabled="!item.available"
                :label="item.label"
              />
            </el-option-group>
          </el-select>
        </el-form-item>

        <div class="summary" v-if="selectedModel">
          <div class="summary-row">
            <span class="k">api</span><span class="v">{{ selectedModel.api }}</span>
            <span class="k">baseUrl</span><span class="v">{{ selectedModel.baseUrl || '未配置' }}</span>
          </div>
          <div class="summary-row">
            <span class="k">密钥</span>
            <span class="v" :class="selectedModel.hasApiKey ? 'ok' : 'warn'">
              {{ selectedModel.hasApiKey ? '来自 .thunder' : '缺失（models.json / auth.json 均未提供）' }}
            </span>
            <span class="k">上下文</span><span class="v">{{ selectedModel.contextWindow.toLocaleString() }}</span>
          </div>
          <div class="summary-row">
            <span class="k">推理</span><span class="v">{{ selectedModel.reasoning ? '支持' : '不支持' }}</span>
            <span class="k">最大输出</span><span class="v">{{ selectedModel.maxTokens.toLocaleString() }}</span>
          </div>
        </div>

        <el-form-item label="思考档位 thinkingLevel" v-if="selectedModel">
          <el-select v-model="form.thinkingLevel" clearable placeholder="使用模型默认" style="width: 220px">
            <el-option v-for="lv in thinkingOptions" :key="lv" :label="lv" :value="lv" />
          </el-select>
          <span class="hint" v-if="selectedModel.defaultThinkingLevel">
            默认 {{ selectedModel.defaultThinkingLevel }}
          </span>
        </el-form-item>
      </el-form>
    </template>

    <!-- 模式二：手动填写完整模型（thunder 不认识的网关） -->
    <template v-else>
      <el-form label-position="top" :model="form" class="settings-form">
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
              <el-option
                v-for="item in API_OPTIONS"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
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
            placeholder="留空表示由网关/环境变量提供"
          />
          <div class="hint">手动模式会把密钥写进工作区 .prototype-agent.json（已 gitignore）。</div>
        </el-form-item>
      </el-form>
    </template>

    <!-- 两种模式共用的 Agent 参数 -->
    <el-collapse class="advanced">
      <el-collapse-item title="高级：模型能力与 Agent 参数" name="advanced">
        <div class="grid-3">
          <el-form-item label="支持推理 reasoning">
            <el-switch v-model="form.reasoning" />
          </el-form-item>
          <el-form-item label="上下文窗口">
            <el-input-number v-model="form.contextWindow" :min="0" :step="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="最大输出 tokens">
            <el-input-number v-model="form.maxTokens" :min="0" :step="1024" controls-position="right" />
          </el-form-item>
        </div>

        <div class="grid-3">
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
          <el-form-item label="请求超时 requestTimeoutMs">
            <el-input-number
              v-model="form.requestTimeoutMs"
              :min="1000"
              :step="5000"
              controls-position="right"
            />
          </el-form-item>
        </div>

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
import { ElMessage } from 'element-plus'
import {
  useAgentModelConfig,
  DEFAULT_THINKING_LEVELS,
  type ThunderModelView
} from '../composables/useAgentModelConfig'

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

const API_OPTIONS = [
  { label: 'openai-completions', value: 'openai-completions' },
  { label: 'openai-responses', value: 'openai-responses' },
  { label: 'anthropic-messages', value: 'anthropic-messages' },
  { label: 'google-generative-ai', value: 'google-generative-ai' }
]

const form = reactive({
  provider: '',
  id: '',
  name: '',
  api: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  reasoning: false,
  contextWindow: undefined as number | undefined,
  maxTokens: undefined as number | undefined,
  systemPrompt: '',
  maxTurns: undefined as number | undefined,
  temperature: undefined as number | undefined,
  thinkingLevel: '',
  requestTimeoutMs: undefined as number | undefined
})

const modelConfig = useAgentModelConfig()

const mode = ref<'thunder' | 'manual'>('thunder')
// 模型目录走共享 composable：输入区的下拉读的是同一份，弹窗里刷新过它也就跟着新。
// selectionId / selectedModel / thinkingOptions 仍按弹窗自己的待保存状态推导 ——
// 选中模型后直接改共享状态的话，用户点「取消」也会把输入区改掉。
const models = modelConfig.models
const modelSources = modelConfig.modelSources
const groupedModels = modelConfig.groupedModels
const selectionId = ref('')
const tools = ref<{ name: string; description: string; effect: string }[]>([])
const runtimePath = ref('')
const configPath = ref('')
const envLocked = ref(false)
const loading = ref(false)
const checking = ref(false)
const saving = ref(false)
const runtimeOk = ref<boolean | null>(null)
const runtimeVersion = ref('')
const runtimeError = ref('')

const selectedModel = computed(() =>
  models.value.find((m) => m.selectionId === selectionId.value)
)

const thinkingOptions = computed(() =>
  mode.value === 'thunder'
    ? selectedModel.value?.thinkingLevels?.length
      ? selectedModel.value.thinkingLevels
      : DEFAULT_THINKING_LEVELS
    : DEFAULT_THINKING_LEVELS
)

const canSave = computed(() => {
  if (mode.value === 'thunder') return Boolean(selectedModel.value)
  return Boolean(form.provider.trim() && form.id.trim() && form.api && form.baseUrl.trim())
})

const statusClass = computed(() => {
  if (runtimeOk.value === null) return 'dot-idle'
  return runtimeOk.value ? 'dot-ok' : 'dot-error'
})

const statusText = computed(() => {
  if (runtimeOk.value === null) return '尚未检测 thunder-runtime'
  if (runtimeOk.value) return `thunder-runtime 就绪（协议 v${runtimeVersion.value}）`
  return `thunder-runtime 不可用：${runtimeError.value}`
})

watch(
  () => props.visible,
  (open) => {
    if (open) void load()
  }
)

async function load() {
  if (!window.agent?.getConfig) {
    runtimeError.value = 'agent 桥接不可用'
    runtimeOk.value = false
    return
  }

  loading.value = true
  try {
    // 目录走共享 composable（输入区的下拉读同一份），这里只取表单要用的字段
    await modelConfig.refresh()

    const res = await window.agent.getConfig()
    runtimePath.value = res.runtimePath ?? ''
    configPath.value = res.path ?? ''
    envLocked.value = Boolean(res.envLocked)
    tools.value = res.tools ?? []

    const model = res.config?.model as
      | { provider?: string; id?: string; name?: string; api?: string; baseUrl?: string; apiKey?: string }
      | undefined

    form.provider = model?.provider ?? ''
    form.id = model?.id ?? ''
    form.name = model?.name ?? ''
    form.api = model?.api || 'openai-completions'
    form.baseUrl = model?.baseUrl ?? ''
    form.apiKey = model?.apiKey ?? ''
    form.reasoning = Boolean((model as any)?.reasoning)
    form.contextWindow = (model as any)?.contextWindow
    form.maxTokens = (model as any)?.maxTokens
    form.systemPrompt = res.config?.systemPrompt ?? ''
    form.maxTurns = res.config?.maxTurns
    form.temperature = res.config?.temperature
    form.thinkingLevel = res.config?.thinkingLevel ?? ''
    form.requestTimeoutMs = res.config?.requestTimeoutMs

    // A stored model carrying its own endpoint is a manual one; anything else
    // is a reference we resolve against the catalog.
    const isManual = Boolean(model?.api && model?.baseUrl)
    if (isManual || models.value.length === 0) {
      mode.value = 'manual'
    } else {
      mode.value = 'thunder'
      const match = models.value.find((m) => m.provider === model?.provider && m.id === model?.id)
      selectionId.value = match?.selectionId ?? findSelection(res.defaultModel)
      // Keep the stored thinkingLevel instead of the model's default.
      applyModelDefaults(selectedModel.value, false)
    }

    void handleCheck()
  } finally {
    loading.value = false
  }
}

function findSelection(ref?: { provider: string; id: string } | null): string {
  if (!ref) return ''
  return models.value.find((m) => m.provider === ref.provider && m.id === ref.id)?.selectionId ?? ''
}

/** Copy a catalog entry into the form, so manual mode can start from it. */
function applyModelDefaults(entry?: ThunderModelView, setThinking = true) {
  if (!entry) return
  form.provider = entry.provider
  form.id = entry.id
  form.name = entry.name
  form.api = entry.api
  form.baseUrl = entry.baseUrl
  form.reasoning = entry.reasoning
  form.contextWindow = entry.contextWindow
  form.maxTokens = entry.maxTokens
  if (setThinking && entry.defaultThinkingLevel) {
    form.thinkingLevel = entry.defaultThinkingLevel
  }
}

function handleSelectModel(value: string) {
  if (!value) return
  applyModelDefaults(selectedModel.value)
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
  } catch (err: any) {
    runtimeOk.value = false
    runtimeError.value = err?.message ?? String(err)
  } finally {
    checking.value = false
  }
}

async function handleSave() {
  if (!window.agent?.setConfig) {
    ElMessage.error('agent 桥接不可用，无法保存')
    return
  }
  if (!canSave.value) {
    ElMessage.warning(mode.value === 'thunder' ? '请先选择一个模型' : '请填写 provider / id / api / baseUrl')
    return
  }

  saving.value = true
  try {
    const tuning = {
      systemPrompt: form.systemPrompt.trim() || undefined,
      maxTurns: form.maxTurns || undefined,
      temperature: form.temperature,
      thinkingLevel: form.thinkingLevel || undefined,
      requestTimeoutMs: form.requestTimeoutMs || undefined
    }

    // A catalog pick is stored as a reference: no endpoint, and no secret, in
    // the workspace file.
    const model =
      mode.value === 'thunder' && selectedModel.value
        ? {
            provider: selectedModel.value.provider,
            id: selectedModel.value.id,
            name: selectedModel.value.name
          }
        : {
            provider: form.provider.trim(),
            id: form.id.trim(),
            name: form.name.trim() || form.id.trim(),
            api: form.api,
            baseUrl: form.baseUrl.trim(),
            apiKey: form.apiKey.trim() || undefined,
            reasoning: form.reasoning || undefined,
            contextWindow: form.contextWindow || undefined,
            maxTokens: form.maxTokens || undefined
          }

    const res = await window.agent.setConfig({ model, ...tuning })
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

.source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.summary-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.9;
}

.summary .k {
  color: #909399;
  min-width: 48px;
}

.summary .v {
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-right: 16px;
  word-break: break-all;
}

.summary .ok {
  color: #67c23a;
}

.summary .warn {
  color: #e6a23c;
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
