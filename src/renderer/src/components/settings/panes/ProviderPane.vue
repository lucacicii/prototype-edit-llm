<template>
  <header class="settings-content-header">
    <div>
      <h2 class="settings-pane-title">{{ pane.label }}</h2>
      <p class="settings-pane-desc">{{ pane.desc }}</p>
    </div>
    <div class="settings-header-actions">
      <span class="settings-footnote">
        {{ providers.length }} 个服务商 · {{ models.length }} 个模型
      </span>
      <el-button size="small" text type="primary" :loading="refreshing" @click="handleRefresh">
        刷新
      </el-button>
      <el-button size="small" type="primary" @click="addProviderVisible = true">
        添加服务商
      </el-button>
    </div>
  </header>

  <div class="settings-pane">
    <!-- 空库：没有服务商可列，直接给一条明确的出路 -->
    <div class="settings-pane-body" v-if="!providers.length">
      <div class="settings-group">
        <div class="settings-empty">
          <div class="settings-empty-title">还没有任何服务商</div>
          <div class="settings-footnote">
            一个服务商 = 一个网关（API 协议 + Base URL）+ 一把密钥，可以挂多个模型。
            模型库保存在 {{ libraryPath || 'providers.json' }}，密钥不出本机。
          </div>
          <el-button type="primary" @click="addProviderVisible = true">添加服务商</el-button>
        </div>
      </div>
    </div>

    <div class="settings-pane-body settings-pane-body--split" v-else>
      <!-- 左：服务商列表 -->
      <aside class="settings-split-aside">
        <div
          v-for="group in providers"
          :key="group.provider"
          class="settings-provider-item"
          :class="{ active: group.provider === activeProvider }"
        >
          <button type="button" class="settings-provider-main" @click="activeProvider = group.provider">
            <span class="settings-provider-top">
              <span class="settings-dot" :class="dotClass(group)"></span>
              <span class="settings-provider-name">{{ group.provider }}</span>
            </span>
            <span class="settings-provider-meta" :title="group.baseUrl">{{ group.baseUrl || '（缺 baseUrl）' }}</span>
            <span class="settings-provider-meta">
              {{ group.api }} · {{ group.modelCount }} 个模型
            </span>
          </button>
          <button
            type="button"
            class="settings-provider-remove"
            title="删除服务商"
            @click.stop="confirmDeleteProvider(group)"
          >
            ✕
          </button>
        </div>
      </aside>

      <!-- 右：详情 -->
      <div class="settings-split-main" v-if="activeGroup">
        <div class="settings-group">
          <div class="settings-group-header">
            <h3 class="settings-group-title">服务商</h3>
            <div class="settings-group-actions">
              <el-button size="small" text type="danger" @click="confirmDeleteProvider(activeGroup)">
                删除服务商
              </el-button>
              <el-button
                size="small"
                type="primary"
                :loading="savingProvider"
                :disabled="!canSaveProvider"
                @click="saveProvider"
              >
                保存
              </el-button>
            </div>
          </div>
          <div class="settings-group-body">
            <el-alert
              v-if="activeGroup.endpointConflict"
              type="warning"
              :closable="false"
              show-icon
              title="这个服务商名下的模型端点不一致（api / baseUrl 不同）。一个服务商应该只有一个网关——保存一次即可把它们统一到下面填的值。"
            />
            <el-alert
              v-if="!apiSupported"
              type="warning"
              :closable="false"
              show-icon
              :title="`本机内核不支持 ${activeGroup.api} 方言（支持：${apiOptions.join(' / ')}）`"
            />

            <div class="settings-grid">
              <div>
                <label class="settings-field-label">服务商标识 provider</label>
                <el-input :model-value="activeGroup.provider" disabled />
                <div class="settings-hint">
                  创建后不可改名：密钥和当前选中的模型都按这个 id 存。要换标识请删除后重新添加。
                </div>
              </div>
              <div>
                <label class="settings-field-label">API 协议 api</label>
                <el-select v-model="apiDraft" style="width: 100%">
                  <el-option v-for="api in apiOptions" :key="api" :label="api" :value="api" />
                </el-select>
                <div class="settings-hint">只列出本机内核实现的方言；其余会以明确报错拒绝。</div>
              </div>
            </div>

            <div>
              <label class="settings-field-label">Base URL baseUrl</label>
              <el-input v-model="baseUrlDraft" placeholder="例如 https://api.deepseek.com/v1" />
            </div>

            <div>
              <label class="settings-field-label">API Key apiKey</label>
              <el-input
                v-model="apiKeyDraft"
                type="password"
                show-password
                :placeholder="keyPlaceholder"
              />
              <div class="settings-hint">
                一把密钥属于整个服务商，加密保存在本机（不进工作区、不进 .prototype-agent.json）。
                <template v-if="activeGroup.keySource === 'stored'">留空 = 保持已存的那把。</template>
                <template v-else-if="activeGroup.keySource === 'env'">
                  当前由环境变量 PROTOTYPE_AGENT_API_KEY 提供，所以这里留空也能用。
                </template>
                <el-checkbox
                  v-if="activeGroup.keySource === 'stored'"
                  v-model="clearApiKey"
                  size="small"
                  style="margin-left: 6px"
                >
                  清除已存密钥
                </el-checkbox>
              </div>
            </div>

            <div class="settings-footnote" v-if="activeGroup.modelCount > 1">
              保存会把 API 协议与 Base URL 写给这个服务商名下的全部
              {{ activeGroup.modelCount }} 个模型 —— 一个服务商就是一个网关。
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-header">
            <h3 class="settings-group-title">模型（{{ activeGroup.modelCount }}）</h3>
            <div class="settings-group-actions">
              <el-button size="small" type="primary" plain @click="openModelDialog()">
                添加模型
              </el-button>
            </div>
          </div>
          <div class="settings-group-body">
            <div class="settings-model-list">
              <div
                v-for="item in activeGroup.models"
                :key="item.selectionId"
                class="settings-model-row"
              >
                <div class="settings-model-head">
                  <span class="settings-model-name">{{ item.name }}</span>
                  <span class="settings-model-id" v-if="item.name !== item.id">{{ item.id }}</span>
                  <span
                    v-if="item.selectionId === currentSelectionId"
                    class="settings-badge settings-badge--current"
                  >
                    使用中
                  </span>
                  <span class="settings-badge">{{ formatContext(item.contextWindow) }}</span>
                  <span class="settings-badge" v-if="item.reasoning">推理</span>
                  <span class="settings-badge" v-if="item.input?.includes('image')">图片</span>
                  <!-- 不可用原因直接写出来，不用 tooltip 兜着 -->
                  <span class="settings-model-reason" v-if="!item.available">
                    {{ item.unavailableReason ?? '不可用' }}
                  </span>
                </div>
                <div class="settings-model-actions">
                  <el-button
                    size="small"
                    text
                    type="primary"
                    :disabled="envLocked || item.selectionId === currentSelectionId"
                    :title="envLocked ? '环境变量正在覆盖模型选择，改不了' : '把它设为当前使用的模型'"
                    @click="modelConfig.selectModel(item.selectionId)"
                  >
                    设为当前
                  </el-button>
                  <el-button size="small" text @click="openModelDialog(item)">编辑</el-button>
                  <el-button size="small" text type="danger" @click="confirmDeleteModel(item)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <AddProviderDialog
    v-model:visible="addProviderVisible"
    :existing-providers="providers.map((p) => p.provider)"
    :api-options="apiOptions"
    :thinking-vocabulary="thinkingVocabulary"
    :defaults="defaults"
    :env-locked="envLocked"
    @created="handleProviderCreated"
  />

  <el-dialog
    v-model="modelDialogVisible"
    :title="modelDialogTitle"
    width="560px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="modelError"
      type="error"
      :closable="false"
      show-icon
      :title="modelError"
      style="margin-bottom: 12px"
    />
    <ModelForm
      v-if="modelDraft"
      :draft="modelDraft"
      :provider="activeProvider"
      :thinking-vocabulary="thinkingVocabulary"
      :editing="Boolean(editingModelId)"
    />
    <template #footer>
      <el-button @click="modelDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="savingModel" :disabled="!canSaveModel" @click="saveModel">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts">
// 模块作用域：只在「本次运行里第一次进入且库是空的」自动弹出添加对话框。
// 用户取消过一次之后就不要再反复弹 —— 切到「通用」再切回来会重新挂载组件，
// 状态放组件里挡不住这件事。
let autoPrompted = false
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  useAgentModelConfig,
  type AgentModelView,
  type ProviderGroup
} from '../../../composables/useAgentModelConfig'
import {
  draftFrom,
  emptyDraft,
  useModelLibrary,
  type ModelDraft
} from '../../../composables/useModelLibrary'
import { SETTINGS_SECTIONS } from '../sections'
import AddProviderDialog from '../AddProviderDialog.vue'
import ModelForm from '../parts/ModelForm.vue'

const pane = SETTINGS_SECTIONS.find((item) => item.key === 'provider')!

const modelConfig = useAgentModelConfig()
const library = useModelLibrary()

const models = modelConfig.models
const providers = modelConfig.providers
const currentSelectionId = computed(() => modelConfig.selectionId.value)
const envLocked = modelConfig.envLocked
const libraryPath = computed(() => modelConfig.libraryPath.value)

const apiOptions = computed(() => modelConfig.vocabularies.value.apiOptions)
const thinkingVocabulary = computed(() => modelConfig.vocabularies.value.thinkingVocabulary)
const defaults = computed(() => modelConfig.vocabularies.value.defaults)

const activeProvider = ref('')
const addProviderVisible = ref(false)
const activeGroup = computed<ProviderGroup | undefined>(() =>
  providers.value.find((group) => group.provider === activeProvider.value)
)

// —— 服务商端点表单（草稿）——
const apiDraft = ref('')
const baseUrlDraft = ref('')
const apiKeyDraft = ref('')
const clearApiKey = ref(false)
const savingProvider = ref(false)
const refreshing = ref(false)

const apiSupported = computed(() => apiOptions.value.includes(activeGroup.value?.api ?? ''))
const canSaveProvider = computed(
  () => Boolean(apiDraft.value) && Boolean(baseUrlDraft.value.trim()) && !savingProvider.value
)
const keyPlaceholder = computed(() => {
  const source = activeGroup.value?.keySource
  if (source === 'stored') return '已保存（留空则不变）'
  if (source === 'env') return '由环境变量 PROTOTYPE_AGENT_API_KEY 提供'
  return '粘贴 API Key'
})

/** 列表行的状态点：全可用绿、全不可用红、部分可用琥珀。 */
function dotClass(group: ProviderGroup): string {
  if (!group.modelCount) return ''
  if (group.availableCount === group.modelCount) return 'settings-dot--ok'
  if (group.availableCount === 0) return 'settings-dot--bad'
  return 'settings-dot--partial'
}

function formatContext(value: number): string {
  if (!value) return '未知窗口'
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/**
 * 服务商集合或当前选中项一变，就把端点表单同步成磁盘上的真值。
 * 键里带上 api / baseUrl，所以保存成功后表单会回到「已保存」的样子。
 */
function syncEndpointForm() {
  const list = providers.value
  if (!list.some((group) => group.provider === activeProvider.value)) {
    activeProvider.value = list[0]?.provider ?? ''
  }
  const group = list.find((item) => item.provider === activeProvider.value)
  apiDraft.value = group?.api ?? ''
  baseUrlDraft.value = group?.baseUrl ?? ''
  apiKeyDraft.value = ''
  clearApiKey.value = false
}

watch(
  () => providers.value.map((g) => `${g.provider}:${g.api}:${g.baseUrl}`).join('\u0000'),
  syncEndpointForm,
  { immediate: true }
)
watch(activeProvider, syncEndpointForm)

/**
 * 第一次进来、而且库确实是空的：直接把添加对话框打开，别让用户对着空列表猜。
 *
 * 要等 `loaded` —— 组件挂载时 refresh() 可能还没回来，这时 models 也是空的，
 * 光看长度会把「有模型但没读完」误判成空库。`autoPrompted` 是模块级的，
 * 用户取消之后不再反复弹（切走再切回来会重新挂载组件）。
 */
watch(
  [() => modelConfig.loaded.value, () => models.value.length],
  ([loaded, count]) => {
    if (autoPrompted || !loaded || count > 0) return
    autoPrompted = true
    addProviderVisible.value = true
  },
  { immediate: true }
)

async function handleRefresh() {
  refreshing.value = true
  try {
    await modelConfig.refresh()
  } finally {
    refreshing.value = false
  }
}

function handleProviderCreated(provider: string) {
  activeProvider.value = provider
}

async function saveProvider() {
  const group = activeGroup.value
  if (!group || !canSaveProvider.value) return
  savingProvider.value = true
  try {
    const res = await library.saveProviderEndpoint(group, {
      api: apiDraft.value,
      baseUrl: baseUrlDraft.value,
      apiKey: apiKeyDraft.value,
      clearApiKey: clearApiKey.value
    })
    if (!res.ok) {
      ElMessage.error(res.error ?? '保存失败')
      return
    }
    syncEndpointForm()
    ElMessage.success(`服务商 ${group.provider} 已更新（${res.updated} 个模型）`)
  } finally {
    savingProvider.value = false
  }
}

async function confirmDeleteProvider(group: ProviderGroup) {
  const isCurrent = group.models.some((m) => m.selectionId === currentSelectionId.value)
  try {
    await ElMessageBox.confirm(
      `删除服务商「${group.provider}」及其 ${group.modelCount} 个模型？它的 API Key 也会一起删除。` +
        (isCurrent ? ' 当前选中的模型属于它，选择会被清空。' : ''),
      '删除服务商',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  const res = await library.deleteProviderEntry(group.provider)
  if (!res.ok) ElMessage.error(res.error ?? '删除失败')
}

// —— 模型对话框 ——
const modelDialogVisible = ref(false)
const modelDraft = ref<ModelDraft | null>(null)
const editingModelId = ref('')
const savingModel = ref(false)
const modelError = ref('')

const modelDialogTitle = computed(() =>
  editingModelId.value ? `编辑模型 · ${editingModelId.value}` : `添加模型 · ${activeProvider.value}`
)
const canSaveModel = computed(
  () => Boolean(modelDraft.value?.id.trim()) && !savingModel.value
)

/** 传 item 为编辑，不传为新建（端点从服务商继承）。 */
function openModelDialog(item?: AgentModelView) {
  const group = activeGroup.value
  if (!group) return
  modelError.value = ''
  editingModelId.value = item?.id ?? ''
  modelDraft.value = item
    ? draftFrom(item)
    : emptyDraft(group.api, group.baseUrl, defaults.value)
  modelDialogVisible.value = true
}

async function saveModel() {
  const group = activeGroup.value
  const draft = modelDraft.value
  if (!group || !draft) return
  savingModel.value = true
  modelError.value = ''
  try {
    const res = await library.saveModelEntry(group.provider, draft)
    if (!res.ok) {
      modelError.value = res.error ?? '保存失败'
      return
    }
    ElMessage.success('模型已保存')
    modelDialogVisible.value = false
  } finally {
    savingModel.value = false
  }
}

async function confirmDeleteModel(item: AgentModelView) {
  try {
    await ElMessageBox.confirm(
      `从模型库删除 ${item.selectionId}？` +
        (item.selectionId === currentSelectionId.value ? '它正是当前选中的模型，选择会被清空。' : ''),
      '删除模型',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  const res = await library.deleteModelEntry(item.provider, item.id)
  if (!res.ok) ElMessage.error(res.error ?? '删除失败')
}
</script>
