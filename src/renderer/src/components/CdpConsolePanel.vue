<template>
  <div class="cdp-console-dock flex flex-col bg-slate-950 border-t border-slate-800 text-slate-200 transition-all duration-200 font-mono text-xs">
    <!-- 控制台顶栏 -->
    <div class="h-8 bg-slate-900 px-3 flex items-center justify-between border-b border-slate-800 select-none flex-shrink-0">
      <div class="flex items-center gap-1">
        <!-- 标签页切换 -->
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1.5"
          :class="activeTab === tab.id ? 'bg-slate-800 text-sky-400 font-bold border border-slate-700/80' : 'text-slate-400 hover:text-slate-200'"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.count !== undefined"
            class="px-1.5 py-0.2 rounded-full text-[10px]"
            :class="tab.id === 'errors' && tab.count > 0 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-400'"
          >
            {{ tab.count }}
          </span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <!-- 搜索输入 -->
        <input
          v-if="activeTab !== 'audit'"
          v-model="searchQuery"
          type="text"
          placeholder="过滤日志..."
          class="h-5 px-2 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-500 w-32"
        />

        <!-- 清空日志 -->
        <button
          @click="clearLogs"
          class="text-slate-400 hover:text-slate-200 text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition"
          title="清空日志"
        >
          🚫 清空
        </button>

        <!-- 折叠/展开控制台 -->
        <button
          @click="$emit('toggle-collapse')"
          class="text-slate-400 hover:text-slate-200 text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition font-bold"
          :title="isCollapsed ? '展开控制台' : '折叠控制台'"
        >
          {{ isCollapsed ? '▲' : '▼' }}
        </button>
      </div>
    </div>

    <!-- 控制台主体内容 -->
    <div v-show="!isCollapsed" class="h-44 overflow-y-auto p-2 space-y-1 bg-slate-950 select-text">
      <!-- 1. Console / Errors / Warnings / Network 日志流 -->
      <template v-if="activeTab !== 'audit'">
        <div v-if="filteredLogs.length === 0" class="text-slate-600 text-center py-6 text-xs italic">
          暂无相关日志 (CDP 监听已就绪)
        </div>

        <div
          v-for="log in filteredLogs"
          :key="log.id"
          class="p-1.5 rounded flex flex-col gap-1 border transition hover:bg-slate-900/60"
          :class="getLogItemClass(log)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-start gap-2 flex-1 min-w-0">
              <span class="text-[10px] text-slate-500 font-mono mt-0.5 flex-shrink-0">
                {{ formatTime(log.timestamp) }}
              </span>
              <span
                class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold flex-shrink-0"
                :class="getLevelBadgeClass(log)"
                :title="getOriginTitle(log)"
              >
                {{ getBadgeLabel(log) }}
              </span>
              <span class="break-all whitespace-pre-wrap leading-tight text-[11px] font-mono flex-1">
                <span v-if="isProbeLog(log)" class="text-sky-400/80">[工具探针·非原型代码] </span>{{ log.text }}
              </span>
            </div>

            <!-- 报错才给快速修复；探针自己的报错不引导去改原型（那修不好它） -->
            <button
              v-if="log.level === 'error' && !isProbeLog(log)"
              @click="$emit('fix-error', log)"
              class="px-2 py-0.5 bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/40 rounded text-[10px] flex-shrink-0 transition flex items-center gap-1"
            >
              <span>🤖</span>
              <span>AI 修复</span>
            </button>
            <span
              v-else-if="isProbeLog(log) && log.level === 'error'"
              class="px-2 py-0.5 bg-sky-600/20 text-sky-300/80 border border-sky-600/30 rounded text-[10px] flex-shrink-0 cursor-help"
              :title="getOriginTitle(log)"
            >
              工具侧问题
            </span>
          </div>

          <!-- 堆栈详情展开 -->
          <div
            v-if="log.stack"
            class="mt-1 p-1.5 bg-black/40 rounded text-[10px] text-slate-400 overflow-x-auto whitespace-pre border border-slate-800"
          >
            {{ log.stack }}
          </div>
        </div>
      </template>

      <!-- 2. 自闭环 Debug 审计流 -->
      <template v-else>
        <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px]">
          <div class="flex items-center gap-2">
            <span class="text-amber-400 font-bold">🐞 自闭环自愈状态机:</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="getStatusBadgeClass(debugEngine.status.value)">
              {{ getStatusLabel(debugEngine.status.value) }}
            </span>
            <span v-if="debugEngine.currentRound.value > 0" class="text-slate-400 text-[10px]">
              (第 {{ debugEngine.currentRound.value }} / {{ debugEngine.maxRounds.value }} 轮)
            </span>
          </div>

          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1 cursor-pointer text-slate-400 text-[11px]">
              <input type="checkbox" v-model="debugEngine.autoHealEnabled.value" class="rounded text-sky-600" />
              <span>开启自动自愈</span>
            </label>
            <button
              @click="$emit('run-self-debug')"
              class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-medium transition"
            >
              ⚡ 立即执行自测自愈
            </button>
          </div>
        </div>

        <div v-if="debugEngine.auditHistory.value.length === 0" class="text-slate-600 text-center py-6 text-xs italic">
          暂无自闭环审计记录。当生成或更新原型代码时，系统将自动监控并记录。
        </div>

        <div
          v-for="item in debugEngine.auditHistory.value"
          :key="item.id"
          class="p-2 rounded border bg-slate-900/40 mb-1.5 text-xs"
          :class="getAuditItemClass(item.type)"
        >
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span class="text-slate-400 text-[10px]">{{ formatTime(item.timestamp) }}</span>
              <span class="font-bold text-[11px]">{{ item.title }}</span>
            </div>
            <span class="text-[10px] text-slate-500">轮次 {{ item.round }}</span>
          </div>
          <div v-if="item.details" class="text-slate-300 whitespace-pre-wrap text-[11px] font-mono bg-black/30 p-1.5 rounded mt-1">
            {{ item.details }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { selfDebugEngine } from '../utils/self-debug-loop'

const props = defineProps<{
  logs: Array<any>
  isCollapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-collapse'): void
  (e: 'clear-logs'): void
  (e: 'fix-error', log: any): void
  (e: 'run-self-debug'): void
}>()

const debugEngine = selfDebugEngine
const activeTab = ref<'all' | 'errors' | 'warnings' | 'network' | 'audit'>('all')
const searchQuery = ref('')

const tabs = computed(() => {
  const errCount = props.logs.filter((l) => l.level === 'error').length
  const warnCount = props.logs.filter((l) => l.level === 'warn').length
  return [
    { id: 'all', label: '全部日志', count: props.logs.length },
    { id: 'errors', label: '❌ 报错', count: errCount },
    { id: 'warnings', label: '⚠️ 警告', count: warnCount },
    { id: 'network', label: '🌐 网络' },
    { id: 'audit', label: '🐞 自闭环审计' }
  ]
})

const filteredLogs = computed(() => {
  let list = props.logs
  if (activeTab.value === 'errors') {
    list = list.filter((l) => l.level === 'error')
  } else if (activeTab.value === 'warnings') {
    list = list.filter((l) => l.level === 'warn')
  } else if (activeTab.value === 'network') {
    list = list.filter((l) => l.category === 'network')
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((l) => l.text.toLowerCase().includes(q))
  }
  return list
})

function clearLogs() {
  emit('clear-logs')
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

/** 注入探针（工具自己的脚本）的报错：标出来，并且不引导去改原型。 */
function isProbeLog(log: any) {
  return log?.origin === 'probe'
}

function getOriginTitle(log: any) {
  return isProbeLog(log)
    ? '来自原型工具注入的圈选/圈改探针脚本，不是原型代码。原型无需改动。'
    : '来自原型页面自身的代码。'
}

function getBadgeLabel(log: any) {
  const category = isProbeLog(log) ? 'probe' : log?.category
  return `${category}:${log?.level}`
}

function getLogItemClass(log: any) {
  // 探针报错用冷色：它跟原型无关，不该跟原型报错一样刺眼
  if (isProbeLog(log) && log.level === 'error') return 'bg-sky-950/20 border-sky-900/40 text-sky-200'
  if (log?.level === 'error') return 'bg-red-950/20 border-red-900/40 text-red-200'
  if (log?.level === 'warn') return 'bg-amber-950/20 border-amber-900/40 text-amber-200'
  return 'bg-slate-900/40 border-slate-800 text-slate-300'
}

function getLevelBadgeClass(log: any) {
  if (isProbeLog(log) && log.level === 'error') return 'bg-sky-700 text-white'
  if (log?.level === 'error') return 'bg-red-600 text-white'
  if (log?.level === 'warn') return 'bg-amber-600 text-white'
  return 'bg-slate-700 text-slate-200'
}

function getStatusBadgeClass(status: string) {
  if (status === 'passed') return 'bg-emerald-600 text-white'
  if (status === 'verifying') return 'bg-sky-600 text-white animate-pulse'
  if (status === 'healing') return 'bg-amber-600 text-white animate-pulse'
  if (status === 'failed') return 'bg-red-600 text-white'
  return 'bg-slate-700 text-slate-300'
}

function getStatusLabel(status: string) {
  if (status === 'passed') return '自测通过 (0 报错)'
  if (status === 'verifying') return '正在验证中...'
  if (status === 'healing') return '正在自动修复...'
  if (status === 'failed') return '自愈失败 / 需人工介入'
  return '空闲待命'
}

function getAuditItemClass(type: string) {
  if (type === 'success') return 'border-emerald-800/60 bg-emerald-950/20 text-emerald-200'
  if (type === 'error') return 'border-red-800/60 bg-red-950/20 text-red-200'
  if (type === 'warn') return 'border-amber-800/60 bg-amber-950/20 text-amber-200'
  return 'border-sky-800/60 bg-sky-950/20 text-sky-200'
}
</script>
