<template>
  <div class="embedded-browser h-full w-full flex flex-col bg-slate-900 overflow-hidden relative">
    <!-- 1. 顶部浏览器工具栏与地址栏 (Chrome UI) -->
    <header class="h-11 bg-slate-800 border-b border-slate-700/80 px-3 flex items-center justify-between flex-shrink-0 text-xs gap-2 select-none z-20">
      <!-- 导航前进/后退/刷新 -->
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          @click="handleGoBack"
          :disabled="!navState.canGoBack"
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300 transition"
          title="后退"
        >
          ◀
        </button>
        <button
          @click="handleGoForward"
          :disabled="!navState.canGoForward"
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300 transition"
          title="前进"
        >
          ▶
        </button>
        <button
          @click="handleReload"
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 text-slate-300 transition"
          title="刷新"
        >
          <span :class="{ 'animate-spin': navState.isLoading }">🔄</span>
        </button>
      </div>

      <!-- 地址栏输入框 -->
      <div class="flex-1 max-w-xl flex items-center bg-slate-900/90 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 gap-1.5 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/30 transition">
        <!-- 框架徽章 -->
        <span
          v-if="currentWorkspace?.framework && currentWorkspace.framework !== 'unknown'"
          class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-950 text-sky-300 border border-sky-800/80"
        >
          {{ getFwLabel(currentWorkspace.framework) }}
        </span>
        <span v-else class="text-slate-400 text-[11px]">🔒</span>

        <input
          v-model="inputUrl"
          @keydown.enter="handleNavigate"
          type="text"
          class="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none font-mono"
          placeholder="输入网址 (如 http://localhost:3000 或 http://127.0.0.1:4321/...)"
        />
        <button
          v-if="inputUrl !== navState.url"
          @click="handleNavigate"
          class="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-medium transition"
        >
          前往
        </button>
      </div>

      <!-- 功能操作区 -->
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <!-- 视口分辨率选择 -->
        <select
          v-model="viewportMode"
          @change="handleViewportChange"
          class="h-7 px-2 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-300 outline-none hover:border-slate-600 cursor-pointer"
        >
          <option value="responsive">🖥️ 自适应 100%</option>
          <option value="desktop-1080">💻 1920×1080</option>
          <option value="desktop-900">💻 1440×900</option>
          <option value="mobile-iphone">📱 375×812</option>
        </select>

        <!-- 缩放控制 -->
        <select
          v-model="zoomLevel"
          @change="handleZoomChange"
          class="h-7 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-300 outline-none hover:border-slate-600 cursor-pointer"
        >
          <option value="0.8">80%</option>
          <option value="1.0">100%</option>
          <option value="1.25">125%</option>
        </select>

        <div class="h-4 w-px bg-slate-700 mx-0.5"></div>

        <!-- 🎯 圈选编辑 -->
        <button
          @click="toggleInspect"
          class="h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1"
          :class="inspectMode === 'inspect'
            ? 'bg-sky-500 text-white shadow-lg ring-2 ring-sky-400/50'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-200'"
          title="点击页面元素提取组件与代码行号"
        >
          <span>🎯</span>
          <span>{{ inspectMode === 'inspect' ? '圈选中(ESC退出)' : '圈选' }}</span>
        </button>

        <!-- ✏️ 圈改标注 -->
        <button
          @click="toggleMarkup"
          class="h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1"
          :class="inspectMode === 'markup'
            ? 'bg-amber-500 text-white shadow-lg ring-2 ring-amber-400/50'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-200'"
          title="在页面上框选区域并输入批注需求"
        >
          <span>✏️</span>
          <span>{{ inspectMode === 'markup' ? `标注中(${markupCount || 0})(ESC退出)` : '圈改' }}</span>
        </button>

        <!-- 🛠️ Chrome 原生 DevTools -->
        <button
          @click="toggleDevTools"
          class="h-7 px-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition flex items-center gap-1"
          title="呼出/隐藏 Chromium 原生开发者工具 (F12)"
        >
          <span>🛠️</span>
          <span>DevTools</span>
        </button>

        <!-- 🐞 自闭环 Debug 状态胶囊 -->
        <button
          @click="runSelfDebug"
          class="h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1.5"
          :class="getSelfDebugBtnClass()"
          title="点击执行自测自愈循环"
        >
          <span>🐞</span>
          <span>{{ getSelfDebugBtnLabel() }}</span>
        </button>

        <!-- 展开控制台 -->
        <button
          @click="isConsoleCollapsed = !isConsoleCollapsed"
          class="h-7 px-2 rounded text-xs transition flex items-center gap-1"
          :class="hasUnreadErrors ? 'bg-red-600 text-white animate-bounce' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'"
          title="切换底部控制台"
        >
          <span>📟</span>
          <span v-if="errorCount > 0" class="text-[10px] font-bold">({{ errorCount }})</span>
        </button>
      </div>
    </header>

    <!-- 2. 核心工作视口占位区 (Native BrowserView 悬浮对齐在此容器之上) -->
    <div class="flex-1 w-full min-h-0 relative flex items-center justify-center bg-slate-950 overflow-hidden">
      <div
        ref="viewportContainerRef"
        class="relative transition-all duration-150 bg-white shadow-2xl overflow-hidden"
        :style="viewportBoxStyle"
      >
        <!-- 当 BrowserView 未加载或正在等待服务时展现提示背景 -->
        <div class="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-900 pointer-events-none z-0">
          <span class="text-2xl mb-2 animate-pulse">⚡</span>
          <p class="text-xs font-mono">企业级内置浏览器正在初始化...</p>
          <p class="text-[11px] text-slate-500 mt-1">{{ inputUrl }}</p>
        </div>
      </div>
    </div>

    <!-- 3. 底部 CDP 实时控制台与自闭环 Debug 审计抽屉 -->
    <CdpConsolePanel
      :logs="cdpLogs"
      :is-collapsed="isConsoleCollapsed"
      @toggle-collapse="isConsoleCollapsed = !isConsoleCollapsed"
      @clear-logs="handleClearLogs"
      @fix-error="handleFixError"
      @run-self-debug="runSelfDebug"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import CdpConsolePanel from './CdpConsolePanel.vue'
import { selfDebugEngine } from '../utils/self-debug-loop'

const props = defineProps<{
  activePrototypeId: string
  currentCode: string
  isVisible: boolean
  currentWorkspace?: any
  /**
   * A modal is on screen. The native BrowserView always paints above HTML, so
   * it has to step aside or it will cover the dialog.
   */
  suspended?: boolean
  /** 已捕获的圈改批注数，显示在「标注中(N)」上，让画面上有几处一眼可见。 */
  markupCount?: number
}>()

const emit = defineEmits<{
  (e: 'inspect-selected', target: any): void
  (e: 'markup-saved', data: any): void
  /**
   * 预览里的框被清掉了（退出圈改 / ESC）。框是探针自己清的，但批注卡片在
   * App 里 —— 不发这个事件，就会留下「框没了、请求却还带着那处圈改」的错位。
   */
  (e: 'selection-cleared'): void
  (e: 'code-updated', code: string): void
  (e: 'trigger-chat-fix', prompt: string): void
}>()

const viewportContainerRef = ref<HTMLElement>()
const isConsoleCollapsed = ref(true)
const inputUrl = ref('http://127.0.0.1:4321')
const hostUrl = ref('http://127.0.0.1:4321')
const inspectMode = ref<'inspect' | 'markup' | 'off'>('off')
const viewportMode = ref<'responsive' | 'desktop-1080' | 'desktop-900' | 'mobile-iphone'>('responsive')
const zoomLevel = ref('1.0')

const navState = ref({
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  url: '',
  title: ''
})

const cdpLogs = ref<any[]>([])
const debugEngine = selfDebugEngine

let resizeObserver: ResizeObserver | null = null
let unsubs: Array<() => void> = []

// 视口尺寸配置
const viewportBoxStyle = computed(() => {
  if (viewportMode.value === 'desktop-1080') {
    return { width: '1920px', height: '1080px', maxWidth: '100%', maxHeight: '100%' }
  }
  if (viewportMode.value === 'desktop-900') {
    return { width: '1440px', height: '900px', maxWidth: '100%', maxHeight: '100%' }
  }
  if (viewportMode.value === 'mobile-iphone') {
    return { width: '375px', height: '812px', border: '12px solid #1e293b', borderRadius: '36px' }
  }
  return { width: '100%', height: '100%' }
})

const errorCount = computed(() => {
  return cdpLogs.value.filter((l) => l.level === 'error').length
})

const hasUnreadErrors = computed(() => {
  return isConsoleCollapsed.value && errorCount.value > 0
})

onMounted(async () => {
  // 获取 Host URL
  if (window.hostApi?.getHostUrl) {
    try {
      const url = await window.hostApi.getHostUrl()
      if (url) hostUrl.value = url
    } catch (e) {
      console.warn('Cannot fetch host url:', e)
    }
  }

  // 默认路由
  updateTargetUrl()

  // 注册 CDP 及 Browser 事件监听
  if (window.browser) {
    unsubs.push(
      window.browser.onCdpLog((log) => {
        cdpLogs.value.unshift(log)
        if (cdpLogs.value.length > 300) cdpLogs.value.pop()
      }),
      window.browser.onLogsCleared(() => {
        cdpLogs.value = []
      }),
      window.browser.onNavState((state) => {
        navState.value = state
        if (state.url) inputUrl.value = state.url
      }),
      window.browser.onInspectSelected((target) => {
        inspectMode.value = 'off'
        emit('inspect-selected', target)
      }),
      window.browser.onMarkupSaved((data) => {
        // 这里**不能**把模式置 off：圈改要能连着框好几处，框完一格就退出的话
        // 第二格根本画不出来。以前置 off 只是渲染层的自我欺骗（探针还在
        // markup 模式），现在两边老实保持 markup，直到用户 ESC / 再点一次 /
        // 发送（App 调 exitInspectMode）。
        emit('markup-saved', data)
      }),
      window.browser.onInspectCancelled(() => {
        inspectMode.value = 'off'
        emit('selection-cleared')
      })
    )

    // 渲染层刚加载完，不知道预览里是不是还停在上一次的圈改/圈选模式（探针
    // 的 document 是独立的，渲染层刷新不会动它）。先对一次表：退出模式 +
    // 清掉可能残留的框，再导航。
    await window.browser.setInspectMode('off')

    // 初始化导航
    await window.browser.loadUrl(inputUrl.value)

    if (props.isVisible && !props.suspended) {
      await window.browser.show()
    }
  }

  // 监听容器大小并同步给主进程 BrowserView
  initBoundsSync()
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  unsubs.forEach((u) => u())
  unsubs = []
  if (window.browser) {
    window.browser.hide()
  }
})

// 监听原型 ID 切换
watch(
  () => props.activePrototypeId,
  () => {
    if (!props.currentWorkspace || props.currentWorkspace.id === 'default-host') {
      updateTargetUrl()
      handleNavigate()
    }
  }
)

// 监听工作区切换
watch(
  () => props.currentWorkspace,
  (ws) => {
    if (ws) {
      if (ws.id === 'default-host') {
        updateTargetUrl()
      } else {
        inputUrl.value = ws.url
      }
      handleNavigate()
    }
  },
  { deep: true }
)

// 监听可见性切换 (在 Preview 和 Monaco 之间切换时)
watch(
  () => props.isVisible,
  async (visible) => {
    if (!window.browser) return
    if (visible && !props.suspended) {
      await window.browser.show()
      syncBounds()
    } else {
      await window.browser.hide()
    }
  }
)

// 弹窗打开/关闭时让出原生视图，避免 BrowserView 遮挡对话框
watch(
  () => props.suspended,
  async (suspended) => {
    if (!window.browser) return
    if (suspended) {
      await window.browser.hide()
      return
    }
    if (props.isVisible) {
      await window.browser.show()
      syncBounds()
    }
  }
)

// 监听控制台折叠变化，重新计算视口坐标
watch(
  () => isConsoleCollapsed.value,
  () => {
    nextTick(() => {
      syncBounds()
    })
  }
)

function getFwLabel(fw: string) {
  if (fw === 'vue3') return 'Vue 3'
  if (fw === 'vue2') return 'Vue 2'
  if (fw === 'react') return 'React'
  return fw
}

function updateTargetUrl() {
  inputUrl.value = `${hostUrl.value}/prototypes/${props.activePrototypeId}`
}

function initBoundsSync() {
  if (!viewportContainerRef.value) return

  resizeObserver = new ResizeObserver(() => {
    syncBounds()
  })

  resizeObserver.observe(viewportContainerRef.value)
  window.addEventListener('resize', syncBounds)
  syncBounds()
}

function syncBounds() {
  if (!props.isVisible || props.suspended || !viewportContainerRef.value || !window.browser) return

  const rect = viewportContainerRef.value.getBoundingClientRect()
  window.browser.setBounds({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })
}

function handleGoBack() {
  window.browser?.goBack()
}

function handleGoForward() {
  window.browser?.goForward()
}

function handleReload() {
  window.browser?.reload()
}

function handleNavigate() {
  if (inputUrl.value && window.browser) {
    window.browser.loadUrl(inputUrl.value)
  }
}

function handleViewportChange() {
  nextTick(() => {
    syncBounds()
  })
}

function handleZoomChange() {
  if (window.browser) {
    window.browser.setZoom(parseFloat(zoomLevel.value))
  }
}

function toggleInspect() {
  if (inspectMode.value === 'inspect') {
    inspectMode.value = 'off'
    window.browser?.setInspectMode('off')
  } else {
    inspectMode.value = 'inspect'
    window.browser?.setInspectMode('inspect')
  }
}

function toggleMarkup() {
  if (inspectMode.value === 'markup') {
    // 退出即清框（探针侧 setMode('off') 会清），App 收到事件后把批注卡片
    // 一起收掉 —— 两边都清，「退出圈改」才是一次干净的中止。
    inspectMode.value = 'off'
    window.browser?.setInspectMode('off')
    emit('selection-cleared')
  } else {
    inspectMode.value = 'markup'
    window.browser?.setInspectMode('markup')
  }
}

/** 发送后由 App 调用：退出圈改模式并把残留的框清掉 */
function exitInspectMode() {
  inspectMode.value = 'off'
  window.browser?.setInspectMode('off')
}

function toggleDevTools() {
  window.browser?.toggleDevTools()
}

async function handleClearLogs() {
  await window.browser?.clearDiagnostics()
  cdpLogs.value = []
}

function handleFixError(log: any) {
  const prompt = `
【修复指定运行时报错】
错误内容: ${log.text}
${log.stack ? `调用栈:\n${log.stack}` : ''}
请分析当前代码并修复此报错，保持原有结构与配置完好。
`
  emit('trigger-chat-fix', prompt)
}

// 执行自闭环自测自愈循环
async function runSelfDebug() {
  if (debugEngine.status.value === 'verifying' || debugEngine.status.value === 'healing') {
    ElMessage.info('自闭环正在运行中...')
    return
  }

  isConsoleCollapsed.value = false
  ElMessage.info('启动自闭环 Debug 自测与自愈...')

  await debugEngine.executeLoop({
    prototypeId: props.activePrototypeId,
    getCurrentCode: () => props.currentCode,
    updateCode: async (newCode: string) => {
      emit('code-updated', newCode)
    },
    maxRounds: 3,
    onLog: (msg: string) => {
      ElMessage.success(msg)
    }
  })
}

function getSelfDebugBtnClass() {
  const s = debugEngine.status.value
  if (s === 'passed') return 'bg-emerald-600 text-white shadow'
  if (s === 'verifying') return 'bg-sky-600 text-white animate-pulse'
  if (s === 'healing') return 'bg-amber-600 text-white animate-pulse'
  if (s === 'failed') return 'bg-red-600 text-white'
  return 'bg-slate-700 hover:bg-slate-600 text-slate-200'
}

function getSelfDebugBtnLabel() {
  const s = debugEngine.status.value
  if (s === 'passed') return '自测通过'
  if (s === 'verifying') return '正在验证'
  if (s === 'healing') return `自愈中(R${debugEngine.currentRound.value})`
  if (s === 'failed') return '自检失败'
  return '自测自愈'
}

defineExpose({
  syncBounds,
  exitInspectMode,
  runSelfDebug,
  navigateToUrl: (url: string) => {
    inputUrl.value = url
    handleNavigate()
  }
})
</script>

<style scoped>
.embedded-browser {
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
}
</style>
