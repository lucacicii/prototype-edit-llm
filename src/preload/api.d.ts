import { ElectronAPI } from '@electron-toolkit/preload'
// 只借类型：圈选/圈改指向的元素在主进程那侧已经有权威定义，别在这儿再抄一份
// （上一版就是抄了个 {tagName,text} 的窄版，把字段丢失藏到了编译期）。
import type { PointedTarget } from '../main/agent/prototype-agent'
// 版本元数据的权威定义在主进程那侧（同 PointedTarget 的口径，不在这儿抄一份）
import type { VersionKind, VersionMeta } from '../main/ipc/history-bridge'

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
  clearMarkups: (id?: string) => Promise<boolean>
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
  savePrototypeFile: (params: {
    prototypeId: string
    code: string
    techStack?: string
  }) => Promise<{
    success: boolean
    filePath?: string
    previewUrl?: string
    techStack?: string
    entryFile?: string
    error?: string
  }>
}

export interface IPrototypeAPI {
  list: () => Promise<{ ok: boolean; projects: any[]; activeId: string }>
  setActive: (id: string) => Promise<{ ok: boolean }>
  create: (params: {
    name: string
    description?: string
    scenario?: string
    preferredStack?: string
  }) => Promise<{ ok: boolean; item?: any; error?: string }>
  clone: (sourceId: string) => Promise<{ ok: boolean; item?: any; error?: string }>
  delete: (id: string) => Promise<{ ok: boolean; projects?: any[]; activeId?: string }>
  updateCode: (params: {
    id: string
    code: string
    filePath?: string
    techStack?: string
  }) => Promise<{ ok: boolean; item?: any; error?: string }>
  saveChat: (params: {
    id: string
    messages: any[]
    resetSession?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
  readFile: (params: {
    id: string
    filePath: string
  }) => Promise<{ ok: boolean; content?: string; filePath?: string; error?: string }>
  migrateLocalStorage: (items: any[]) => Promise<{
    ok: boolean
    migrated?: number
    projects?: any[]
    activeId?: string
  }>
}

export interface IHistoryAPI {
  /** 列出版本；带上 currentCode 才能标出「当前」是哪一版（回滚后它不是最新版）。 */
  list: (params: {
    prototypeId: string
    currentCode?: string
  }) => Promise<{
    ok: boolean
    versions?: VersionMeta[]
    currentVersion?: number | null
    latestVersion?: number | null
    error?: string
  }>
  read: (params: {
    prototypeId: string
    version: number
  }) => Promise<{ ok: boolean; code?: string; meta?: VersionMeta | null; error?: string }>
  /** `seedCode` 只在「这个原型还没有任何版本」时用来补一个起始版本。 */
  record: (params: {
    prototypeId: string
    code: string
    label?: string
    kind?: VersionKind
    seedCode?: string
    runId?: string
    pinned?: boolean
  }) => Promise<{
    ok: boolean
    version?: number
    /** 内容与最新一版相同，什么也没写。 */
    unchanged?: boolean
    seeded?: boolean
    pruned?: number[]
    error?: string
  }>
  rename: (params: {
    prototypeId: string
    version: number
    label: string
  }) => Promise<{ ok: boolean; meta?: VersionMeta; error?: string }>
  deleteVersion: (params: { prototypeId: string; version: number }) => Promise<{ ok: boolean; error?: string }>
  deleteAll: (params: { prototypeId: string }) => Promise<{ ok: boolean; error?: string }>
}

export interface IProjectAPI {
  selectDirectory: () => Promise<string | null>
  importDirectory: (portOrUrl?: string) => Promise<ProjectWorkspace | null>
  importUrl: (params: { url: string; name?: string }) => Promise<ProjectWorkspace>
  listWorkspaces: () => Promise<ProjectWorkspace[]>
  getCurrentWorkspace: () => Promise<ProjectWorkspace | null>
  switchWorkspace: (id: string) => Promise<ProjectWorkspace | null>
  findSourceFile: (target: string, prototypeId?: string) => Promise<{ filePath: string; content: string } | null>
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
    /** 没有模型时的原因，原样展示给用户。 */
    problem?: string | null
    config: {
      /** 指向本机模型库的引用（provider + id），不含端点与密钥。 */
      model?: { provider: string; id: string; name?: string }
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
    /** 就绪表：runtime / thunder 数据根，打包版缺哪环一眼可见。 */
    readiness?: Array<{ label: string; ok: boolean; detail: string }>
    /** 本机模型库（无密钥，只有 hasApiKey）。 */
    models?: Array<{
      selectionId: string
      provider: string
      id: string
      name: string
      api: string
      baseUrl: string
      hasApiKey: boolean
      /**
       * 密钥从哪来。`hasApiKey` 一个布尔说不清：全局的
       * PROTOTYPE_AGENT_API_KEY 会让每个服务商都显示「已保存」，
       * 所以「清除已存密钥」得靠这个字段判断该不该出现。
       */
      keySource?: 'stored' | 'env' | null
      reasoning: boolean
      contextWindow: number
      maxTokens: number
      thinkingLevels: string[]
      defaultThinkingLevel: string
      available: boolean
      /** 不可用的具体原因；available 为 false 时才有。 */
      unavailableReason?: string
      /** 支持的输入模态；含 'image' 才吃图。 */
      input?: string[]
      /** 以下四项是原样透传的字段，编辑时要一并回传，否则会被 upsert 丢掉。 */
      headers?: Record<string, string>
      thinkingLevelMap?: Record<string, string | null>
      cost?: Record<string, unknown>
      promptCache?: Record<string, unknown>
    }>
    /** 模型库文件位置（providers.json）。 */
    libraryPath?: string
    keyStore?: { encrypted: boolean }
    /** 内核真正支持的 api 方言；弹窗的 api 下拉就用它。 */
    apiOptions?: string[]
    /** 思考档位的合法取值（弱 → 强）。 */
    thinkingVocabulary?: string[]
    /** 新建模型时的默认数值。 */
    defaults?: { contextWindow: number; maxTokens: number; thinkingLevels: string[] }
    /** 本次调用从旧的内联配置里迁进模型库的模型。 */
    migrated?: string[]
    defaultModel?: { provider: string; id: string; name?: string } | null
    modelLabel?: string | null
    modelOrigin?: 'library' | 'env' | null
    tools?: Array<{ name: string; description: string; effect: string }>
  }>
  setConfig: (config: any) => Promise<{ ok: boolean; error?: string; path?: string }>
  tools: () => Promise<Array<{ name: string; description: string; effect?: string }>>
  /**
   * 新增/更新模型库中的一项。
   *
   * `apiKey` 留空 = 保留已存的那把；要清空请显式传 `clearApiKey`。
   * 对话框从来看不到已存的密钥，所以也不可能把它回传上来。
   */
  saveModel: (model: {
    provider: string
    id: string
    name?: string
    api: string
    baseUrl: string
    headers?: Record<string, string>
    reasoning?: boolean
    input?: string[]
    contextWindow?: number
    maxTokens?: number
    thinkingLevels?: string[]
    defaultThinkingLevel?: string
    thinkingLevelMap?: Record<string, string | null>
    cost?: Record<string, unknown>
    promptCache?: Record<string, unknown>
    apiKey?: string
    clearApiKey?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    model?: Record<string, any>
    keyStore?: { encrypted: boolean }
  }>
  deleteModel: (params: { provider: string; id: string }) => Promise<{
    ok: boolean
    error?: string
    /** 删掉的正是当前选中的模型，引用也一并清了。 */
    clearedSelection?: boolean
  }>
  /**
   * 删除一个服务商：它名下的全部模型 + 它的密钥。
   *
   * 服务商就是共享一个 provider id 的那组模型，所以「删服务商」＝删整组。
   * 库里没有这个 id 时返回 `ok:false`，不像 deleteModel 那样静默无操作 ——
   * 调用方是从列表里点进来的，「它不在」是需要知道的信息。
   */
  deleteProvider: (params: { provider: string }) => Promise<{
    ok: boolean
    error?: string
    provider?: string
    /** 跟着删掉的模型条数。 */
    removed?: number
    /** 删掉的正是当前选中模型所属的服务商，引用也一并清了。 */
    clearedSelection?: boolean
    /** 顺带清掉的孤儿密钥（库中已无对应 provider id）。 */
    droppedKeys?: string[]
  }>
  /**
   * 改一个服务商的端点（api + baseUrl），**一次写完整组**。
   *
   * 不能逐条 `saveModel`：`validateModel` 拿候选去比**磁盘上还没改的**同组模型，
   * 所以逐条写的第一次就会被自己的同组撞死，永远写不进去。端点属于服务商。
   * 密钥可选：`apiKey` 留空＝保持，要清空显式传 `clearApiKey`。
   */
  saveProvider: (input: {
    provider: string
    api: string
    baseUrl: string
    apiKey?: string
    clearApiKey?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    provider?: string
    /** 跟着改写的模型条数。 */
    updated?: number
    keyStore?: { encrypted: boolean }
  }>
  fetchRemoteModels: (params: {
    provider?: string
    api?: string
    baseUrl: string
    apiKey?: string
  }) => Promise<{
    ok: boolean
    error?: string
    models?: Array<{
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
      reasoning?: boolean
      supportsImages?: boolean
      thinkingLevels?: string[]
      defaultThinkingLevel?: string
    }>
  }>
  probeThinkingLevels: (params: {
    provider?: string
    api?: string
    baseUrl: string
    apiKey?: string
    modelId: string
  }) => Promise<{
    ok: boolean
    error?: string
    probed?: boolean
    reasoning?: boolean
    thinkingLevels?: string[]
    defaultThinkingLevel?: string
    source?: 'probed' | 'inferred'
  }>
  run: (params: {
    /** 渲染层生成并传入，让「停止」按钮能按 run 取消（main 端不传则自己生成）。 */
    runId?: string
    prototypeId: string
    prompt: string
    code: string
    history?: Array<{ role: string; content: string | null }>
    /** 圈选点中的元素（富字段：选择器/组件/源码位置）。 */
    inspectTarget?: PointedTarget
    /** 圈改框住的每一块：框里认出来的元素 + 框的范围（视口坐标）+ 该框的批注。 */
    markupTargets?: Array<{
      id?: string
      note: string
      rect: { left: number; top: number; width: number; height: number }
      element?: PointedTarget
    }>
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
    techStack?: string
  }>
  answerQuestion: (params: {
    questionId: string
    answers?: Record<string, any> | any
    cancelled?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
  steerTask: (params: {
    taskId: string
    message: string
    behavior?: 'steer' | 'follow_up'
  }) => Promise<{ ok: boolean; error?: string }>
  cancel: (runId: string) => Promise<boolean>
  onStreamEvent: (callback: (frame: any) => void) => () => void
  onUserQuestion: (
    callback: (data: {
      task_id: string
      session_id?: string
      question_id: string
      questions: Array<{
        question: string
        header?: string
        multi_select?: boolean
        options: Array<{ label: string; description?: string }>
      }>
    }) => void
  ) => () => void
  onCodeUpdated: (
    callback: (data: {
      code: string
      techStack?: string
      previewUrl?: string
      entryFile?: string
      experimental?: boolean
      stackChanged?: boolean
    }) => void
  ) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    thunder: IThunderAPI
    project: IProjectAPI
    hostApi: IHostAPI
    historyApi: IHistoryAPI
    prototypeApi: IPrototypeAPI
    browser: IBrowserAPI
    agent: IAgentAPI
  }
}
