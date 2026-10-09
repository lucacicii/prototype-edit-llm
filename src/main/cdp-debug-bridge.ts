import { WebContents, BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

/**
 * 一条日志是谁炸的。
 * - `probe`：原型工具的注入脚本（圈选/圈改探针），工具自己的 bug。
 * - `prototype`：原型页面自己的代码。
 * 分不清这两者时，探针的错误会被当成原型报错展示，还附送一个「AI 修复」按钮，
 * 等于让 AI 去改生成的原型代码来修工具 —— 所以必须标出来。
 */
export type CdpLogOrigin = 'prototype' | 'probe'

/**
 * 注入探针在 `injected-browser-probe.ts` 末尾用 `//# sourceURL=` 给自己起的名字。
 * `executeJavaScript` 注入的脚本默认没有 URL（栈帧是 `<anonymous>:641:22`），
 * 加了这行之后探针的每一帧都带着它。
 */
const PROBE_SOURCE_URL = '__prototype_probe__.js'

export interface CdpLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'network'
  category: 'console' | 'runtime' | 'network' | 'system'
  text: string
  url?: string
  line?: number
  column?: number
  stack?: string
  /** 代码来源；网络类日志没有代码归属，故为可选。 */
  origin?: CdpLogOrigin
}

export interface DiagnosticSnapshot {
  hasErrors: boolean
  errorCount: number
  warningCount: number
  /** 只含原型代码的报错 —— 探针错误单独记在 probeErrorCount。 */
  errors: CdpLogEntry[]
  warnings: CdpLogEntry[]
  /** 被排除在 errors 之外的探针报错条数。 */
  probeErrorCount: number
  summary: string
}

export class CdpDebugBridge extends EventEmitter {
  private targetContents: WebContents
  private ownerWindow: BrowserWindow | null = null
  private isAttached: boolean = false
  private logs: CdpLogEntry[] = []
  private maxLogs: number = 300
  private logSeq: number = 0

  constructor(targetContents: WebContents, ownerWindow?: BrowserWindow) {
    super()
    this.targetContents = targetContents
    this.ownerWindow = ownerWindow || null
  }

  public setOwnerWindow(win: BrowserWindow) {
    this.ownerWindow = win
  }

  public async attach(): Promise<boolean> {
    if (this.isAttached) return true

    try {
      if (this.targetContents.debugger.isAttached()) {
        this.isAttached = true
        return true
      }

      this.targetContents.debugger.attach('1.3')
      this.isAttached = true

      this.targetContents.debugger.on('message', (_event, method, params) => {
        this.handleCdpMessage(method, params)
      })

      this.targetContents.debugger.on('detach', (_event, reason) => {
        console.log('[CDP] Debugger detached:', reason)
        this.isAttached = false
      })

      // Enable relevant CDP domains
      await this.sendCommand('Console.enable')
      await this.sendCommand('Runtime.enable')
      await this.sendCommand('Page.enable')
      await this.sendCommand('Network.enable')

      console.log('[CDP] Debugger attached & domains enabled')
      return true
    } catch (err: any) {
      console.warn('[CDP] Failed to attach debugger:', err?.message || err)
      return false
    }
  }

  public detach(): void {
    if (this.isAttached && this.targetContents.debugger.isAttached()) {
      try {
        this.targetContents.debugger.detach()
      } catch (e) {
        // ignore
      }
      this.isAttached = false
    }
  }

  public async sendCommand(method: string, commandParams?: any): Promise<any> {
    if (!this.isAttached && !(await this.attach())) {
      throw new Error('CDP debugger is not attached')
    }
    return this.targetContents.debugger.sendCommand(method, commandParams)
  }

  /**
   * 判定一条报错的代码来源：栈里**任何一帧**来自探针脚本就算探针的。
   *
   * 看任意帧而不是只看栈顶，是因为探针会去摸 Vue 内部结构
   * （`resolveComponentMetadata`），炸点可能落在原型的 bundle 里，而该改的是探针。
   * 反向不会误判：探针从不回调原型的事件处理器，原型自己的报错栈里不会有探针帧。
   */
  private classifyOrigin(frames: any[] | undefined, url?: string): CdpLogOrigin {
    const framed = (frames || []).some(
      (f) => typeof f?.url === 'string' && f.url.includes(PROBE_SOURCE_URL)
    )
    if (framed) return 'probe'
    return typeof url === 'string' && url.includes(PROBE_SOURCE_URL) ? 'probe' : 'prototype'
  }

  private handleCdpMessage(method: string, params: any): void {
    if (method === 'Console.messageAdded') {
      const msg = params.message
      const text: string = msg.text || ''

      // Intercept probe communications
      if (text.startsWith('__PROTOTYPE_INSPECT_RESULT__')) {
        try {
          const payload = JSON.parse(text.replace('__PROTOTYPE_INSPECT_RESULT__', ''))
          this.emit('inspect-selected', payload)
          this.broadcast('browser:inspect-selected', payload)
        } catch (e) {
          console.error('[CDP] Failed to parse inspect payload:', e)
        }
        return
      }

      if (text.startsWith('__PROTOTYPE_MARKUP_RESULT__')) {
        try {
          const payload = JSON.parse(text.replace('__PROTOTYPE_MARKUP_RESULT__', ''))
          this.emit('markup-saved', payload)
          this.broadcast('browser:markup-saved', payload)
        } catch (e) {
          console.error('[CDP] Failed to parse markup payload:', e)
        }
        return
      }

      if (text.startsWith('__PROTOTYPE_INSPECT_CANCELLED__')) {
        this.emit('inspect-cancelled')
        this.broadcast('browser:inspect-cancelled', {})
        return
      }

      let level: CdpLogEntry['level'] = 'info'
      if (msg.level === 'error') level = 'error'
      else if (msg.level === 'warning') level = 'warn'

      // Detect Vue warnings which often log as warning/error
      if (text.includes('[Vue warn]') || text.includes('Unhandled error during execution')) {
        level = 'error'
      }

      const entry: CdpLogEntry = {
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level,
        category: 'console',
        text,
        origin: this.classifyOrigin(msg.stackTrace?.callFrames, msg.url),
        url: msg.url,
        line: msg.line,
        column: msg.column,
        stack: msg.stackTrace?.callFrames
          ? msg.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || 'anonymous'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join('\n')
          : undefined
      }

      this.addLog(entry)
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails
      const text = details.exception?.description || details.text || 'Uncaught Runtime Exception'

      const entry: CdpLogEntry = {
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level: 'error',
        category: 'runtime',
        text,
        origin: this.classifyOrigin(details.stackTrace?.callFrames, details.url),
        url: details.url,
        line: details.lineNumber,
        column: details.columnNumber,
        stack: details.stackTrace?.callFrames
          ? details.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || 'anonymous'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join('\n')
          : text
      }

      this.addLog(entry)
    } else if (method === 'Network.responseReceived') {
      const resp = params.response
      if (resp && resp.status >= 400) {
        const entry: CdpLogEntry = {
          id: `cdp_${++this.logSeq}`,
          timestamp: Date.now(),
          level: 'error',
          category: 'network',
          text: `HTTP ${resp.status} ${resp.statusText || ''} - ${resp.url}`,
          url: resp.url
        }
        this.addLog(entry)
      }
    } else if (method === 'Network.loadingFailed') {
      const entry: CdpLogEntry = {
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level: 'error',
        category: 'network',
        text: `Request Failed: ${params.errorText || 'Network error'}`,
        url: params.requestId
      }
      this.addLog(entry)
    }
  }

  private addLog(entry: CdpLogEntry) {
    this.logs.push(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
    this.emit('log', entry)
    this.broadcast('browser:cdp-log', entry)
  }

  private broadcast(channel: string, payload: any) {
    if (this.ownerWindow && !this.ownerWindow.isDestroyed()) {
      this.ownerWindow.webContents.send(channel, payload)
    }
  }

  public getLogs(): CdpLogEntry[] {
    return [...this.logs]
  }

  public clearLogs(): void {
    this.logs = []
    this.broadcast('browser:cdp-logs-cleared', {})
  }

  /**
   * 给自闭环修复循环和 get_runtime_diagnostics 工具用的快照。
   *
   * 探针的报错**不进 errors**：它会让 hasErrors 变真，把自动修复引到生成的原型代码上，
   * 而那段代码没问题。条数记在 probeErrorCount 里，并在 summary 里点名，信息不丢。
   */
  public getDiagnosticSnapshot(): DiagnosticSnapshot {
    const probeErrors = this.logs.filter((l) => l.level === 'error' && l.origin === 'probe')
    const errors = this.logs.filter((l) => l.level === 'error' && l.origin !== 'probe')
    const warnings = this.logs.filter((l) => l.level === 'warn' && l.origin !== 'probe')

    const probeNote = probeErrors.length
      ? `\n（另有 ${probeErrors.length} 条报错来自原型工具自身的注入探针，与原型代码无关，已排除，不要试图修改原型去修它。）`
      : ''

    const summary =
      (errors.length > 0
        ? `检测到 ${errors.length} 项运行时错误:\n` +
          errors
            .map((e, idx) => `[错误 ${idx + 1}] ${e.text} ${e.url ? `(${e.url}:${e.line || 0})` : ''}\n${e.stack ? e.stack : ''}`)
            .join('\n\n')
        : '页面运行正常，控制台无报错。') + probeNote

    return {
      hasErrors: errors.length > 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      probeErrorCount: probeErrors.length,
      summary
    }
  }
}
