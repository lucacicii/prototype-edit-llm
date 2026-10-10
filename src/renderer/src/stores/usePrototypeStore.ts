import { create } from 'zustand'

const STORAGE_KEY = 'wb_prototype_store_v1'

export interface RunStats {
  totalTurns: number
  promptTokens: number
  completionTokens: number
  durationMs: number
  toolExecutions: number
  tokensPerSecond?: number
}

export interface PrototypeChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  inspectContext?: {
    tagName: string
    text?: string
  }
  attachments?: {
    kind: 'image' | 'text'
    name: string
    mimeType?: string
    bytes: number
    truncated?: boolean
  }[]
  stats?: RunStats
}

export interface PrototypeItem {
  id: string
  name: string
  description: string
  techStack?: 'vue3-element' | 'react-ts' | 'native-html'
  vueCode: string
  chatMessages: PrototypeChatMessage[]
  updatedAt: number
}

const DEFAULT_SKELETON_CODE = `// tech-stack: vue3-element
<template>
  <div class="p-6">
    <h1 class="text-base font-medium text-slate-700">空白原型</h1>
    <p class="mt-2 text-sm text-slate-500">
      在左侧用自然语言描述页面需求，或用「🎯 圈选 / ✏️ 圈改」提出修改。
    </p>
  </div>
</template>

<script setup lang="ts">
</script>
`

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

let persistTimer: ReturnType<typeof setTimeout> | undefined
function schedulePersist(prototypes: PrototypeItem[], activeId: string) {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ prototypes, activeId }))
    } catch {
      // ignore quota errors
    }
  }, 400)
}

interface PrototypeStoreState {
  prototypes: PrototypeItem[]
  activeId: string
  hydratedFromSnapshot: boolean
  setActive: (id: string) => void
  createPrototype: (name: string, description: string) => PrototypeItem
  clonePrototype: (sourceId: string) => PrototypeItem | null
  deletePrototype: (id: string) => void
  updateCode: (id: string, code: string) => void
  updateTechStack: (id: string, techStack: 'vue3-element' | 'react-ts' | 'native-html') => void
  addChatMessage: (prototypeId: string, message: PrototypeChatMessage) => void
  resetChat: (prototypeId: string) => void
}

const initialSnapshot = loadSnapshot()
const initialPrototypes = initialSnapshot?.prototypes ?? seedPrototypes()
const initialActiveId =
  initialSnapshot && initialSnapshot.prototypes.some((p) => p.id === initialSnapshot.activeId)
    ? initialSnapshot.activeId
    : initialPrototypes[0].id

export const usePrototypeStore = create<PrototypeStoreState>((set, get) => ({
  prototypes: initialPrototypes,
  activeId: initialActiveId,
  hydratedFromSnapshot: !!initialSnapshot,

  setActive: (id: string) => {
    set({ activeId: id })
    schedulePersist(get().prototypes, id)
  },

  createPrototype: (name: string, description: string) => {
    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name,
      description,
      techStack: 'vue3-element',
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
    const updated = [newItem, ...get().prototypes]
    set({ prototypes: updated, activeId: id })
    schedulePersist(updated, id)
    return newItem
  },

  clonePrototype: (sourceId: string) => {
    const source = get().prototypes.find((p) => p.id === sourceId)
    if (!source) return null

    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name: `${source.name} (副本)`,
      description: source.description,
      techStack: source.techStack,
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
    const updated = [newItem, ...get().prototypes]
    set({ prototypes: updated, activeId: id })
    schedulePersist(updated, id)
    return newItem
  },

  deletePrototype: (id: string) => {
    const list = get().prototypes
    if (list.length <= 1) return
    const updated = list.filter((p) => p.id !== id)
    let nextActiveId = get().activeId
    if (nextActiveId === id) {
      nextActiveId = updated[0].id
    }
    set({ prototypes: updated, activeId: nextActiveId })
    schedulePersist(updated, nextActiveId)
  },

  updateCode: (id: string, code: string) => {
    const updated = get().prototypes.map((p) =>
      p.id === id ? { ...p, vueCode: code, updatedAt: Date.now() } : p
    )
    set({ prototypes: updated })
    schedulePersist(updated, get().activeId)
  },

  updateTechStack: (id: string, techStack: 'vue3-element' | 'react-ts' | 'native-html') => {
    const updated = get().prototypes.map((p) =>
      p.id === id && p.techStack !== techStack
        ? { ...p, techStack, updatedAt: Date.now() }
        : p
    )
    set({ prototypes: updated })
    schedulePersist(updated, get().activeId)
  },

  addChatMessage: (prototypeId: string, message: PrototypeChatMessage) => {
    const updated = get().prototypes.map((p) =>
      p.id === prototypeId
        ? { ...p, chatMessages: [...p.chatMessages, message], updatedAt: Date.now() }
        : p
    )
    set({ prototypes: updated })
    schedulePersist(updated, get().activeId)
  },

  resetChat: (prototypeId: string) => {
    const proto = get().prototypes.find((p) => p.id === prototypeId)
    if (!proto) return
    const updated = get().prototypes.map((p) =>
      p.id === prototypeId
        ? {
            ...p,
            chatMessages: [
              {
                role: 'assistant' as const,
                content: `已重置当前原型【${proto.name}】的对话历史。你可以通过自然语言提出修改，或使用内置浏览器“🎯 圈选”或“✏️ 圈改”工具。`,
                timestamp: Date.now()
              }
            ],
            updatedAt: Date.now()
          }
        : p
    )
    set({ prototypes: updated })
    schedulePersist(updated, get().activeId)
  }
}))

export function useCurrentPrototype(): PrototypeItem {
  const prototypes = usePrototypeStore((state) => state.prototypes)
  const activeId = usePrototypeStore((state) => state.activeId)
  return prototypes.find((p) => p.id === activeId) || prototypes[0]
}
