<template>
  <div class="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden relative">
    <!-- 顶部状态栏与圈选操作条 -->
    <div class="h-9 bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between text-xs shrink-0 select-none">
      <div class="flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-slate-300 font-semibold">企业中后台运行环境</span>
        <span class="text-slate-500 font-mono text-[11px]">| wb-ui 动态运行时</span>
      </div>

      <!-- 圈选操作按钮 -->
      <div class="flex items-center space-x-2">
        <button
          class="px-2.5 py-1 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors"
          :class="isInspecting ? 'bg-amber-500 text-slate-950 font-bold shadow-lg animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30'"
          @click="toggleInspector"
        >
          <span>🎯 {{ isInspecting ? '正在圈选 (ESC退出)' : '圈画编辑' }}</span>
        </button>

        <button
          class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] flex items-center space-x-1"
          @click="refreshContainer"
        >
          <span>🔄 刷新</span>
        </button>
      </div>
    </div>

    <!-- 中立、通用的完整工程 Layout 框架 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 1. 左侧通用导航菜单 -->
      <aside class="w-52 bg-[#001529] text-slate-300 flex flex-col shrink-0 select-none border-r border-slate-800">
        <!-- 系统 Logo -->
        <div class="h-12 flex items-center px-4 space-x-2.5 bg-[#002140] text-white font-bold tracking-wide">
          <div class="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-xs text-white">
            PS
          </div>
          <span class="text-xs truncate">Prototype Studio</span>
        </div>

        <!-- 菜单列表 -->
        <div class="flex-1 py-3 overflow-y-auto text-xs space-y-1">
          <div class="px-4 py-1 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
            原型视图
          </div>

          <!-- 激活菜单项 -->
          <div class="mx-2 px-3 py-2 rounded bg-indigo-600 text-white font-medium flex items-center space-x-2 cursor-pointer shadow-sm">
            <span>📦</span>
            <span class="truncate">当前原型页面</span>
          </div>

          <div class="mx-2 px-3 py-2 rounded text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 flex items-center space-x-2 cursor-pointer transition-colors">
            <span>👥</span>
            <span class="truncate">客户与商户管理</span>
          </div>

          <div class="mx-2 px-3 py-2 rounded text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 flex items-center space-x-2 cursor-pointer transition-colors">
            <span>📊</span>
            <span class="truncate">数据与报表分析</span>
          </div>

          <div class="mx-2 px-3 py-2 rounded text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 flex items-center space-x-2 cursor-pointer transition-colors">
            <span>⚙️</span>
            <span class="truncate">系统全局设置</span>
          </div>
        </div>

        <!-- 底部版本信息 -->
        <div class="p-3 text-[10px] text-slate-500 border-t border-slate-800/60 flex items-center justify-between">
          <span>v1.0.0</span>
          <span class="text-emerald-400">● 运行就绪</span>
        </div>
      </aside>

      <!-- 2. 右侧主体容器 (Header + Tabs + 业务内容) -->
      <div class="flex-1 flex flex-col overflow-hidden bg-slate-100">
        <!-- 顶部导航 Header -->
        <header class="h-12 bg-white border-b border-gray-200 px-4 flex items-center justify-between shrink-0 shadow-sm">
          <!-- 面包屑 -->
          <div class="flex items-center space-x-2 text-xs text-gray-500">
            <span class="hover:text-gray-700 cursor-pointer">首页</span>
            <span>/</span>
            <span class="hover:text-gray-700 cursor-pointer">业务管理</span>
            <span>/</span>
            <span class="text-gray-900 font-semibold">当前生成页面 (原型)</span>
          </div>

          <!-- 右侧当前用户 -->
          <div class="flex items-center space-x-3 text-xs">
            <div class="flex items-center space-x-1.5 text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-200">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>管理员: admin</span>
            </div>
            <div class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
              A
            </div>
          </div>
        </header>

        <!-- 标签栏 TagsView -->
        <div class="h-9 bg-white border-b border-gray-200 px-3 flex items-center space-x-2 text-xs shrink-0 select-none">
          <div class="px-2.5 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 cursor-pointer">
            首页
          </div>
          <div class="px-2.5 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium flex items-center space-x-1 shadow-xs">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
            <span>当前原型页面</span>
            <span class="text-xs hover:text-indigo-900 ml-1">×</span>
          </div>
        </div>

        <!-- 3. 业务内容主体与圈选交互层 -->
        <div ref="wrapperEl" class="flex-1 overflow-auto p-4 relative">
          <!-- 动态渲染的 Vue SFC 组件沙箱 -->
          <SandboxPreview
            v-if="renderKey"
            :key="renderKey"
            :code="code"
          />

          <!-- 圈选悬浮高亮框 -->
          <div
            v-if="isInspecting && hoverBox"
            class="pointer-events-none fixed z-50 border-2 border-amber-500 bg-amber-400/20 rounded shadow-sm transition-all duration-75"
            :style="{
              top: hoverBox.top + 'px',
              left: hoverBox.left + 'px',
              width: hoverBox.width + 'px',
              height: hoverBox.height + 'px'
            }"
          >
            <!-- 标签浮条 -->
            <div class="absolute -top-6 left-0 bg-amber-500 text-slate-950 font-bold font-mono text-[10px] px-1.5 py-0.5 rounded shadow">
              {{ hoverTagName }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import SandboxPreview from './SandboxPreview.vue'
import { buildInspectTarget, type InspectTarget } from '../utils/inspector'

const props = defineProps<{
  code: string
}>()

const emit = defineEmits<{
  (e: 'select-element', target: InspectTarget): void
}>()

const wrapperEl = ref<HTMLElement>()
const renderKey = ref(1)

// 圈选编辑状态
const isInspecting = ref(false)
const hoverBox = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const hoverTagName = ref('')

function refreshContainer() {
  renderKey.value++
}

function toggleInspector() {
  isInspecting.value = !isInspecting.value
  if (!isInspecting.value) {
    hoverBox.value = null
  }
}

// 捕获鼠标移动并高亮元素
function handleMouseMove(e: MouseEvent) {
  if (!isInspecting.value || !wrapperEl.value) return

  const target = e.target as HTMLElement
  if (!target || !wrapperEl.value.contains(target)) {
    hoverBox.value = null
    return
  }

  const rect = target.getBoundingClientRect()
  hoverBox.value = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  }
  hoverTagName.value = `<${target.tagName.toLowerCase()}>`
}

// 捕获点击锁定元素
function handleClick(e: MouseEvent) {
  if (!isInspecting.value || !wrapperEl.value) return

  const target = e.target as HTMLElement
  if (!target || !wrapperEl.value.contains(target)) return

  e.preventDefault()
  e.stopPropagation()

  const inspectTarget = buildInspectTarget(target, props.code)
  emit('select-element', inspectTarget)

  isInspecting.value = false
  hoverBox.value = null
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isInspecting.value) {
    isInspecting.value = false
    hoverBox.value = null
  }
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove, true)
  window.addEventListener('click', handleClick, true)
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove, true)
  window.removeEventListener('click', handleClick, true)
  window.removeEventListener('keydown', handleKeyDown)
})
</script>
