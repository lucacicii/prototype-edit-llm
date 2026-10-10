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
  // Runtime Host 交互
  getHostUrl: () => ipcRenderer.invoke('host:get-url'),
  savePrototypeFile: (params: { prototypeId: string; code: string }) =>
    ipcRenderer.invoke('host:save-prototype-file', params)
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

const agentApi = {
  // 原型 Agent（thunder-runtime 通用内核）
  ping: () => ipcRenderer.invoke('agent:ping'),
  getConfig: () => ipcRenderer.invoke('agent:get-config'),
  setConfig: (config: any) => ipcRenderer.invoke('agent:set-config', config),
  tools: () => ipcRenderer.invoke('agent:tools'),
  importThunderHome: () => ipcRenderer.invoke('agent:import-thunder-home'),
  run: (params: any) => ipcRenderer.invoke('agent:run', params),
  cancel: (runId: string) => ipcRenderer.invoke('agent:cancel', runId),
  onStreamEvent: (callback: (frame: any) => void) => {
    const handler = (_: any, frame: any) => callback(frame)
    ipcRenderer.on('agent:stream-event', handler)
    return () => ipcRenderer.removeListener('agent:stream-event', handler)
  },
  onCodeUpdated: (callback: (data: { code: string }) => void) => {
    const handler = (_: any, data: { code: string }) => callback(data)
    ipcRenderer.on('agent:code-updated', handler)
    return () => ipcRenderer.removeListener('agent:code-updated', handler)
  }
}

const projectApi = {
  // 本地业务工程与工作区交互
  selectDirectory: () => ipcRenderer.invoke('project:select-directory'),
  importDirectory: (portOrUrl?: string) => ipcRenderer.invoke('project:import-directory', portOrUrl),
  importUrl: (params: { url: string; name?: string }) => ipcRenderer.invoke('project:import-url', params),
  listWorkspaces: () => ipcRenderer.invoke('project:list-workspaces'),
  getCurrentWorkspace: () => ipcRenderer.invoke('project:get-current-workspace'),
  switchWorkspace: (id: string) => ipcRenderer.invoke('project:switch-workspace', id),
  findSourceFile: (target: string) => ipcRenderer.invoke('project:find-source-file', target),
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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('thunder', thunderApi)
    contextBridge.exposeInMainWorld('project', projectApi)
    contextBridge.exposeInMainWorld('hostApi', hostApi)
    contextBridge.exposeInMainWorld('historyApi', historyApi)
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
  window.browser = browserApi
  // @ts-ignore
  window.agent = agentApi
}
