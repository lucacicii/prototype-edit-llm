<template>
  <el-dialog
    v-model="visible"
    title="添加服务商"
    width="480px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="resultError"
      type="error"
      :closable="false"
      show-icon
      :title="resultError"
      style="margin-bottom: 12px"
    />

    <!-- 预设：把 api 方言和 baseUrl 这两个最容易打错的字段填好。选完仍可改。 -->
    <div class="settings-field-label">预设</div>
    <div class="preset-row">
      <button
        v-for="item in presets"
        :key="item.key"
        type="button"
        class="preset-chip"
        :class="{ active: presetKey === item.key }"
        @click="applyPreset(item)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="settings-hint" v-if="activePreset?.note">
      {{ activePreset.note }}。以下数值是可改的初值。
    </div>

    <el-form label-position="top" :model="form" style="margin-top: 12px">
      <div class="settings-grid">
        <el-form-item label="服务商标识 provider" required>
          <el-input v-model="form.provider" placeholder="例如 openai / deepseek" />
        </el-form-item>
        <el-form-item label="API 协议 api" required>
          <el-select v-model="form.api" style="width: 100%" placeholder="选择方言">
            <el-option v-for="api in apiOptions" :key="api" :label="api" :value="api" />
          </el-select>
        </el-form-item>
      </div>

      <el-alert
        v-if="duplicateProvider"
        type="info"
        :closable="false"
        show-icon
        :title="`服务商「${form.provider.trim()}」已存在。要给它加模型，请从左侧选中它再点「添加模型」；要接另一个网关，请换一个标识。`"
        style="margin-bottom: 12px"
      />

      <el-form-item label="Base URL baseUrl" required>
        <el-input v-model="form.baseUrl" placeholder="例如 https://api.deepseek.com/v1" />
        <div class="settings-hint">内核支持的方言：{{ apiOptions.join(' / ') || '（读取中）' }}</div>
      </el-form-item>

      <el-form-item label="API Key apiKey">
        <el-input v-model="form.apiKey" type="password" show-password placeholder="粘贴密钥" />
        <div class="settings-hint">
          密钥加密保存在本机，不进工作区、不进 .prototype-agent.json。留空也可以 —— 那就由环境变量
          PROTOTYPE_AGENT_API_KEY 提供。
        </div>
      </el-form-item>

      <el-divider style="margin: 4px 0 14px" />

      <!-- 服务商是从模型库派生出来的，所以它至少得有一个模型。这就是这张表单必须
           一起收下第一个模型 ID 的原因。 -->
      <div class="settings-grid">
        <el-form-item label="首个模型 ID" required>
          <el-input v-model="form.modelId" :placeholder="modelPlaceholder" />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="form.modelName" placeholder="留空则直接显示模型 ID" />
        </el-form-item>
      </div>
      <div class="settings-footnote" style="margin-top: -6px">
        服务商在你本机就是「共享同一个标识的那组模型」，所以新建服务商必须同时给出第一个模型
        —— 没有模型的服务商在这里是不存在的。
      </div>

      <el-checkbox v-model="form.selectAsCurrent" :disabled="envLocked" style="margin-top: 14px">
        同时设为当前模型
        <span v-if="envLocked" class="settings-footnote">（环境变量正在覆盖配置，无法改动）</span>
      </el-checkbox>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSave" @click="handleSave">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  emptyDraft,
  useModelLibrary,
  type ModelDraft
} from '../../composables/useModelLibrary'
import { useAgentModelConfig } from '../../composables/useAgentModelConfig'
import { CUSTOM_PRESET_KEY, presetsFor, type ProviderPreset } from './provider-presets'

const props = defineProps<{
  visible: boolean
  /** 库里已有的服务商标识，用来在客户端先给一次重名提示。 */
  existingProviders: string[]
  apiOptions: string[]
  thinkingVocabulary: string[]
  defaults: { contextWindow: number; maxTokens: number; thinkingLevels: string[] }
  envLocked: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'created', provider: string): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const modelConfig = useAgentModelConfig()
const library = useModelLibrary()

const presets = computed(() => presetsFor(props.apiOptions))
const presetKey = ref(CUSTOM_PRESET_KEY)
const activePreset = computed(() => presets.value.find((p) => p.key === presetKey.value))

const form = reactive({
  provider: '',
  api: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  modelName: '',
  selectAsCurrent: true
})

const saving = ref(false)
const resultError = ref('')

const modelPlaceholder = computed(
  () => activePreset.value?.modelHint || '例如 gpt-4o / deepseek-chat'
)

const duplicateProvider = computed(
  () => Boolean(form.provider.trim()) && props.existingProviders.includes(form.provider.trim())
)

const canSave = computed(
  () =>
    Boolean(form.provider.trim()) &&
    Boolean(form.api) &&
    Boolean(form.baseUrl.trim()) &&
    Boolean(form.modelId.trim())
)

function applyPreset(preset: ProviderPreset) {
  presetKey.value = preset.key
  form.provider = preset.providerId
  form.api = preset.api || props.apiOptions[0] || ''
  form.baseUrl = preset.baseUrl
}

function reset() {
  resultError.value = ''
  form.apiKey = ''
  form.modelId = ''
  form.modelName = ''
  form.selectAsCurrent = true
  // 默认选第一个可用预设：表单立刻可用，并且预设那排 chip 会显示当前选中哪一个。
  const first = presets.value[0]
  if (first) applyPreset(first)
  else {
    presetKey.value = CUSTOM_PRESET_KEY
    form.provider = ''
    form.api = props.apiOptions[0] ?? ''
    form.baseUrl = ''
  }
}

watch(
  () => props.visible,
  (open) => {
    if (open) reset()
  },
  { immediate: true }
)

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  resultError.value = ''
  try {
    // 服务商不是独立实体，落库就是落它的第一个模型。
    const draft: ModelDraft = {
      ...emptyDraft(form.api, form.baseUrl, props.defaults),
      id: form.modelId.trim(),
      name: form.modelName.trim(),
      reasoning: false
    }
    draft.apiKey = form.apiKey.trim()

    const res = await library.saveModelEntry(form.provider.trim(), draft)
    if (!res.ok) {
      // 失败就留在对话框里，用户填的内容不清掉。
      resultError.value = res.error ?? '保存失败'
      return
    }

    const provider = form.provider.trim()
    if (form.selectAsCurrent && !props.envLocked) {
      await modelConfig.selectModel(`${provider}/${draft.id}`)
    }
    ElMessage.success(`已添加服务商 ${provider}`)
    emit('created', provider)
    visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  color: #606266;
  background: #f4f4f5;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 140ms ease-out, color 140ms ease-out;
}

.preset-chip:hover {
  color: #303133;
  background: #ebeef5;
}

.preset-chip.active {
  color: #409eff;
  border-color: #b3d8ff;
  background: #ecf5ff;
}
</style>
