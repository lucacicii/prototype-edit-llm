import { create } from 'zustand'
import type { PrototypeChatMessage } from './usePrototypeStore'

/**
 * 外部工作区（导入的本地工程 / 外部 URL）的对话记录。
 *
 * 「我的原型」的对话跟着原型项目走（存在项目目录里）；外部工作区没有项目目录，
 * 所以按工作区 id 单独存一份，避免和当前原型共用同一条对话。
 * `epoch` 用来换一个新的 agent 会话（重发/重新生成时，对应原型项目的 resetSession）。
 */
const STORAGE_KEY = 'wb_workspace_chats_v1'

interface WorkspaceChat {
  messages: PrototypeChatMessage[]
  epoch: number
}

function load(): Record<string, WorkspaceChat> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persist(chats: Record<string, WorkspaceChat>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
  } catch {
    // 配额不足等：对话丢失可以接受
  }
}

interface WorkspaceChatState {
  chats: Record<string, WorkspaceChat>
  addMessage: (workspaceId: string, message: PrototypeChatMessage) => void
  truncate: (workspaceId: string, keepCount: number) => PrototypeChatMessage[]
}

const EMPTY: WorkspaceChat = { messages: [], epoch: 0 }

export const useWorkspaceChatStore = create<WorkspaceChatState>((set, get) => ({
  chats: load(),

  addMessage: (workspaceId, message) => {
    const cur = get().chats[workspaceId] ?? EMPTY
    const chats = {
      ...get().chats,
      [workspaceId]: { ...cur, messages: [...cur.messages, message] }
    }
    set({ chats })
    persist(chats)
  },

  truncate: (workspaceId, keepCount) => {
    const cur = get().chats[workspaceId] ?? EMPTY
    const kept = cur.messages.slice(0, Math.max(0, keepCount))
    const chats = {
      ...get().chats,
      [workspaceId]: { messages: kept, epoch: cur.epoch + 1 }
    }
    set({ chats })
    persist(chats)
    return kept
  }
}))

/** 发给 agent 的会话键：epoch 变了就是一个全新的会话。 */
export function workspaceSessionKey(workspaceId: string, epoch: number): string {
  return epoch > 0 ? `${workspaceId}~${epoch}` : workspaceId
}
