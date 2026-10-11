import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupThunderIpc } from './ipc/thunder-bridge'
import { setupAgentIpc } from './ipc/agent-bridge'
import { setupProjectIpc } from './ipc/project-bridge'
import { setupHistoryIpc } from './ipc/history-bridge'
import { setupBrowserIpc } from './ipc/browser-bridge'
import { BrowserViewManager } from './browser-view-manager'
import { HostServerManager } from './host-server-manager'
import { ProjectRunner } from './project-runner'
import { setupPrototypeStoreIpc } from './project-store'
import { workspaceDir } from './app-paths'
import { applyPackagedRuntimeEnv } from './runtime-env'
import { syncThunderModelConfig } from './agent/thunder-model-config'

// 打包版的 userData 必须与 dev 分开，否则两边共用一份 localStorage、一份工作区；
// 而 Electron 的 app.getName() 取自 package.json 的 name（prototype-edit-llm），
// 不是 electron-builder 的 productName —— 不显式改掉，打包版就会把 185M 的
// runtime-host/ 和 bin/node 写进 dev 的 userData（实测过）。
// 只在打包态改：dev 的 userData 里是用户真实的原型与对话，改名字等于换库。
// 字符串与 electron-builder.yml 的 productName 必须保持一致。
if (app.isPackaged) app.setName('Prototype Studio')

/**
 * 本模块所在目录（即 `out/main/`），等价于 electron-vite 以往注入的 `__dirname`。
 *
 * 不直接用 `__dirname`：electron-vite 的 `esmShimPlugin` 会用正则扫描整
 * 个 bundle（**包括字符串字面量**）找「最后一个静态 import」并把 CJS 兼容垫片
 * 插在它后面。一旦主进程源码的某个模板字符串里出现 `import X from 'y'`
 * （例如内置 React 骨架代码），垫片就会被插进字符串里，`__dirname` 于是永远
 * 未定义并让主进程启动即崩。自己算目录可以彻底绕开这个陷阱。
 */
const moduleDir = dirname(fileURLToPath(import.meta.url))

// 强制内核级别停用所有 HTTP 缓存及 GPU Shader 缓存
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-gpu-program-cache')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: existsSync(join(moduleDir, '../preload/index.mjs')) ? join(moduleDir, '../preload/index.mjs') : join(moduleDir, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', async () => {
    // 强制清除 Session 数据
    if (mainWindow) {
      await mainWindow.webContents.session.clearCache()
      await mainWindow.webContents.session.clearStorageData({
        storages: ['cookies', 'shadercache', 'serviceworkers', 'cachestorage']
      })
      mainWindow.show()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 初始化内置浏览器及 CDP 控制桥接
  setupBrowserIpc(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(moduleDir, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    BrowserViewManager.getInstance().destroy()
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron.prototype-editor')

  // 打包版的图标由 electron-builder.yml 的 mac.icon 烤进 bundle，dev 下 dock 显示
  // 的却是 Electron 本体那个默认图；手动指过去，否则开发时看见的是「Electron」。
  // 路径按 out/main/ 往上两级找仓库根的 build/，打包版里没有这个目录，故只在 dev 走。
  if (is.dev && process.platform === 'darwin') {
    const devIcon = join(moduleDir, '../../build/icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 先备好打包运行时（主要是把 thunder 的数据根挪出用户 home），再起任何子进程：
  // HostServerManager 与 thunder 都靠环境变量找东西。dev 下是空操作。
  await applyPackagedRuntimeEnv()

  // thunder 的后台调用（自动命名会话等）只认它自己的 models.json，不认我们逐任务
  // 传的 model_descriptor。这里同步一次，免得它退回没 key 的内置目录并报
  // `[no_utility_model]`。agent-bridge 在拉起 daemon 前还会再同步一次。
  await syncThunderModelConfig()

  // 启动 runtime-host 本地纯净 Vite 服务 (方案 C) 与静态预览服务器
  const hostManager = HostServerManager.getInstance()
  await hostManager.startServer()
  const projectRunner = ProjectRunner.getInstance()
  await projectRunner.startStaticServer()

  // 注册通用宿主与原型代码写回 IPC
  ipcMain.handle('host:get-url', () => {
    return hostManager.getHostUrl()
  })

  ipcMain.handle(
    'host:save-prototype-file',
    async (
      _,
      { prototypeId, code, techStack }: { prototypeId: string; code: string; techStack?: string }
    ) => {
      try {
        const res = await projectRunner.syncAndResolvePreviewUrl({
          projectId: prototypeId || 'blank-prototype',
          code,
          techStack:
            techStack === 'react-ts' || techStack === 'native-html' || techStack === 'vue3-element'
              ? techStack
              : undefined
        })
        return {
          success: true,
          previewUrl: res.previewUrl,
          techStack: res.techStack,
          entryFile: res.entryFile
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  setupPrototypeStoreIpc()
  setupThunderIpc()
  setupProjectIpc()
  setupAgentIpc({ workspaceDir: workspaceDir() })
  // 原型版本仓（.prototype-history）：跟 agent 同一个工作区口径
  setupHistoryIpc({ workspaceDir: workspaceDir() })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  BrowserViewManager.getInstance().destroy()
  HostServerManager.getInstance().stopServer()
  ProjectRunner.getInstance().stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  BrowserViewManager.getInstance().destroy()
  HostServerManager.getInstance().stopServer()
  ProjectRunner.getInstance().stop()
})
