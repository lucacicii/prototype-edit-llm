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
      <!-- 顶部 Header -->
      <header class="h-14 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900">
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
      <div ref="chatScrollEl" class="flex-1 overflow-y-auto p-4 space-y-4">
        <div
          v-for="(msg, idx) in currentPrototype?.chatMessages"
          :key="idx"
          class="flex gap-3 text-xs leading-relaxed"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <!-- Assistant Avatar -->
          <div
            v-if="msg.role === 'assistant'"
            class="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0 text-xs font-bold border border-amber-500/30"
          >
            AI
          </div>

          <!-- Message Bubble -->
          <div
            class="max-w-[85%] rounded-xl px-3.5 py-2.5 break-words shadow-sm"
            :class="msg.role === 'user'
              ? 'bg-sky-600 text-white rounded-tr-none'
              : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/60'"
          >
            <!-- 关联圈选目标标签 -->
            <div
              v-if="msg.inspectContext"
              class="mb-1.5 pb-1.5 border-b border-sky-500/40 text-[11px] text-sky-100 flex items-center gap-1 font-mono"
            >
              <span>🎯 锚点: &lt;{{ msg.inspectContext.tagName }}&gt;</span>
            </div>
            <div>{{ msg.content }}</div>
          </div>

          <!-- User Avatar -->
          <div
            v-if="msg.role === 'user'"
            class="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0 text-xs font-semibold"
          >
            我
          </div>
        </div>

        <div v-if="isGenerating" class="flex items-center gap-2 text-xs text-amber-400 animate-pulse">
          <span class="w-2 h-2 rounded-full bg-amber-400"></span>
          <span>Thunder Agent 正在组织代码并触发 Vite HMR...</span>
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
      <!-- 顶层状态与操作栏 -->
      <header class="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900 flex-shrink-0 z-10">
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
import { usePrototypeStore, PrototypeItem } from './stores/prototypeStore'
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

    let streamed = ''
    const offStream = window.agent.onStreamEvent((frame: any) => {
      if (frame?.type === 'observation' && frame.event?.type === 'token_delta') {
        streamed += frame.event.delta ?? ''
      }
    })
    // The agent edits through apply_prototype_edit; keep the editor in sync.
    const offCode = window.agent.onCodeUpdated((data: { code: string }) => {
      prototypeStore.updateCode(p.id, data.code)
    })

    let res: any
    try {
      res = await window.agent.run({
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

    p.chatMessages.push({
      role: 'assistant',
      content: res.finalContent?.trim() || streamed.trim() || '已完成本次原型修改。',
      timestamp: Date.now()
    })
  } catch (err: any) {
    p.chatMessages.push({
      role: 'assistant',
      content: `生成异常: ${err.message}`,
      timestamp: Date.now()
    })
  } finally {
    isGenerating.value = false
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
