import { WebContents, BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

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
}

export interface DiagnosticSnapshot {
  hasErrors: boolean
  errorCount: number
  warningCount: number
  errors: CdpLogEntry[]
  warnings: CdpLogEntry[]
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

  public getDiagnosticSnapshot(): DiagnosticSnapshot {
    const errors = this.logs.filter((l) => l.level === 'error')
    const warnings = this.logs.filter((l) => l.level === 'warn')

    const summary = errors.length > 0
      ? `检测到 ${errors.length} 项运行时错误:\n` +
        errors
          .map((e, idx) => `[错误 ${idx + 1}] ${e.text} ${e.url ? `(${e.url}:${e.line || 0})` : ''}\n${e.stack ? e.stack : ''}`)
          .join('\n\n')
      : '页面运行正常，控制台无报错。'

    return {
      hasErrors: errors.length > 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      summary
    }
  }
}
