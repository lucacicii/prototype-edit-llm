import { create } from 'zustand'

export interface SelfDebugAuditItem {
  id: string
  round: number
  timestamp: number
  type: 'info' | 'warn' | 'error' | 'success'
  title: string
  details?: string
}

export type SelfDebugStatus = 'idle' | 'verifying' | 'healing' | 'passed' | 'failed'

export interface SelfDebugOptions {
  prototypeId: string
  getCurrentCode: () => string
  updateCode: (newCode: string) => Promise<void>
  maxRounds?: number
  onLog?: (msg: string) => void
}

interface SelfDebugStoreState {
  status: SelfDebugStatus
  currentRound: number
  maxRounds: number
  auditHistory: SelfDebugAuditItem[]
  lastSummary: string
  autoHealEnabled: boolean
  addAuditLog: (round: number, type: 'info' | 'warn' | 'error' | 'success', title: string, details?: string) => void
  clearHistory: () => void
  setStatus: (status: SelfDebugStatus) => void
  setCurrentRound: (round: number) => void
  setLastSummary: (summary: string) => void
  setAutoHealEnabled: (enabled: boolean) => void
}

let logSeq = 0

export const useSelfDebugStore = create<SelfDebugStoreState>((set) => ({
  status: 'idle',
  currentRound: 0,
  maxRounds: 3,
  auditHistory: [],
  lastSummary: '',
  autoHealEnabled: true,

  addAuditLog: (round, type, title, details) => {
    set((state) => {
      const item: SelfDebugAuditItem = {
        id: `audit_${++logSeq}`,
        round,
        timestamp: Date.now(),
        type,
        title,
        details
      }
      const updated = [item, ...state.auditHistory]
      if (updated.length > 100) updated.pop()
      return { auditHistory: updated }
    })
  },

  clearHistory: () => {
    set({
      auditHistory: [],
      status: 'idle',
      currentRound: 0,
      lastSummary: ''
    })
  },

  setStatus: (status) => set({ status }),
  setCurrentRound: (currentRound) => set({ currentRound }),
  setLastSummary: (lastSummary) => set({ lastSummary }),
  setAutoHealEnabled: (autoHealEnabled) => set({ autoHealEnabled })
}))

export class SelfDebugEngine {
  public get status() {
    return useSelfDebugStore.getState().status
  }
  public get currentRound() {
    return useSelfDebugStore.getState().currentRound
  }
  public get auditHistory() {
    return useSelfDebugStore.getState().auditHistory
  }

  public addAuditLog(
    round: number,
    type: 'info' | 'warn' | 'error' | 'success',
    title: string,
    details?: string
  ) {
    useSelfDebugStore.getState().addAuditLog(round, type, title, details)
  }

  public clearHistory() {
    useSelfDebugStore.getState().clearHistory()
  }

  public async executeLoop(options: SelfDebugOptions): Promise<{
    success: boolean
    rounds: number
    summary: string
  }> {
    const store = useSelfDebugStore.getState()
    const maxRounds = options.maxRounds || 3
    store.setCurrentRound(1)
    store.addAuditLog(1, 'info', '🚀 启动自闭环 Debug 验证流程', '等待 Vite HMR 与浏览器渲染稳定 (1200ms)...')

    let round = 1
    while (round <= maxRounds) {
      store.setStatus('verifying')
      store.setCurrentRound(round)

      // 1. 等待 HMR 和渲染执行稳定
      await new Promise((r) => setTimeout(r, 1200))

      // 2. 从 CDP 获取当前运行期诊断
      if (!window.browser?.getDiagnostics) {
        store.setStatus('idle')
        return { success: true, rounds: round, summary: '环境未启用 CDP' }
      }

      const diag = await window.browser.getDiagnostics()

      // 3. 无报错：自检通过
      if (!diag.hasErrors) {
        const summary = `第 ${round} 轮自检通过：页面正常渲染，控制台与运行时 0 报错！`
        store.setStatus('passed')
        store.setLastSummary(summary)
        store.addAuditLog(round, 'success', '✅ 自测通过', summary)
        options.onLog?.(summary)
        return {
          success: true,
          rounds: round,
          summary
        }
      }

      // 4. 存在报错：记录审计
      store.addAuditLog(
        round,
        'warn',
        `⚠️ 第 ${round} 轮检测到 ${diag.errorCount} 项错误`,
        diag.summary
      )

      if (!useSelfDebugStore.getState().autoHealEnabled) {
        const summary = `检测到 ${diag.errorCount} 项报错 (自动修复已暂停)`
        store.setStatus('failed')
        store.setLastSummary(summary)
        return { success: false, rounds: round, summary }
      }

      if (round >= maxRounds) {
        const summary = `已尝试 ${maxRounds} 轮自动修复，仍存在报错，请人工查看。`
        store.setStatus('failed')
        store.setLastSummary(summary)
        store.addAuditLog(round, 'error', '❌ 自动修复次数耗尽', summary)
        options.onLog?.(summary)
        return {
          success: false,
          rounds: round,
          summary
        }
      }

      // 5. 组织自愈 Prompt
      store.setStatus('healing')
      store.addAuditLog(
        round,
        'info',
        `🤖 组织第 ${round} 轮自愈 Prompt`,
        '正在调用 Thunder 针对报错精准修复...'
      )

      const currentCode = options.getCurrentCode()
      const repairPrompt = `
你是一名资深的前端架构专家。当前原型代码在 Electron 内置 Chromium 浏览器运行时捕获到以下具体报错：

【CDP 捕获的错误与堆栈】
${diag.summary}

【当前报错的完整代码】
\`\`\`
${currentCode}
\`\`\`

【修复要求】
1. 深入分析报错原因并修复所有报错。
2. 保持原有结构与配置完好。
3. 严格只输出修复后的完整单个代码块，不要包含任何多余文字。
`

      try {
        let assistantReply = ''
        if (window.thunder?.runTask) {
          const unsubscribe = window.thunder.onStreamEvent((event: any) => {
            if (event.type === 'token' || event.type === 'chunk') {
              assistantReply += event.content || ''
            }
          })

          const res = await window.thunder.runTask({
            task: repairPrompt,
            prompt: repairPrompt
          })
          unsubscribe?.()

          const finalReply = res?.output || res?.result || assistantReply
          const fixedCode = this.extractCode(finalReply)

          if (fixedCode) {
            store.addAuditLog(round, 'info', `📝 第 ${round} 轮代码已重写并推送到 Vite`, '即将重新验证...')
            await options.updateCode(fixedCode)
            await window.browser.clearDiagnostics()
            round += 1
          } else {
            throw new Error('未从 AI 回复中提取到有效代码')
          }
        } else {
          throw new Error('Thunder 守护进程未连接')
        }
      } catch (err: any) {
        const summary = `自愈修复异常: ${err.message}`
        store.setStatus('failed')
        store.setLastSummary(summary)
        store.addAuditLog(round, 'error', '自愈执行失败', err.message)
        return { success: false, rounds: round, summary }
      }
    }

    store.setStatus('failed')
    return { success: false, rounds: maxRounds, summary: '自闭环结束' }
  }

  private extractCode(markdown: string): string | null {
    const match = markdown.match(/```(?:\w+)?\s*([\s\S]*?)```/)
    if (match && match[1]) {
      return match[1].trim()
    }
    return null
  }
}

export const selfDebugEngine = new SelfDebugEngine()
