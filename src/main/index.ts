import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupThunderIpc } from './ipc/thunder-bridge'
import { setupAgentIpc } from './ipc/agent-bridge'
import { setupProjectIpc } from './ipc/project-bridge'
import { setupBrowserIpc } from './ipc/browser-bridge'
import { BrowserViewManager } from './browser-view-manager'
import { HostServerManager } from './host-server-manager'

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
      preload: existsSync(join(__dirname, '../preload/index.mjs')) ? join(__dirname, '../preload/index.mjs') : join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      cache: false // 禁用渲染缓存
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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    BrowserViewManager.getInstance().destroy()
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron.prototype-editor')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 启动 runtime-host 本地纯净 Vite 服务 (方案 C)
  const hostManager = HostServerManager.getInstance()
  await hostManager.startServer()

  // 注册通用宿主与原型代码写回 IPC
  ipcMain.handle('host:get-url', () => {
    return hostManager.getHostUrl()
  })

  // The preview host renders a single active prototype file (`/prototypes/:id`
  // is a dynamic segment over one component), so the file name is fixed.
  ipcMain.handle('host:save-prototype-file', async (_, { code }: { prototypeId: string; code: string }) => {
    try {
      const filePath = join(__dirname, `../../runtime-host/src/views/prototypes/active.vue`)
      await fs.writeFile(filePath, code, 'utf-8')
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  setupThunderIpc()
  setupProjectIpc()
  setupAgentIpc({ workspaceDir: process.cwd() })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  BrowserViewManager.getInstance().destroy()
  HostServerManager.getInstance().stopServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  BrowserViewManager.getInstance().destroy()
  HostServerManager.getInstance().stopServer()
})
