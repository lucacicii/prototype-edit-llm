import { create } from 'zustand'
import type { TopologyGraph } from '../../../shared/topology'

const LEGACY_STORAGE_KEY = 'wb_prototype_store_v1'
const MIGRATED_FLAG_KEY = 'wb_prototype_store_migrated_to_disk_v1'

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

export type ProductScenario =
  | 'auto'
  | 'website'
  | 'admin'
  | 'mobile'
  | 'dashboard'
  | 'custom'

export type PreferredStack =
  | 'auto'
  | 'vue3-element'
  | 'react-ts'
  | 'native-html'

export interface PrototypeItem {
  id: string
  name: string
  description: string
  scenario?: ProductScenario
  preferredStack?: PreferredStack
  techStack?: 'vue3-element' | 'react-ts' | 'native-html'
  entryFile?: string
  rootPath?: string
  sessionId?: string
  files?: string[]
  vueCode: string
  chatMessages: PrototypeChatMessage[]
  /** 页面跳转流转图；没生成过就是 null。跟着 prototype:list 一起从主进程回来。 */
  topology?: TopologyGraph | null
  updatedAt: number
}

const DEFAULT_SKELETON_CODE = `<!-- tech-stack: native-html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>空白原型项目</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-50 flex items-center justify-center p-6">
  <div class="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 text-center">
    <h1 class="text-base font-semibold text-slate-800">空白原型项目</h1>
    <p class="mt-2 text-xs text-slate-500">在左侧向 AI 产品顾问描述你的需求，或点击右上角圈选修改。</p>
  </div>
</body>
</html>
`

function seedPrototypes(): PrototypeItem[] {
  return [
    {
      id: 'blank-prototype',
      name: '空白原型项目',
      description: '独立原型项目，由 AI 产品顾问引导规划与生成',
      scenario: 'auto',
      preferredStack: 'auto',
      techStack: 'native-html',
      entryFile: 'index.html',
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content:
            '已创建独立原型项目（位于 `~/.prototype-studio/projects/`）。告诉我你想做什么产品，我会先向你提问确认核心细节，再自动选定技术栈并生成完整代码。',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
  ]
}

interface PrototypeStoreState {
  prototypes: PrototypeItem[]
  activeId: string
  hydratedFromSnapshot: boolean
  loadFromDisk: () => Promise<void>
  setActive: (id: string) => void
  createPrototype: (
    name: string,
    description: string,
    scenario?: ProductScenario,
    preferredStack?: PreferredStack
  ) => Promise<PrototypeItem>
  clonePrototype: (sourceId: string) => Promise<PrototypeItem | null>
  deletePrototype: (id: string) => Promise<void>
  updateCode: (id: string, code: string, filePath?: string) => void
  updateTechStack: (
    id: string,
    techStack: 'vue3-element' | 'react-ts' | 'native-html',
    entryFile?: string
  ) => void
  addChatMessage: (prototypeId: string, message: PrototypeChatMessage) => void
  /** 只保留前 keepCount 条消息，并重置 thunder 会话（重发/重新生成用）。 */
  truncateChat: (prototypeId: string, keepCount: number) => PrototypeChatMessage[]
  /** 记下新生成的拓扑图。落盘是主进程做的，这里只同步内存。 */
  setTopology: (id: string, graph: TopologyGraph | null) => void
}

const initialPrototypes = seedPrototypes()

export const usePrototypeStore = create<PrototypeStoreState>((set, get) => ({
  prototypes: initialPrototypes,
  activeId: initialPrototypes[0].id,
  hydratedFromSnapshot: false,

  loadFromDisk: async () => {
    if (!window.prototypeApi) return

    // One-time migration from legacy localStorage into ~/.prototype-studio/projects/
    try {
      const migratedFlag = localStorage.getItem(MIGRATED_FLAG_KEY)
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!migratedFlag && legacyRaw) {
        const parsed = JSON.parse(legacyRaw)
        if (Array.isArray(parsed?.prototypes) && parsed.prototypes.length > 0) {
          await window.prototypeApi.migrateLocalStorage(parsed.prototypes)
        }
        localStorage.setItem(MIGRATED_FLAG_KEY, '1')
      }
    } catch {
      // ignore migration errors
    }

    try {
      const res = await window.prototypeApi.list()
      if (res?.ok && Array.isArray(res.projects) && res.projects.length > 0) {
        set({
          prototypes: res.projects,
          activeId: res.activeId || res.projects[0].id,
          hydratedFromSnapshot: true
        })
      }
    } catch (e) {
      console.warn('[usePrototypeStore] loadFromDisk failed:', e)
    }
  },

  setActive: (id: string) => {
    set({ activeId: id })
    window.prototypeApi?.setActive(id).catch(() => {})
  },

  createPrototype: async (
    name: string,
    description: string,
    scenario: ProductScenario = 'auto',
    preferredStack: PreferredStack = 'auto'
  ) => {
    if (window.prototypeApi?.create) {
      const res = await window.prototypeApi.create({
        name,
        description,
        scenario,
        preferredStack
      })
      if (res?.ok && res.item) {
        const updated = [res.item, ...get().prototypes.filter((p) => p.id !== res.item.id)]
        set({ prototypes: updated, activeId: res.item.id })
        return res.item as PrototypeItem
      }
    }

    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name,
      description,
      scenario,
      preferredStack,
      techStack: preferredStack === 'auto' ? 'native-html' : preferredStack,
      vueCode: DEFAULT_SKELETON_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: `原型项目【${name}】已创建！现在可以在左侧描述你的需求或从右侧圈画。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    const updated = [newItem, ...get().prototypes]
    set({ prototypes: updated, activeId: id })
    return newItem
  },

  clonePrototype: async (sourceId: string) => {
    if (window.prototypeApi?.clone) {
      const res = await window.prototypeApi.clone(sourceId)
      if (res?.ok && res.item) {
        const updated = [res.item, ...get().prototypes]
        set({ prototypes: updated, activeId: res.item.id })
        return res.item as PrototypeItem
      }
    }
    return null
  },

  deletePrototype: async (id: string) => {
    const list = get().prototypes
    if (list.length <= 1) return

    if (window.prototypeApi?.delete) {
      const res = await window.prototypeApi.delete(id)
      if (res?.ok && Array.isArray(res.projects) && res.projects.length > 0) {
        set({
          prototypes: res.projects,
          activeId: res.activeId || res.projects[0].id
        })
        return
      }
    }

    const updated = list.filter((p) => p.id !== id)
    let nextActiveId = get().activeId
    if (nextActiveId === id) {
      nextActiveId = updated[0].id
    }
    set({ prototypes: updated, activeId: nextActiveId })
  },

  updateCode: (id: string, code: string, filePath?: string) => {
    const updated = get().prototypes.map((p) =>
      p.id === id ? { ...p, vueCode: code, updatedAt: Date.now() } : p
    )
    set({ prototypes: updated })

    window.prototypeApi
      ?.updateCode({ id, code, filePath })
      .then((res) => {
        if (res?.ok && res.item) {
          set({
            prototypes: get().prototypes.map((p) =>
              p.id === id
                ? {
                    ...p,
                    techStack: res.item.techStack ?? p.techStack,
                    entryFile: res.item.entryFile ?? p.entryFile,
                    files: res.item.files ?? p.files
                  }
                : p
            )
          })
        }
      })
      .catch(() => {})
  },

  updateTechStack: (
    id: string,
    techStack: 'vue3-element' | 'react-ts' | 'native-html',
    entryFile?: string
  ) => {
    const updated = get().prototypes.map((p) =>
      p.id === id
        ? {
            ...p,
            techStack,
            entryFile: entryFile ?? p.entryFile,
            updatedAt: Date.now()
          }
        : p
    )
    set({ prototypes: updated })
  },

  addChatMessage: (prototypeId: string, message: PrototypeChatMessage) => {
    let nextMessages: PrototypeChatMessage[] = []
    const updated = get().prototypes.map((p) => {
      if (p.id === prototypeId) {
        nextMessages = [...p.chatMessages, message]
        return { ...p, chatMessages: nextMessages, updatedAt: Date.now() }
      }
      return p
    })
    set({ prototypes: updated })
    if (nextMessages.length > 0) {
      window.prototypeApi?.saveChat({ id: prototypeId, messages: nextMessages }).catch(() => {})
    }
  },

  truncateChat: (prototypeId: string, keepCount: number) => {
    const proto = get().prototypes.find((p) => p.id === prototypeId)
    if (!proto) return []
    const kept = proto.chatMessages.slice(0, Math.max(0, keepCount))
    const updated = get().prototypes.map((p) =>
      p.id === prototypeId ? { ...p, chatMessages: kept, updatedAt: Date.now() } : p
    )
    set({ prototypes: updated })
    window.prototypeApi
      ?.saveChat({ id: prototypeId, messages: kept, resetSession: true })
      .then(() => get().loadFromDisk())
      .catch(() => {})
    return kept
  },

  setTopology: (id: string, graph: TopologyGraph | null) => {
    set({
      prototypes: get().prototypes.map((p) =>
        p.id === id ? { ...p, topology: graph, updatedAt: Date.now() } : p
      )
    })
  }
}))

export function useCurrentPrototype(): PrototypeItem {
  const prototypes = usePrototypeStore((state) => state.prototypes)
  const activeId = usePrototypeStore((state) => state.activeId)
  return prototypes.find((p) => p.id === activeId) || prototypes[0]
}
