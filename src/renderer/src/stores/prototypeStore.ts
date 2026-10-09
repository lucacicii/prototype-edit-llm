import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref, computed, watch } from 'vue'

/**
 * 原型和对话原本只活在内存里：主进程没有落盘点，main.ts 是裸的 createPinia()，
 * 整个渲染层唯一碰 localStorage 的地方是导出目录。于是任何一次整页 reload
 * （改本模块就会触发——renderer 里没有任何 import.meta.hot.accept，Vite 只能
 * 把更新上溯到入口做 full reload）都会把 store 重新执行一遍，
 * 用户看到的就是「对话被清空、原型回到空白」。
 *
 * 所以在这里存一份快照。体量是「几个原型 × 代码 + 对话文本」，离 5MB 上限很远。
 */
const STORAGE_KEY = 'wb_prototype_store_v1'

/** 读快照；坏数据、隐私模式一律当没存过，绝不因此让应用起不来。 */
function loadSnapshot(): { prototypes: PrototypeItem[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const list = parsed?.prototypes
    if (!Array.isArray(list) || list.length === 0) return null
    if (!list.every((p: any) => p && typeof p.id === 'string' && Array.isArray(p.chatMessages))) return null
    return { prototypes: list as PrototypeItem[], activeId: String(parsed.activeId ?? '') }
  } catch {
    return null
  }
}

/** 一轮 run 结束后的统计（来自 run_finished / loop_complete 帧的 AgentStats）。 */
export interface RunStats {
  totalTurns: number
  promptTokens: number
  completionTokens: number
  durationMs: number
  toolExecutions: number
  tokensPerSecond?: number
}

export interface PrototypeItem {
  id: string
  name: string
  description: string
  vueCode: string
  chatMessages: {
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    inspectContext?: {
      tagName: string
      text?: string
    }
    /** 助手消息的本轮统计（页脚的「N 轮 · N tokens · N.Ns」）。 */
    stats?: RunStats
  }[]
  updatedAt: number
}

/**
 * 空白起始页。原型完全按用户提示词生成，这里不预置任何组件库规范。
 */
const DEFAULT_SKELETON_CODE = `<template>
  <div class="p-6">
    <h1 class="text-base font-medium text-slate-700">空白原型</h1>
    <p class="mt-2 text-sm text-slate-500">
      在左侧用自然语言描述页面需求，或用「🎯 圈选 / ✏️ 圈改」提出修改。
    </p>
  </div>
</template>

<script setup lang="ts">
<\/script>
`

/** 没有快照时（首次运行、或用户删光了快照）的空白起始原型。 */
function seedPrototypes(): PrototypeItem[] {
  return [
    {
      id: 'blank-prototype',
      name: '空白原型',
      description: '空白起始页，页面内容完全由用户提示词驱动生成',
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: '已创建空白原型。在左侧描述你的页面需求，或使用顶部「🎯 圈选 / ✏️ 圈改」提出修改。',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
  ]
}

export const usePrototypeStore = defineStore('prototypes', () => {
  const snapshot = loadSnapshot()

  /** 本次进程是不是从快照恢复的（false = 全新种子）。开屏是否把代码写回磁盘要看它。 */
  const hydratedFromSnapshot = !!snapshot

  const prototypes = ref<PrototypeItem[]>(snapshot?.prototypes ?? seedPrototypes())

  // 快照里的 activeId 可能指向已被删掉的原型，落回列表首个
  const activeId = ref<string>(
    snapshot && snapshot.prototypes.some((p) => p.id === snapshot.activeId)
      ? snapshot.activeId
      : prototypes.value[0].id
  )

  // 存快照。debounce 是为了流式追加对话时不要每个 token 都写一次；
  // 写失败（配额满 / 隐私模式）就丢这一次，不能打断编辑。
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    [prototypes, activeId],
    () => {
      clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ prototypes: prototypes.value, activeId: activeId.value })
          )
        } catch {
          /* 见上 */
        }
      }, 400)
    },
    { deep: true }
  )

  const currentPrototype = computed(() => {
    return prototypes.value.find((p) => p.id === activeId.value) || prototypes.value[0]
  })

  function setActive(id: string) {
    activeId.value = id
  }

  function createPrototype(name: string, description: string): PrototypeItem {
    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name,
      description,
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: `原型【${name}】已创建！现在可以在左侧描述你的需求或从右侧圈画。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function clonePrototype(sourceId: string): PrototypeItem | null {
    const source = prototypes.value.find((p) => p.id === sourceId)
    if (!source) return null

    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name: `${source.name} (副本)`,
      description: source.description,
      vueCode: source.vueCode,
      chatMessages: [
        {
          role: 'assistant',
          content: `已从【${source.name}】复制新原型副本。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function deletePrototype(id: string) {
    if (prototypes.value.length <= 1) return
    const index = prototypes.value.findIndex((p) => p.id === id)
    if (index > -1) {
      prototypes.value.splice(index, 1)
      if (activeId.value === id) {
        activeId.value = prototypes.value[0].id
      }
    }
  }

  function updateCode(id: string, code: string) {
    const p = prototypes.value.find((item) => item.id === id)
    if (p) {
      p.vueCode = code
      p.updatedAt = Date.now()
    }
  }

  return {
    prototypes,
    activeId,
    hydratedFromSnapshot,
    currentPrototype,
    setActive,
    createPrototype,
    clonePrototype,
    deletePrototype,
    updateCode
  }
})

// 本模块自己接受热更新。否则改它的时候 Vite 只能把更新沿 import 链上溯到入口
// （renderer 里没有任何 accept），结果就是整页 reload —— 连同正在跑的 run 一起清空。
// Pinia 会在热替换时用旧 state 里同名的键回填新 store（createSetupStore 的 initialState 分支），
// 所以这一步是「不丢现场」，不只是「少刷新一次」。
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePrototypeStore, import.meta.hot))
}
