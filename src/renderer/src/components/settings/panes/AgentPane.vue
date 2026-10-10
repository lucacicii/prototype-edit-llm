<template>
  <header class="settings-content-header">
    <div>
      <h2 class="settings-pane-title">{{ pane.label }}</h2>
      <p class="settings-pane-desc">{{ pane.desc }}</p>
    </div>
    <div class="settings-header-actions">
      <span class="settings-status">
        <span class="settings-dot" :class="statusClass"></span>
        <span>{{ statusText }}</span>
      </span>
      <el-button size="small" text type="primary" :loading="checking" @click="handleCheck">
        检测运行时
      </el-button>
    </div>
  </header>

  <div class="settings-pane">
    <div class="settings-pane-body">
      <!-- 没有可用模型的原因属于运行时解析失败，放这一页最上面 -->
      <el-alert
        v-if="problem"
        type="info"
        :closable="false"
        show-icon
        :title="problem"
      />

      <div class="settings-group">
        <div class="settings-group-header">
          <h3 class="settings-group-title">运行时状态</h3>
        </div>
        <div class="settings-group-body">
          <!-- 两项就绪表：内核 / 数据根。打包版出问题时就靠它一眼看出缺哪一环 -->
          <div class="settings-readiness" v-if="readiness.length">
            <div v-for="item in readiness" :key="item.label" class="settings-readiness-row">
              <span class="settings-mark" :class="item.ok ? 'settings-mark--ok' : 'settings-mark--bad'">
                {{ item.ok ? '✓' : '✗' }}
              </span>
              <span class="settings-readiness-label">{{ item.label }}</span>
              <span class="settings-readiness-detail" :title="item.detail">{{ item.detail }}</span>
            </div>
          </div>
          <div class="settings-path" v-else-if="runtimePath">{{ runtimePath }}</div>
          <div class="settings-footnote">
            检测的是本机 thunder-runtime 内核，不是服务商网关 —— 它能否连上模型由「模型服务」页
            的可用性判定回答。
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-header">
          <h3 class="settings-group-title">Agent 参数</h3>
          <div class="settings-group-actions">
            <el-button
              size="small"
              type="primary"
              :loading="savingTuning"
              :disabled="envLocked"
              :title="envLocked ? '环境变量正在覆盖配置，保存了也不会生效' : '写入 .prototype-agent.json'"
              @click="saveTuning"
            >
              保存
            </el-button>
          </div>
        </div>
        <div class="settings-group-body">
          <el-alert
            v-if="envLocked"
            type="warning"
            :closable="false"
            show-icon
            title="环境变量 PROTOTYPE_AGENT_MODEL 正在覆盖此配置，保存后下次启动仍以环境变量为准。"
          />
          <el-form label-position="top" :model="tuning">
            <div class="settings-grid">
              <el-form-item label="最大轮次 maxTurns">
                <el-input-number
                  v-model="tuning.maxTurns"
                  :min="1"
                  :step="1"
                  controls-position="right"
                  :disabled="envLocked"
                />
              </el-form-item>
              <el-form-item label="温度 temperature">
                <el-input-number
                  v-model="tuning.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  controls-position="right"
                  :disabled="envLocked"
                />
              </el-form-item>
              <el-form-item label="请求超时 requestTimeoutMs">
                <el-input-number
                  v-model="tuning.requestTimeoutMs"
                  :min="1000"
                  :step="5000"
                  controls-position="right"
                  :disabled="envLocked"
                />
              </el-form-item>
              <el-form-item label="思考档位 thinkingLevel">
                <el-select
                  v-model="tuning.thinkingLevel"
                  clearable
                  style="width: 100%"
                  placeholder="使用模型的默认档"
                  :disabled="envLocked || thinkingOptions.length <= 1"
                >
                  <el-option v-for="lv in thinkingOptions" :key="lv" :label="lv" :value="lv" />
                </el-select>
              </el-form-item>
            </div>
            <el-form-item label="系统提示词 systemPrompt">
              <el-input
                v-model="tuning.systemPrompt"
                type="textarea"
                :rows="4"
                :disabled="envLocked"
                placeholder="留空则使用内置的原型编辑提示词"
              />
            </el-form-item>
          </el-form>
          <div class="settings-footnote">
            这些是工作区级设置，按模型无关；写进 {{ configPath || '.prototype-agent.json' }}。
            模型端点与密钥在「模型服务」页，不在这里。
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-header">
          <h3 class="settings-group-title">可用工具（{{ tools.length }}）</h3>
        </div>
        <div class="settings-group-body">
          <div class="settings-tool-list" v-if="tools.length">
            <span
              v-for="tool in tools"
              :key="tool.name"
              class="settings-tool-chip"
              :title="tool.description"
            >
              {{ tool.name }}
              <em>{{ tool.effect }}</em>
            </span>
          </div>
          <div class="settings-footnote" v-else>还没有读到工具清单。</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-header">
          <h3 class="settings-group-title">存储与安全</h3>
        </div>
        <div class="settings-group-body">
          <div class="settings-row">
            <div class="settings-row-label">
              <span class="settings-row-title">模型库</span>
              <span class="settings-row-desc">服务商与模型清单（不含密钥）</span>
            </div>
            <span class="settings-path">{{ libraryPath || '（未知）' }}</span>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <span class="settings-row-title">工作区配置</span>
              <span class="settings-row-desc">模型引用 + Agent 参数</span>
            </div>
            <span class="settings-path">{{ configPath || '（未知）' }}</span>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <span class="settings-row-title">密钥存储</span>
              <span class="settings-row-desc">按服务商各一把</span>
            </div>
            <span class="settings-row-title">
              {{ keyStoreEncrypted ? '已用系统钥匙串加密' : '明文（本机无可用钥匙串）' }}
            </span>
          </div>
          <!-- 没有 keyring 的平台：密钥只能明文落盘，这是降级，要说出来 -->
          <el-alert
            v-if="!keyStoreEncrypted"
            type="warning"
            :closable="false"
            show-icon
            title="本机没有可用的系统钥匙串，API Key 将以明文存放在 0600 权限的文件里。"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAgentModelConfig } from '../../../composables/useAgentModelConfig'
import { SETTINGS_SECTIONS } from '../sections'

const pane = SETTINGS_SECTIONS.find((item) => item.key === 'agent')!

const modelConfig = useAgentModelConfig()

const libraryPath = computed(() => modelConfig.libraryPath.value)
const keyStoreEncrypted = computed(() => modelConfig.keyStoreEncrypted.value)
const envLocked = modelConfig.envLocked
const problem = computed(() => modelConfig.problem.value)
const thinkingOptions = computed(() =>
  modelConfig.thinkingOptions.value.length
    ? modelConfig.thinkingOptions.value
    : modelConfig.vocabularies.value.defaults.thinkingLevels
)

interface ReadinessItem {
  label: string
  ok: boolean
  detail: string
}

const runtimePath = ref('')
const readiness = ref<ReadinessItem[]>([])
const configPath = ref('')
const tools = ref<{ name: string; description: string; effect: string }[]>([])
const checking = ref(false)
const runtimeOk = ref<boolean | null>(null)
const runtimeVersion = ref('')
const runtimeError = ref('')

const tuning = reactive({
  systemPrompt: '',
  maxTurns: undefined as number | undefined,
  temperature: undefined as number | undefined,
  thinkingLevel: '',
  requestTimeoutMs: undefined as number | undefined
})
const savingTuning = ref(false)

const statusClass = computed(() => {
  if (runtimeOk.value === null) return ''
  return runtimeOk.value ? 'settings-dot--ok' : 'settings-dot--bad'
})

const statusText = computed(() => {
  if (runtimeOk.value === null) return '尚未检测 thunder-runtime'
  if (runtimeOk.value) return `thunder-runtime 就绪（协议 v${runtimeVersion.value}）`
  return `thunder-runtime 不可用：${runtimeError.value}`
})

function fillTuning(config: {
  systemPrompt?: string
  maxTurns?: number
  temperature?: number
  thinkingLevel?: string
  requestTimeoutMs?: number
}) {
  tuning.systemPrompt = config.systemPrompt ?? ''
  tuning.maxTurns = config.maxTurns
  tuning.temperature = config.temperature
  tuning.thinkingLevel = config.thinkingLevel ?? ''
  tuning.requestTimeoutMs = config.requestTimeoutMs
}

/** getConfig 拿就绪表/工具/路径，ping 拿内核是否真的活着。 */
async function load() {
  if (!window.agent?.getConfig) {
    runtimeError.value = 'agent 桥接不可用'
    runtimeOk.value = false
    return
  }
  const res = await window.agent.getConfig()
  runtimePath.value = res.runtimePath ?? ''
  readiness.value = res.readiness ?? []
  configPath.value = res.path ?? ''
  tools.value = res.tools ?? []
  fillTuning(res.config ?? {})
  void handleCheck()
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

async function saveTuning() {
  if (envLocked.value) return
  savingTuning.value = true
  try {
    // 传的是整组 tuning：表单是这几个字段的权威，置空即清空。
    // saveTuning 自己会先读回配置，所以 model 引用不会被抹掉。
    const res = await modelConfig.saveTuning({
      systemPrompt: tuning.systemPrompt.trim() || undefined,
      maxTurns: tuning.maxTurns || undefined,
      temperature: tuning.temperature,
      thinkingLevel: tuning.thinkingLevel || undefined,
      requestTimeoutMs: tuning.requestTimeoutMs || undefined
    })
    if (!res.ok) {
      ElMessage.error(`保存失败：${res.error ?? '未知错误'}`)
      return
    }
    configPath.value = res.path ?? configPath.value
    ElMessage.success('Agent 参数已保存')
  } finally {
    savingTuning.value = false
  }
}

onMounted(load)
</script>
