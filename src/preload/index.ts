import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const thunderApi = {
  // Thunder Agent 桥接
  sendPrompt: (prompt: string) => ipcRenderer.invoke('thunder:send-prompt', prompt),
  runTask: (params: { task?: string; prompt?: string; model?: string; workspace?: string; taskId?: string }) =>
    ipcRenderer.invoke('thunder:run-task', params),
  listModels: () => ipcRenderer.invoke('thunder:list-models'),
  pingDaemon: () => ipcRenderer.invoke('thunder:ping'),
  onStreamEvent: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('thunder:stream-event', handler)
    return () => ipcRenderer.removeListener('thunder:stream-event', handler)
  }
}

const hostApi = {
  // Runtime Host 交互。techStack 决定落盘扩展名（.vue/.tsx/.html），
  // 缺省 vue3-element 与存量快照兼容。
  getHostUrl: () => ipcRenderer.invoke('host:get-url'),
  savePrototypeFile: (params: {
    prototypeId: string
    code: string
    techStack?: 'vue3-element' | 'react-ts' | 'native-html'
  }) => ipcRenderer.invoke('host:save-prototype-file', params)
}

// 名字带 Api 后缀是必要的：window.history 是 DOM 全局，不能占用那个名字。
const historyApi = {
  // 原型版本仓（工作区 .prototype-history）
  list: (params: { prototypeId: string; currentCode?: string }) =>
    ipcRenderer.invoke('history:list', params),
  read: (params: { prototypeId: string; version: number }) =>
    ipcRenderer.invoke('history:read', params),
  record: (params: {
    prototypeId: string
    code: string
    label?: string
    kind?: 'seed' | 'auto' | 'manual' | 'rollback-safety'
    /** 该原型还没有任何版本时，先把改动前的代码存成 v1。 */
    seedCode?: string
    runId?: string
    pinned?: boolean
  }) => ipcRenderer.invoke('history:record', params),
  rename: (params: { prototypeId: string; version: number; label: string }) =>
    ipcRenderer.invoke('history:rename', params),
  deleteVersion: (params: { prototypeId: string; version: number }) =>
    ipcRenderer.invoke('history:delete', params),
  deleteAll: (params: { prototypeId: string }) => ipcRenderer.invoke('history:delete-all', params)
}

const prototypeApi = {
  // 独立原型项目存储（~/.prototype-studio/projects/<id>/）
  list: () => ipcRenderer.invoke('prototype:list'),
  setActive: (id: string) => ipcRenderer.invoke('prototype:set-active', id),
  create: (params: {
    name: string
    description?: string
    scenario?: string
    preferredStack?: string
  }) => ipcRenderer.invoke('prototype:create', params),
  clone: (sourceId: string) => ipcRenderer.invoke('prototype:clone', sourceId),
  delete: (id: string) => ipcRenderer.invoke('prototype:delete', id),
  updateCode: (params: { id: string; code: string; filePath?: string; techStack?: string }) =>
    ipcRenderer.invoke('prototype:update-code', params),
  saveChat: (params: { id: string; messages: any[]; resetSession?: boolean }) =>
    ipcRenderer.invoke('prototype:save-chat', params),
  readFile: (params: { id: string; filePath: string }) =>
    ipcRenderer.invoke('prototype:read-file', params),
  migrateLocalStorage: (items: any[]) =>
    ipcRenderer.invoke('prototype:migrate-localstorage', items)
}

const agentApi = {
  // 原型 Agent（thunder-daemon 全能力宿主）
  ping: () => ipcRenderer.invoke('agent:ping'),
  getConfig: () => ipcRenderer.invoke('agent:get-config'),
  setConfig: (config: any) => ipcRenderer.invoke('agent:set-config', config),
  tools: () => ipcRenderer.invoke('agent:tools'),
  // 模型库的增删。密钥单独走 saveModel 的 apiKey 字段，读回来的视图里永远没有它。
  saveModel: (model: any) => ipcRenderer.invoke('agent:save-model', model),
  deleteModel: (params: { provider: string; id: string }) =>
    ipcRenderer.invoke('agent:delete-model', params),
  // 服务商＝共享一个 provider id 的那组模型，所以删除它就是删掉整组 + 它的密钥。
  deleteProvider: (params: { provider: string }) =>
    ipcRenderer.invoke('agent:delete-provider', params),
  // 改端点也是服务商级的：写一次整组，不能逐条 saveModel（会被自己的同组撞死）。
  saveProvider: (input: any) => ipcRenderer.invoke('agent:save-provider', input),
  fetchRemoteModels: (params: { provider?: string; api?: string; baseUrl: string; apiKey?: string }) =>
    ipcRenderer.invoke('agent:fetch-remote-models', params),
  probeThinkingLevels: (params: {
    provider?: string
    api?: string
    baseUrl: string
    apiKey?: string
    modelId: string
  }) => ipcRenderer.invoke('agent:probe-thinking-levels', params),
  answerQuestion: (params: {
    questionId: string
    answers?: Record<string, any> | any
    cancelled?: boolean
  }) => ipcRenderer.invoke('agent:answer-question', params),
  steerTask: (params: { taskId: string; message: string; behavior?: 'steer' | 'follow_up' }) =>
    ipcRenderer.invoke('agent:steer-task', params),
  run: (params: any) => ipcRenderer.invoke('agent:run', params),
  cancel: (runId: string) => ipcRenderer.invoke('agent:cancel', runId),
  onStreamEvent: (callback: (frame: any) => void) => {
    const handler = (_: any, frame: any) => callback(frame)
    ipcRenderer.on('agent:stream-event', handler)
    return () => ipcRenderer.removeListener('agent:stream-event', handler)
  },
  onUserQuestion: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:user-question', handler)
    return () => ipcRenderer.removeListener('agent:user-question', handler)
  },
  onCodeUpdated: (callback: (data: {
    code: string
    techStack?: string
    previewUrl?: string
    entryFile?: string
    experimental?: boolean
    stackChanged?: boolean
  }) => void) => {
    const handler = (_: any, data: {
      code: string
      techStack?: string
      previewUrl?: string
      entryFile?: string
      experimental?: boolean
      stackChanged?: boolean
    }) => callback(data)
    ipcRenderer.on('agent:code-updated', handler)
    return () => ipcRenderer.removeListener('agent:code-updated', handler)
  },
  onModeChanged: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:mode-changed', handler)
    return () => ipcRenderer.removeListener('agent:mode-changed', handler)
  },
  onUiNotice: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:ui-notice', handler)
    return () => ipcRenderer.removeListener('agent:ui-notice', handler)
  }
}

const topologyApi = {
  // 原型页面拓扑图（生成 → 截各页图 → 导出成一份自包含 HTML）
  generate: (params: { prototypeId: string }) => ipcRenderer.invoke('topology:generate', params),
  cancel: () => ipcRenderer.invoke('topology:cancel'),
  // 节点缩略图（nodeId → dataURL）。单独取，避免把整页长图塞进 prototype:list。
  shots: (params: { prototypeId: string }) => ipcRenderer.invoke('topology:shots', params),
  exportHtml: (params: { prototypeId: string }) =>
    ipcRenderer.invoke('topology:export-html', params)
}

const projectApi = {
  // 本地业务工程与共享工作区交互
  selectDirectory: () => ipcRenderer.invoke('project:select-directory'),
  importDirectory: (portOrUrl?: string) => ipcRenderer.invoke('project:import-directory', portOrUrl),
  importUrl: (params: { url: string; name?: string }) => ipcRenderer.invoke('project:import-url', params),
  listWorkspaces: () => ipcRenderer.invoke('project:list-workspaces'),
  getCurrentWorkspace: () => ipcRenderer.invoke('project:get-current-workspace'),
  switchWorkspace: (id: string) => ipcRenderer.invoke('project:switch-workspace', id),
  addRepo: (params: {
    workspaceId: string
    dirPath?: string
    dirPaths?: string[]
    role?: 'primary' | 'reference'
  }) => ipcRenderer.invoke('project:add-repo', params),
  removeRepo: (params: { workspaceId: string; repoPath: string }) =>
    ipcRenderer.invoke('project:remove-repo', params),
  setPrimaryRepo: (params: { workspaceId: string; repoPath: string }) =>
    ipcRenderer.invoke('project:set-primary-repo', params),
  updateWorkspaceMeta: (params: { workspaceId: string; name?: string; url?: string }) =>
    ipcRenderer.invoke('project:update-workspace-meta', params),
  removeWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke('project:remove-workspace', workspaceId),
  listSharedFiles: (workspaceId: string) =>
    ipcRenderer.invoke('project:list-shared-files', workspaceId),
  readSharedFile: (params: { workspaceId: string; relPath: string }) =>
    ipcRenderer.invoke('project:read-shared-file', params),
  writeSharedFile: (params: { workspaceId: string; relPath: string; content: string }) =>
    ipcRenderer.invoke('project:write-shared-file', params),
  deleteSharedFile: (params: { workspaceId: string; relPath: string }) =>
    ipcRenderer.invoke('project:delete-shared-file', params),
  refreshSharedWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke('project:refresh-shared-workspace', workspaceId),
  findSourceFile: (target: string, prototypeId?: string) =>
    ipcRenderer.invoke('project:find-source-file', target, prototypeId),
  saveCode: (params: { filePath: string; content: string }) =>
    ipcRenderer.invoke('project:save-code', params),
  checkFileExists: (filePath: string) =>
    ipcRenderer.invoke('project:check-file-exists', filePath)
}

const browserApi = {
  // 内置浏览器视口与控制
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser:set-bounds', bounds),
  show: () => ipcRenderer.invoke('browser:show'),
  hide: () => ipcRenderer.invoke('browser:hide'),
  loadUrl: (url: string) => ipcRenderer.invoke('browser:load-url', url),
  reload: () => ipcRenderer.invoke('browser:reload'),
  goBack: () => ipcRenderer.invoke('browser:go-back'),
  goForward: () => ipcRenderer.invoke('browser:go-forward'),
  setZoom: (factor: number) => ipcRenderer.invoke('browser:set-zoom', factor),
  getState: () => ipcRenderer.invoke('browser:get-state'),

  // Chrome DevTools 原生面板与调试
  toggleDevTools: () => ipcRenderer.invoke('browser:toggle-devtools'),
  openDevTools: (mode?: 'detach' | 'bottom' | 'right') =>
    ipcRenderer.invoke('browser:open-devtools', mode),
  closeDevTools: () => ipcRenderer.invoke('browser:close-devtools'),

  // 圈改与标注探针
  setInspectMode: (mode: 'inspect' | 'markup' | 'off') =>
    ipcRenderer.invoke('browser:set-inspect-mode', mode),
  // 不带 id = 清掉所有圈改框；带 id = 只清那一个
  clearMarkups: (id?: string) => ipcRenderer.invoke('browser:clear-markups', id),
  capturePage: () => ipcRenderer.invoke('browser:capture-page'),

  // CDP 运行期诊断与自闭环
  getDiagnostics: () => ipcRenderer.invoke('browser:get-diagnostics'),
  clearDiagnostics: () => ipcRenderer.invoke('browser:clear-diagnostics'),

  // 事件监听
  onCdpLog: (callback: (entry: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('browser:cdp-log', handler)
    return () => ipcRenderer.removeListener('browser:cdp-log', handler)
  },
  onLogsCleared: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('browser:cdp-logs-cleared', handler)
    return () => ipcRenderer.removeListener('browser:cdp-logs-cleared', handler)
  },
  onNavState: (callback: (state: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('browser:nav-state', handler)
    return () => ipcRenderer.removeListener('browser:nav-state', handler)
  },
  onInspectSelected: (callback: (target: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('browser:inspect-selected', handler)
    return () => ipcRenderer.removeListener('browser:inspect-selected', handler)
  },
  onMarkupSaved: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('browser:markup-saved', handler)
    return () => ipcRenderer.removeListener('browser:markup-saved', handler)
  },
  onInspectCancelled: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('browser:inspect-cancelled', handler)
    return () => ipcRenderer.removeListener('browser:inspect-cancelled', handler)
  }
}

const materialApi = {
  list: () => ipcRenderer.invoke('material:list'),
  uploadDialog: (options?: { category?: string; description?: string }) =>
    ipcRenderer.invoke('material:upload-dialog', options),
  uploadFiles: (params: {
    files: Array<{
      name: string
      dataBase64: string
      mimeType?: string
      description?: string
      category?: string
    }>
  }) => ipcRenderer.invoke('material:upload-files', params),
  update: (params: {
    id: string
    name?: string
    description?: string
    category?: string
    tags?: string[]
    enabled?: boolean
  }) => ipcRenderer.invoke('material:update', params),
  delete: (id: string) => ipcRenderer.invoke('material:delete', id),
  readContent: (idOrFileName: string) => ipcRenderer.invoke('material:read-content', idOrFileName)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('thunder', thunderApi)
    contextBridge.exposeInMainWorld('project', projectApi)
    contextBridge.exposeInMainWorld('hostApi', hostApi)
    contextBridge.exposeInMainWorld('historyApi', historyApi)
    contextBridge.exposeInMainWorld('prototypeApi', prototypeApi)
    contextBridge.exposeInMainWorld('materialApi', materialApi)
    contextBridge.exposeInMainWorld('topologyApi', topologyApi)
    contextBridge.exposeInMainWorld('browser', browserApi)
    contextBridge.exposeInMainWorld('agent', agentApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.thunder = thunderApi
  // @ts-ignore
  window.project = projectApi
  // @ts-ignore
  window.hostApi = hostApi
  // @ts-ignore
  window.historyApi = historyApi
  // @ts-ignore
  window.prototypeApi = prototypeApi
  // @ts-ignore
  window.materialApi = materialApi
  // @ts-ignore
  window.topologyApi = topologyApi
  // @ts-ignore
  window.browser = browserApi
  // @ts-ignore
  window.agent = agentApi
}
