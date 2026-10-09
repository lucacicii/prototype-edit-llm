<template>
  <div class="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
    <!-- 栏目 1：左侧原型方案与通用工作区侧边栏 -->
    <PrototypeSidebar
      :prototypes="prototypeStore.prototypes"
      :active-id="prototypeStore.activeId"
      @select="handleSelectPrototype"
      @create="handleCreatePrototype"
      @clone="handleClonePrototype"
      @delete="handleDeletePrototype"
      @workspace-changed="handleWorkspaceChanged"
    />

    <!-- 栏目 2：AI 对话与多轮迭代区 -->
    <section class="w-96 flex flex-col border-r border-slate-800 bg-slate-900/90 z-10 flex-shrink-0">
      <!-- 顶部 Header（兼作窗口拖拽区，见 assets/main.css 的 .app-drag） -->
      <header class="app-drag h-14 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-amber-400 font-bold">⚡ AI 原型对话迭代</span>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded border transition truncate max-w-[150px]"
            :class="agentConfigured
              ? 'border-emerald-700 text-emerald-400 hover:text-emerald-300'
              : 'border-amber-700 text-amber-400 hover:text-amber-300'"
            :title="agentConfigured ? `当前模型：${agentModelLabel}` : '尚未配置模型，点击设置'"
            @click="isSettingsOpen = true"
          >
            {{ agentConfigured ? agentModelLabel : '未配置模型' }}
          </button>
        </div>
        <div class="flex items-center gap-3">
          <button
            @click="isSettingsOpen = true"
            class="text-xs text-slate-400 hover:text-slate-200 transition"
            title="模型与 Agent 设置"
          >
            ⚙️ 设置
          </button>
          <button
            @click="resetChat"
            class="text-xs text-slate-400 hover:text-slate-200 transition"
          >
            清空对话
          </button>
        </div>
      </header>

      <!-- 未配置模型提示 -->
      <div
        v-if="!agentConfigured"
        class="bg-amber-950/70 border-b border-amber-800/70 px-3 py-2 flex items-center justify-between text-[11px] text-amber-200"
      >
        <span>尚未配置模型，Agent 无法工作。</span>
        <button class="text-amber-300 hover:text-white underline" @click="isSettingsOpen = true">
          立即设置
        </button>
      </div>

      <!-- 圈选目标锚点提示卡片 (增强多框架感知展示) -->
      <div
        v-if="inspectTarget"
        class="bg-sky-950/80 border-b border-sky-800/80 p-3 flex items-start justify-between text-xs animate-fadeIn"
      >
        <div class="flex-1 pr-2">
          <div class="font-semibold text-sky-300 flex items-center gap-1.5 mb-1">
            <span>🎯 已圈选中</span>
            <span class="text-[10px] bg-sky-800 text-sky-200 px-1.5 py-0.2 rounded font-mono font-bold">
              &lt;{{ inspectTarget.componentName || inspectTarget.tagName }}&gt;
            </span>
            <span
              v-if="inspectTarget.framework && inspectTarget.framework !== 'native-dom'"
              class="text-[9px] bg-sky-900 text-sky-300 px-1 py-0.2 rounded border border-sky-700 font-mono"
            >
              {{ inspectTarget.framework }}
            </span>
          </div>

          <!-- 源码文件定位信息 -->
          <div v-if="inspectTarget.sourceFile" class="text-sky-300/90 font-mono text-[10px] truncate mb-0.5">
            📍 {{ getCleanFileName(inspectTarget.sourceFile) }}{{ inspectTarget.sourceLine ? ` : ${inspectTarget.sourceLine}` : '' }}
          </div>

          <div class="text-sky-200/80 font-mono text-[11px] truncate mb-0.5">
            {{ inspectTarget.className || inspectTarget.selector || '无选择器' }}
          </div>
          <div v-if="inspectTarget.text" class="text-sky-300/70 italic text-[11px] truncate">
            "{{ inspectTarget.text }}"
          </div>
        </div>
        <button
          @click="clearInspectTarget"
          class="text-sky-400 hover:text-white text-xs px-1"
        >
          ✕
        </button>
      </div>

      <!-- 圈改标注需求提示卡片 -->
      <div
        v-if="markupAnnotation"
        class="bg-amber-950/80 border-b border-amber-800/80 p-3 flex items-start justify-between text-xs animate-fadeIn"
      >
        <div class="flex-1 pr-2">
          <div class="font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
            <span>✏️ 圈改标注需求</span>
          </div>
          <div class="text-amber-200/90 text-[11px] leading-relaxed">
            "{{ markupAnnotation.note }}"
          </div>
        </div>
        <button
          @click="markupAnnotation = null"
          class="text-amber-400 hover:text-white text-xs px-1"
        >
          ✕
        </button>
      </div>

      <!-- 对话消息列表 -->
      <div ref="chatScrollEl" class="flex-1 overflow-y-auto p-4 space-y-6">
        <div
          v-for="(msg, idx) in currentPrototype?.chatMessages"
          :key="idx"
          class="group flex gap-3.5 w-full"
          :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
        >
          <!-- 头像：30×30、8px 圆角（方形，与 panel 一致） -->
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border flex items-center justify-center text-[11px] font-semibold"
            :class="msg.role === 'user'
              ? 'bg-slate-800 text-slate-400 border-slate-700'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'"
          >{{ msg.role === 'user' ? '我' : '⚡' }}</span>

          <!-- 消息容器 -->
          <div
            class="flex-1 min-w-0 flex flex-col gap-2.5"
            :class="msg.role === 'user' ? 'items-end' : ''"
          >
            <!-- 气泡：用户 = 淡底 + 右下单角 2px；助手 = 透明全宽 -->
            <div
              class="text-[13.5px] leading-[1.6] break-words select-text"
              :class="msg.role === 'user'
                ? 'bg-sky-500/10 text-slate-100 px-3.5 py-2.5 rounded-[14px] rounded-br-[2px] max-w-[85%]'
                : 'w-full text-slate-200'"
            >
              <!-- 关联圈选目标标签 -->
              <div
                v-if="msg.inspectContext"
                class="mb-1.5 pb-1.5 border-b border-sky-500/25 text-[11px] text-sky-300 flex items-center gap-1 font-mono"
              >
                <span>🎯 锚点: &lt;{{ msg.inspectContext.tagName }}&gt;</span>
              </div>
              <div class="whitespace-pre-wrap">{{ msg.content }}</div>
            </div>

            <!-- 页脚：助手常显；用户侧只留「复制」且悬停才显（panel 的用户工具条就是悬停才显的） -->
            <div
              class="flex items-center gap-2 text-[11px] text-slate-500 transition"
              :class="msg.role === 'user' ? 'flex-row-reverse opacity-0 group-hover:opacity-100 focus-within:opacity-100' : ''"
            >
              <button
                type="button"
                class="px-1.5 py-[3px] rounded text-[11.5px] hover:bg-slate-800 hover:text-slate-200 transition"
                :title="copiedIndex === idx ? '已复制' : '复制'"
                :aria-label="copiedIndex === idx ? '已复制' : '复制'"
                @click="copyMessage(msg.content, idx)"
              >{{ copiedIndex === idx ? '✓ 已复制' : '复制' }}</button>
              <!-- 时间只放助手侧：panel 的用户工具条没有元信息，而「悬停才显的时间」等于不可用 -->
              <span v-if="msg.role === 'assistant'">{{ formatClock(msg.timestamp) }}</span>
              <!-- 本轮统计（panel 的 Turn N • N tokens • 1.2s） -->
              <span v-if="msg.role === 'assistant' && msg.stats" class="text-slate-600">
                · {{ msg.stats.totalTurns }} 轮 · {{ (msg.stats.promptTokens + msg.stats.completionTokens).toLocaleString() }} tokens · {{ (msg.stats.durationMs / 1000).toFixed(1) }}s
              </span>
            </div>
          </div>
        </div>

        <!-- 生成中：实时进度块（阶段 / 工具 / 耗时 / 停止） -->
        <div v-if="isGenerating" class="flex gap-3.5 w-full">
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center justify-center text-[11px] font-semibold"
          >⚡</span>
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <!-- 状态行：阶段 + 轮次 + 耗时 + 停止 -->
            <div class="flex items-center gap-2 text-[13px]">
              <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0"></span>
              <span class="text-slate-300">{{ statusLine }}</span>
              <span class="text-slate-500 text-[11px] tabular-nums">{{ (runElapsedMs / 1000).toFixed(1) }}s</span>
              <button
                type="button"
                class="ml-auto px-1.5 py-[3px] rounded text-[11px] text-slate-400 hover:text-red-300 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/40 transition"
                title="停止本次生成"
                @click="handleCancelRun"
              >停止</button>
            </div>
            <!-- 工具活动：正在跑的 + 已完成计数 -->
            <div v-if="activeTool || toolCount > 0" class="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              <span v-if="activeTool" class="text-amber-300/90">⚙ {{ activeTool }}</span>
              <span v-if="activeTool" class="animate-pulse">…</span>
              <span v-if="toolCount > 0">✓ {{ toolCount }} 次工具调用</span>
              <span v-if="toolFailed" class="text-red-400/90">· 有工具失败</span>
            </div>
            <!-- 提示行：gate retry 原因 / 工具失败 / 瞬时错误 -->
            <div v-if="runNotice" class="text-[11px] text-slate-500 leading-snug whitespace-pre-wrap">{{ runNotice }}</div>
          </div>
        </div>

        <!-- 流式文本：未完成的助手消息（不塞 chatMessages，清空对话/切换原型不残留） -->
        <div v-if="isGenerating && runStreamed" class="flex gap-3.5 w-full">
          <span
            aria-hidden="true"
            class="flex-shrink-0 mt-0.5 w-[30px] h-[30px] rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center justify-center text-[11px] font-semibold"
          >⚡</span>
          <div class="text-[13.5px] leading-[1.6] break-words select-text w-full text-slate-200 whitespace-pre-wrap">{{ runStreamed }}<span class="inline-block w-1.5 h-3.5 bg-amber-400/70 align-middle animate-pulse"></span></div>
        </div>
      </div>

      <!-- 输入栏 -->
      <div class="p-3 border-t border-slate-800 bg-slate-900">
        <div class="relative">
          <textarea
            v-model="promptInput"
            :disabled="isGenerating"
            :placeholder="inspectTarget ? '针对圈选区域输入修改意见 (如：把按钮改为深色、加一个导出操作)...' : '输入需求 (如：在筛选栏新增状态选择，表格操作列加审核)...'"
            class="w-full bg-slate-800 text-slate-100 placeholder-slate-500 text-xs rounded-lg p-2.5 pb-8 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500 border border-slate-700 disabled:opacity-50"
            rows="3"
            @keydown.enter.prevent="handleSend"
          />
          <button
            @click="handleSend"
            :disabled="isGenerating || !promptInput.trim()"
            class="absolute right-2 bottom-2 px-3 py-1 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white text-xs font-medium rounded transition flex items-center gap-1"
          >
            <span>发送迭代</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 栏目 3：右侧内置浏览器与源码审查区 -->
    <main class="flex-1 flex flex-col min-w-0 bg-slate-900 overflow-hidden relative">
      <!-- 顶层状态与操作栏（兼作窗口拖拽区，见 assets/main.css 的 .app-drag） -->
      <header class="app-drag h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900 flex-shrink-0 z-10">
        <div class="flex items-center gap-3">
          <div class="font-bold text-slate-200 flex items-center gap-2">
            <span>{{ currentTitle }}</span>
            <span v-if="currentSubtitle" class="text-[11px] font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {{ currentSubtitle }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
            <button
              class="px-3 py-1 rounded-md transition flex items-center gap-1.5"
              :class="activeTab === 'preview' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              @click="activeTab = 'preview'"
            >
              <span>🌐</span>
              <span>内置浏览器 (CDP)</span>
            </button>
            <button
              class="px-3 py-1 rounded-md transition flex items-center gap-1.5"
              :class="activeTab === 'code' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              @click="activeTab = 'code'"
            >
              <span>📝</span>
              <span>Vue SFC 源码</span>
            </button>
          </div>

          <button
            @click="isExportDialogOpen = true"
            class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg shadow transition flex items-center gap-1.5"
          >
            <span>📁</span>
            <span>导出至业务工程</span>
          </button>
        </div>
      </header>

      <!-- 核心工作区：内置浏览器视口 或 Monaco 源码编辑器 -->
      <div class="flex-1 min-h-0 relative overflow-hidden">
        <!-- 内置工程浏览器 (CDP 深度控制 + 圈选 + 圈改 + 自闭环自愈) -->
        <EmbeddedBrowserViewer
          ref="embeddedBrowserRef"
          :active-prototype-id="prototypeStore.activeId"
          :current-code="currentPrototype?.vueCode || ''"
          :current-workspace="currentWorkspace"
          :is-visible="activeTab === 'preview'"
          :suspended="browserSuspended"
          @inspect-selected="onInspectElementSelected"
          @markup-saved="onMarkupSaved"
          @code-updated="handleCodeSelfDebugUpdate"
          @trigger-chat-fix="handleTriggerChatFix"
        />

        <!-- Monaco 代码编辑器 (源码模式) -->
        <MonacoEditor
          v-if="activeTab === 'code'"
          :code="currentPrototype?.vueCode || ''"
          @update:code="handleCodeManualUpdate"
        />
      </div>
    </main>

    <!-- 导出弹窗 -->
    <ExportDialog
      v-model="isExportDialogOpen"
      :code-content="currentPrototype?.vueCode || ''"
      :default-file-name="`${currentPrototype?.id || 'index'}.vue`"
      @closed="handleDialogClosed"
    />

    <!-- 模型 / Agent 设置弹窗 -->
    <ModelSettingsDialog
      v-model="isSettingsOpen"
      @saved="refreshAgentStatus"
      @closed="handleDialogClosed"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import PrototypeSidebar from './components/PrototypeSidebar.vue'
import EmbeddedBrowserViewer from './components/EmbeddedBrowserViewer.vue'
import MonacoEditor from './components/MonacoEditor.vue'
import ExportDialog from './components/ExportDialog.vue'
import ModelSettingsDialog from './components/ModelSettingsDialog.vue'
import { usePrototypeStore, PrototypeItem, RunStats } from './stores/prototypeStore'
import { locateCodeSnippet } from './utils/inspector'

const prototypeStore = usePrototypeStore()
const currentPrototype = computed(() => prototypeStore.currentPrototype)
const currentWorkspace = ref<any>(null)

const activeTab = ref<'preview' | 'code'>('preview')
const isExportDialogOpen = ref(false)
const isSettingsOpen = ref(false)
// 弹窗期间必须藏起原生 BrowserView，否则它会盖在对话框上
const browserSuspended = ref(false)
const agentConfigured = ref(false)
const agentModelLabel = ref('')
const isGenerating = ref(false)
const promptInput = ref('')
const chatScrollEl = ref<HTMLElement>()
const embeddedBrowserRef = ref()

// —— 一次 run 的实时状态（进度区的数据源；瞬态，run 结束即归零）——
const activeRunId = ref<string | null>(null)
const runPhase = ref<'idle' | 'running' | 'verifying' | 'error' | 'cancelled'>('idle')
const gateRound = ref(0)
const runTurn = ref(0)
const runElapsedMs = ref(0)
const activeTool = ref<string | null>(null)
const toolCount = ref(0)
const toolFailed = ref(false)
const runStreamed = ref('')
const runReasoning = ref(false)
const runNotice = ref('')
const runStats = ref<RunStats | null>(null)
let runTimer: ReturnType<typeof setInterval> | undefined
let runStartWall = 0

// 「已复制」只做本地 UI 反馈：按钮文案自己回弹，不弹全局 toast（与 panel 一致）
const copiedIndex = ref<number>(-1)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyMessage(text: string, idx: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedIndex.value = idx
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedIndex.value = -1), 1500)
  } catch {
    // 打包成 file:// 时剪贴板可能不可用，退回让用户自己选中复制
    ElMessage.warning('复制失败，请手动选中文本复制')
  }
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// —— 进度区：状态行文案（computed，不在模板里拼字符串）——
const statusLine = computed(() => {
  if (runPhase.value === 'verifying') return `验证运行结果…（第 ${gateRound.value} 轮）`
  const turnSuffix = runTurn.value > 0 ? `（第 ${runTurn.value} 轮）` : ''
  if (runReasoning.value) return `正在思考…${turnSuffix}`
  if (activeTool.value) return `正在执行 ${activeTool.value}…${turnSuffix}`
  if (runStreamed.value) return `正在组织代码…${turnSuffix}`
  return `Thunder Agent 正在工作…${turnSuffix}`
})

// —— 进度区：thunder 每一帧的分发（帧词汇见 thunder-agent-loop/src/types/event.rs）——
function handleStreamFrame(frame: any) {
  if (!frame) return
  // 顶层帧（run_id 标识属于哪次 run）
  if (frame.type === 'run_finished') {
    if (frame.stats) runStats.value = normalizeStats(frame.stats)
    if (frame.finish_reason === 'cancelled') runPhase.value = 'cancelled'
    return
  }
  if (frame.type === 'error') {
    // 带 run_id 的是 run 级失败；协议应答不带 run_id，不经这里
    runPhase.value = 'error'
    runNotice.value = frame.message ?? ''
    return
  }
  if (frame.type === 'gate_request') {
    runPhase.value = 'verifying'
    gateRound.value = frame.round ?? gateRound.value + 1
    return
  }
  if (frame.type !== 'observation' || !frame.event) return
  const ev = frame.event
  switch (ev.type) {
    case 'turn_start':
      runTurn.value = ev.turn
      break
    case 'token_delta':
      runStreamed.value += ev.delta ?? ''
      runReasoning.value = false
      scrollToBottom()
      break
    case 'reasoning_delta':
      runReasoning.value = true
      break
    case 'tool_exec_start':
      activeTool.value = ev.name
      break
    case 'tool_exec_result':
      activeTool.value = null
      toolCount.value += 1
      if (ev.result?.is_error) {
        toolFailed.value = true
        runNotice.value = runNotice.value ? `${runNotice.value}\n${ev.name} 失败` : `${ev.name} 失败`
      }
      break
    case 'turn_end':
      runTurn.value = ev.turn
      break
    case 'gate_result':
      if (ev.verdict === 'fail') {
        runPhase.value = 'error'
        runNotice.value = ev.detail ?? '验证未通过'
      } else if (ev.verdict === 'retry') {
        // 门禁要求再来一轮：把原因亮出来，用户才知道为什么没停
        runPhase.value = 'running'
        runNotice.value = ev.detail ?? ''
      } else {
        runPhase.value = 'running'
      }
      break
    case 'loop_complete':
      if (ev.stats) runStats.value = normalizeStats(ev.stats)
      break
    case 'error':
      // recoverable 的瞬时失败：agent 会自己重试，只在状态行提示
      runNotice.value = ev.message ?? ''
      break
  }
}

/** thunder 的 AgentStats（snake_case）→ 渲染层 RunStats。字段缺省按 0。 */
function normalizeStats(s: any): RunStats {
  return {
    totalTurns: s?.total_turns ?? 0,
    promptTokens: s?.total_prompt_tokens ?? 0,
    completionTokens: s?.total_completion_tokens ?? 0,
    durationMs: s?.total_duration_ms ?? 0,
    toolExecutions: s?.total_tool_executions ?? 0,
    tokensPerSecond: s?.avg_tokens_per_second ?? undefined
  }
}

async function handleCancelRun() {
  if (!activeRunId.value) return
  try {
    await window.agent.cancel(activeRunId.value)
  } catch {
    // 停止失败不打断界面：run 自己会收尾
  }
}

// 当前圈选选中的目标 DOM 信息
const inspectTarget = ref<any | null>(null)
// 当前圈改标注
const markupAnnotation = ref<{ note: string; rect: any } | null>(null)

const currentTitle = computed(() => {
  if (currentWorkspace.value && currentWorkspace.value.id !== 'default-host') {
    return currentWorkspace.value.name
  }
  return currentPrototype.value?.name || '未选定原型'
})

const currentSubtitle = computed(() => {
  if (currentWorkspace.value && currentWorkspace.value.id !== 'default-host') {
    return currentWorkspace.value.url
  }
  return `ID: ${currentPrototype.value?.id || ''}`
})

function handleWorkspaceChanged(ws: any) {
  currentWorkspace.value = ws
}

/** Reflect the app-owned model config in the chat header. */
async function refreshAgentStatus() {
  if (!window.agent?.getConfig) return
  try {
    const res = await window.agent.getConfig()
    agentConfigured.value = Boolean(res?.configured)
    agentModelLabel.value = res?.modelLabel ?? ''
  } catch {
    agentConfigured.value = false
  }
}

onMounted(async () => {
  await refreshAgentStatus()
  if (agentConfigured.value) return

  // Nothing picked yet: adopt whatever thunder's ~/.thunder config already
  // uses, so the agent works out of the box.
  const cfg = await window.agent?.getConfig?.()
  if (cfg?.defaultModel) {
    const saved = await window.agent.setConfig({ ...(cfg.config ?? {}), model: cfg.defaultModel })
    if (saved?.ok) {
      await refreshAgentStatus()
      if (agentConfigured.value) {
        ElMessage.success(`已自动选用模型 ${cfg.defaultModel.name ?? cfg.defaultModel.id}`)
        return
      }
    }
  }

  // Still nothing usable: take the user straight to setup.
  isSettingsOpen.value = true
})

// Suspend the native browser view the moment a dialog opens, and only release
// it after the close transition finishes (@closed), otherwise the view would
// pop back over the fading dialog.
watch(
  () => isSettingsOpen.value || isExportDialogOpen.value,
  (open) => {
    if (open) browserSuspended.value = true
  }
)

function handleDialogClosed() {
  if (!isSettingsOpen.value && !isExportDialogOpen.value) {
    browserSuspended.value = false
  }
}

function handleSelectPrototype(id: string) {
  prototypeStore.setActive(id)
  clearInspectTarget()
  markupAnnotation.value = null
  // 确保写回文件至 runtime-host
  syncActivePrototypeToFile()
}

function handleCreatePrototype(data: { name: string; description: string }) {
  const item = prototypeStore.createPrototype(data.name, data.description)
  syncActivePrototypeToFile()
  ElMessage.success(`已创建原型【${item.name}】`)
}

function handleClonePrototype(item: PrototypeItem) {
  const cloned = prototypeStore.clonePrototype(item.id)
  if (cloned) {
    syncActivePrototypeToFile()
    ElMessage.success(`已复制出【${cloned.name}】`)
  }
}

function handleDeletePrototype(id: string) {
  prototypeStore.deletePrototype(id)
  syncActivePrototypeToFile()
  ElMessage.info('已移除原型')
}

// 圈选元素事件捕获 (深度框架与源码反查)
async function onInspectElementSelected(target: any) {
  let sourceCode = currentPrototype.value?.vueCode || ''
  let lineNumber = target.sourceLine

  // 如果是在外部导入工程中圈选，尝试反查本地源文件
  if (window.project?.findSourceFile && (target.sourceFile || target.componentName)) {
    try {
      const match = await window.project.findSourceFile(target.sourceFile || target.componentName)
      if (match) {
        sourceCode = match.content
        target.resolvedLocalPath = match.filePath
      }
    } catch {
      // ignore
    }
  }

  const { snippet, lineNumber: calculatedLine } = locateCodeSnippet(sourceCode, {
    tagName: target.tagName,
    className: target.className || '',
    textSnippet: target.text || ''
  })

  inspectTarget.value = {
    ...target,
    codeSnippet: snippet,
    lineNumber: lineNumber || calculatedLine
  }

  const compLabel = target.componentName || target.tagName
  ElMessage.success(`已圈选 <${compLabel}>，支持针对该组件输入修改诉求`)
}

function clearInspectTarget() {
  inspectTarget.value = null
}

function getCleanFileName(p: string) {
  if (!p) return ''
  return p.split('/').pop() || p
}

// 圈改标注事件捕获
function onMarkupSaved(data: { note: string; rect: any }) {
  markupAnnotation.value = data
  promptInput.value = data.note
  ElMessage.success(`已捕获圈改批注: "${data.note}"`)
}

function resetChat() {
  if (currentPrototype.value) {
    currentPrototype.value.chatMessages = [
      {
        role: 'assistant',
        content: `已重置当前原型【${currentPrototype.value.name}】的对话历史。你可以通过自然语言提出修改，或使用内置浏览器“🎯 圈选”或“✏️ 圈改”工具。`,
        timestamp: Date.now()
      }
    ]
  }
}

// 同步把当前激活的原型代码写入 runtime-host/src/views/prototypes/{id}.vue
async function syncActivePrototypeToFile() {
  const p = currentPrototype.value
  if (!p) return

  if (window.hostApi?.savePrototypeFile) {
    await window.hostApi.savePrototypeFile({
      prototypeId: p.id,
      code: p.vueCode
    })
  }
}

// 开屏对齐磁盘：store 里的代码若是刚从快照恢复的，磁盘上的 active.vue 可能不是它
// （比如被别的东西覆盖过），补一次写回，预览区才不会和左侧代码对不上。
//
// 只在「确实是从快照恢复」时做：没有快照 = 这次是个全新种子，把它推上磁盘
// 只会把上一次生成的真页面覆盖成空白骨架。主进程那侧还会跳过内容相同的写入，
// 所以这一步正常开屏不会真的落盘、也不会白白让预览刷新。
onMounted(() => {
  if (prototypeStore.hydratedFromSnapshot) syncActivePrototypeToFile()
})

function handleCodeManualUpdate(newCode: string) {
  if (currentPrototype.value) {
    prototypeStore.updateCode(currentPrototype.value.id, newCode)
    syncActivePrototypeToFile()
  }
}

async function handleCodeSelfDebugUpdate(newCode: string) {
  if (currentPrototype.value) {
    prototypeStore.updateCode(currentPrototype.value.id, newCode)
    await syncActivePrototypeToFile()
  }
}

function handleTriggerChatFix(prompt: string) {
  promptInput.value = prompt
  handleSend()
}

async function handleSend() {
  const text = promptInput.value.trim()
  if (!text || isGenerating.value || !currentPrototype.value) return

  const p = currentPrototype.value
  const target = inspectTarget.value
  const markup = markupAnnotation.value

  let instruction = text
  if (markup) {
    instruction = `【圈改批注诉求】: ${markup.note}\n${text !== markup.note ? text : ''}`
  }

  p.chatMessages.push({
    role: 'user',
    content: instruction,
    timestamp: Date.now(),
    inspectContext: target ? { tagName: target.tagName, text: target.text } : undefined
  })

  promptInput.value = ''
  clearInspectTarget()
  markupAnnotation.value = null

  // runId 由渲染层生成并传入 —— 进度帧靠它认领，「停止」按钮也靠它取消。
  // （main 端不传则自己生成；加随机后缀避免同一毫秒两次发送撞 id，
  //  runtime 侧会拒绝重复 run_id）
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  activeRunId.value = runId
  runPhase.value = 'running'
  gateRound.value = 0
  runTurn.value = 0
  runElapsedMs.value = 0
  activeTool.value = null
  toolCount.value = 0
  toolFailed.value = false
  runStreamed.value = ''
  runReasoning.value = false
  runNotice.value = ''
  runStats.value = null
  runStartWall = Date.now()
  clearInterval(runTimer)
  runTimer = setInterval(() => {
    runElapsedMs.value = Date.now() - runStartWall
  }, 500)

  isGenerating.value = true
  scrollToBottom()

  // The agent keeps no state of its own; the app replays the recent turns on
  // every request and stores whatever comes back.
  const history = p.chatMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }))

  try {
    if (!window.agent?.run) {
      p.chatMessages.push({
        role: 'assistant',
        content: '原型 Agent 未接入（agent 桥接不可用），无法执行本次修改。',
        timestamp: Date.now()
      })
      return
    }

    // 每一帧都从这里过：进度区靠它驱动。run_id 过滤是防御 ——
    // agent:stream-event 扇出到所有窗口，别的窗口的 run 不该污染这里。
    const offStream = window.agent.onStreamEvent((frame: any) => {
      if (frame?.run_id && activeRunId.value && frame.run_id !== activeRunId.value) return
      handleStreamFrame(frame)
    })
    // The agent edits through apply_prototype_edit; keep the editor in sync.
    const offCode = window.agent.onCodeUpdated((data: { code: string }) => {
      prototypeStore.updateCode(p.id, data.code)
    })

    let res: any
    try {
      res = await window.agent.run({
        runId,
        prototypeId: p.id,
        prompt: instruction,
        code: p.vueCode,
        history,
        inspectTarget: target ? { tagName: target.tagName, text: target.text } : undefined
      })
    } finally {
      offStream?.()
      offCode?.()
    }

    if (!res?.ok) {
      p.chatMessages.push({
        role: 'assistant',
        content: `生成异常: ${res?.error ?? '未知错误'}`,
        timestamp: Date.now()
      })
      return
    }

    if (res.code && res.code !== p.vueCode) {
      prototypeStore.updateCode(p.id, res.code)
    }
    await syncActivePrototypeToFile()

    // 用户点了停止：run 正常结束（finishReason 'cancelled'，不是异常），
    // 已流式输出的部分文本是用户最该看到的东西。
    if (res.finishReason === 'cancelled') {
      p.chatMessages.push({
        role: 'assistant',
        content: runStreamed.value.trim()
          ? `已停止。本次修改已部分生成：\n${runStreamed.value.trim()}`
          : '已停止，未生成修改。',
        timestamp: Date.now(),
        stats: runStats.value ?? undefined
      })
      return
    }

    p.chatMessages.push({
      role: 'assistant',
      content: res.finalContent?.trim() || runStreamed.value.trim() || '已完成本次原型修改。',
      timestamp: Date.now(),
      stats: runStats.value ?? undefined
    })
  } catch (err: any) {
    p.chatMessages.push({
      role: 'assistant',
      content: `生成异常: ${err.message}`,
      timestamp: Date.now()
    })
  } finally {
    isGenerating.value = false
    // 进度状态是瞬态：run 结束即归零，不残留到下一次
    activeRunId.value = null
    runPhase.value = 'idle'
    gateRound.value = 0
    runTurn.value = 0
    runElapsedMs.value = 0
    activeTool.value = null
    toolCount.value = 0
    toolFailed.value = false
    runStreamed.value = ''
    runReasoning.value = false
    runNotice.value = ''
    runStats.value = null
    clearInterval(runTimer)
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatScrollEl.value) {
      chatScrollEl.value.scrollTop = chatScrollEl.value.scrollHeight
    }
  })
}
</script>
