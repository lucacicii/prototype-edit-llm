import { ElectronAPI } from '@electron-toolkit/preload'

export interface ProjectWorkspace {
  id: string
  name: string
  type: 'local-directory' | 'remote-url'
  url: string
  rootPath?: string
  framework: 'vue3' | 'vue2' | 'react' | 'native-dom' | 'unknown'
  uiLibrary?: string
  devTool?: 'vite' | 'webpack' | 'other'
  dependencies?: Record<string, string>
}

export interface IBrowserAPI {
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  show: () => Promise<boolean>
  hide: () => Promise<boolean>
  loadUrl: (url: string) => Promise<boolean>
  reload: () => Promise<boolean>
  goBack: () => Promise<boolean>
  goForward: () => Promise<boolean>
  setZoom: (factor: number) => Promise<boolean>
  getState: () => Promise<{
    canGoBack: boolean
    canGoForward: boolean
    isLoading: boolean
    url: string
    title: string
  }>
  toggleDevTools: () => Promise<boolean>
  openDevTools: (mode?: 'detach' | 'bottom' | 'right') => Promise<boolean>
  closeDevTools: () => Promise<boolean>
  setInspectMode: (mode: 'inspect' | 'markup' | 'off') => Promise<boolean>
  capturePage: () => Promise<string>
  getDiagnostics: () => Promise<{
    hasErrors: boolean
    errorCount: number
    warningCount: number
    errors: Array<{
      id: string
      timestamp: number
      level: 'info' | 'warn' | 'error' | 'network'
      category: string
      text: string
      url?: string
      line?: number
      column?: number
      stack?: string
      /** 'probe' = 工具注入脚本，'prototype' = 原型自己的代码。 */
      origin?: 'prototype' | 'probe'
    }>
    warnings: Array<any>
    /** 探针报错条数；这些不进 errors，也不触发自愈。 */
    probeErrorCount: number
    summary: string
  }>
  clearDiagnostics: () => Promise<boolean>
  onCdpLog: (callback: (entry: any) => void) => () => void
  onLogsCleared: (callback: () => void) => () => void
  onNavState: (callback: (state: any) => void) => () => void
  onInspectSelected: (callback: (target: any) => void) => () => void
  onMarkupSaved: (callback: (data: any) => void) => () => void
  onInspectCancelled: (callback: () => void) => () => void
}

export interface IThunderAPI {
  sendPrompt: (prompt: string) => Promise<any>
  runTask: (params: { task?: string; prompt?: string; model?: string; workspace?: string; taskId?: string }) => Promise<any>
  listModels: () => Promise<any>
  pingDaemon: () => Promise<any>
  onStreamEvent: (callback: (data: any) => void) => () => void
}

export interface IHostAPI {
  getHostUrl: () => Promise<string>
  savePrototypeFile: (params: { prototypeId: string; code: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
}

export interface IProjectAPI {
  selectDirectory: () => Promise<string | null>
  importDirectory: (portOrUrl?: string) => Promise<ProjectWorkspace | null>
  importUrl: (params: { url: string; name?: string }) => Promise<ProjectWorkspace>
  listWorkspaces: () => Promise<ProjectWorkspace[]>
  getCurrentWorkspace: () => Promise<ProjectWorkspace | null>
  switchWorkspace: (id: string) => Promise<ProjectWorkspace | null>
  findSourceFile: (target: string) => Promise<{ filePath: string; content: string } | null>
  saveCode: (params: { filePath: string; content: string }) => Promise<{ success: boolean; savedPath?: string; error?: string }>
  checkFileExists: (filePath: string) => Promise<{ exists: boolean }>
}

export interface IAgentAPI {
  ping: () => Promise<{
    ok: boolean
    version?: string
    error?: string
    runtimePath?: string
  }>
  getConfig: () => Promise<{
    configured: boolean
    config: {
      model?: Record<string, any>
      systemPrompt?: string
      maxTurns?: number
      temperature?: number
      thinkingLevel?: string
      requestTimeoutMs?: number
    }
    source?: 'env' | 'workspace' | 'home' | 'none'
    path?: string
    envLocked?: boolean
    runtimePath?: string
    /** Models read from ~/.thunder (no secrets, `hasApiKey` only). */
    models?: Array<{
      selectionId: string
      provider: string
      id: string
      name: string
      api: string
      baseUrl: string
      hasApiKey: boolean
      reasoning: boolean
      contextWindow: number
      maxTokens: number
      thinkingLevels: string[]
      defaultThinkingLevel: string
      available: boolean
      /** 支持的输入模态；含 'image' 才吃图（models.json 的 input）。 */
      input?: string[]
    }>
    utilityModel?: string
    modelSources?: string[]
    defaultModel?: { provider: string; id: string; name?: string } | null
    modelLabel?: string | null
    modelOrigin?: 'thunder' | 'inline' | null
    tools?: Array<{ name: string; description: string; effect: string }>
  }>
  setConfig: (config: any) => Promise<{ ok: boolean; error?: string; path?: string }>
  tools: () => Promise<Array<{ name: string; description: string; effect?: string }>>
  run: (params: {
    /** 渲染层生成并传入，让「停止」按钮能按 run 取消（main 端不传则自己生成）。 */
    runId?: string
    prototypeId: string
    prompt: string
    code: string
    history?: Array<{ role: string; content: string | null }>
    inspectTarget?: { tagName: string; text: string }
    /** 圈改框住的那块：框里认出来的元素 + 框的范围（视口坐标）。 */
    markupTarget?: {
      note: string
      rect: { left: number; top: number; width: number; height: number }
      element?: {
        tagName: string
        text: string
        className?: string
        selector?: string
        componentName?: string
        sourceFile?: string
        sourceLine?: number | null
        stack?: string[]
      }
    }
    /** 图片附件；`data` 是 base64，不含 `data:` 前缀。 */
    attachments?: Array<{ name: string; mimeType: string; data: string }>
  }) => Promise<{
    ok: boolean
    runId?: string
    error?: string
    /** 'cancelled' 表示用户点了停止 —— 正常结束，不是错误。 */
    finishReason?: string
    finalContent?: string | null
    code?: string
  }>
  cancel: (runId: string) => Promise<boolean>
  onStreamEvent: (callback: (frame: any) => void) => () => void
  onCodeUpdated: (callback: (data: { code: string }) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    thunder: IThunderAPI
    project: IProjectAPI
    hostApi: IHostAPI
    browser: IBrowserAPI
    agent: IAgentAPI
  }
}
