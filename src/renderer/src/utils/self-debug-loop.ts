import { ref } from 'vue'

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

export class SelfDebugEngine {
  public status = ref<SelfDebugStatus>('idle')
  public currentRound = ref<number>(0)
  public maxRounds = ref<number>(3)
  public auditHistory = ref<SelfDebugAuditItem[]>([])
  public lastSummary = ref<string>('')
  public autoHealEnabled = ref<boolean>(true)

  private logSeq = 0

  public addAuditLog(
    round: number,
    type: 'info' | 'warn' | 'error' | 'success',
    title: string,
    details?: string
  ) {
    this.auditHistory.value.unshift({
      id: `audit_${++this.logSeq}`,
      round,
      timestamp: Date.now(),
      type,
      title,
      details
    })
    if (this.auditHistory.value.length > 100) {
      this.auditHistory.value.pop()
    }
  }

  public clearHistory() {
    this.auditHistory.value = []
    this.status.value = 'idle'
    this.currentRound.value = 0
    this.lastSummary.value = ''
  }

  /**
   * 触发一次自闭环检查与自动修复
   */
  public async executeLoop(options: SelfDebugOptions): Promise<{
    success: boolean
    rounds: number
    summary: string
  }> {
    const maxRounds = options.maxRounds || 3
    this.maxRounds.value = maxRounds
    this.currentRound.value = 1

    this.addAuditLog(1, 'info', '🚀 启动自闭环 Debug 验证流程', '等待 Vite HMR 与浏览器渲染稳定 (1200ms)...')

    while (this.currentRound.value <= maxRounds) {
      const round = this.currentRound.value
      this.status.value = 'verifying'

      // 1. 等待 HMR 和渲染执行稳定
      await new Promise((r) => setTimeout(r, 1200))

      // 2. 从 CDP 获取当前运行期诊断
      if (!window.browser?.getDiagnostics) {
        this.status.value = 'idle'
        return { success: true, rounds: round, summary: '环境未启用 CDP' }
      }

      const diag = await window.browser.getDiagnostics()

      // 3. 无报错：自检通过
      if (!diag.hasErrors) {
        this.status.value = 'passed'
        this.lastSummary.value = `第 ${round} 轮自检通过：页面正常渲染，控制台与运行时 0 报错！`
        this.addAuditLog(round, 'success', '✅ 自测通过', this.lastSummary.value)
        options.onLog?.(this.lastSummary.value)
        return {
          success: true,
          rounds: round,
          summary: this.lastSummary.value
        }
      }

      // 4. 存在报错：记录审计
      this.addAuditLog(
        round,
        'warn',
        `⚠️ 第 ${round} 轮检测到 ${diag.errorCount} 项错误`,
        diag.summary
      )

      // 如果未开启自动修复，直接停留在 failed
      if (!this.autoHealEnabled.value) {
        this.status.value = 'failed'
        this.lastSummary.value = `检测到 ${diag.errorCount} 项报错 (自动修复已暂停)`
        return { success: false, rounds: round, summary: this.lastSummary.value }
      }

      // 若已达最大轮次，宣告失败并返回
      if (round >= maxRounds) {
        this.status.value = 'failed'
        this.lastSummary.value = `已尝试 ${maxRounds} 轮自动修复，仍存在报错，请人工查看。`
        this.addAuditLog(round, 'error', '❌ 自动修复次数耗尽', this.lastSummary.value)
        options.onLog?.(this.lastSummary.value)
        return {
          success: false,
          rounds: round,
          summary: this.lastSummary.value
        }
      }

      // 5. 组织自愈 Prompt，呼叫 Thunder 进行针对性修复
      this.status.value = 'healing'
      this.addAuditLog(
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

【当前报错的完整 Vue 3 代码】
\`\`\`vue
${currentCode}
\`\`\`

【修复要求】
1. 深入分析报错原因（如组件/函数未定义、缺失响应式属性、插槽书写有误、异步数据未初始化或语法异常）。
2. 修复所有报错并保持既有原型功能、列配置和交互逻辑不变。
3. 严格只输出修复后的完整单个 \`\`\`vue ... \`\`\` 代码块，不要包含任何多余文字。
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
          const fixedCode = this.extractVueCode(finalReply)

          if (fixedCode) {
            this.addAuditLog(round, 'info', `📝 第 ${round} 轮代码已重写并推送到 Vite`, '即将重新验证...')
            await options.updateCode(fixedCode)
            // 清理上一轮旧日志，重新监测
            await window.browser.clearDiagnostics()
            this.currentRound.value = round + 1
          } else {
            throw new Error('未从 AI 回复中提取到有效的 Vue SFC 代码')
          }
        } else {
          throw new Error('Thunder 守护进程未连接')
        }
      } catch (err: any) {
        this.status.value = 'failed'
        this.lastSummary.value = `自愈修复异常: ${err.message}`
        this.addAuditLog(round, 'error', '自愈执行失败', err.message)
        return { success: false, rounds: round, summary: this.lastSummary.value }
      }
    }

    this.status.value = 'failed'
    return { success: false, rounds: maxRounds, summary: '自闭环结束' }
  }

  private extractVueCode(markdown: string): string | null {
    const vueMatch = markdown.match(/```(?:vue|html)?\s*([\s\S]*?)```/)
    if (vueMatch && vueMatch[1]) {
      return vueMatch[1].trim()
    }
    return null
  }
}

export const selfDebugEngine = new SelfDebugEngine()
