import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { promises as fs, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupThunderIpc } from './ipc/thunder-bridge'
import { setupAgentIpc } from './ipc/agent-bridge'
import { setupProjectIpc } from './ipc/project-bridge'
import { setupHistoryIpc } from './ipc/history-bridge'
import { setupBrowserIpc } from './ipc/browser-bridge'
import { BrowserViewManager } from './browser-view-manager'
import { HostServerManager } from './host-server-manager'
import { activePrototypeFile, prototypeStackMarker, workspaceDir } from './app-paths'
import { applyPackagedRuntimeEnv } from './runtime-env'

// 打包版的 userData 必须与 dev 分开，否则两边共用一份 localStorage、一份工作区；
// 而 Electron 的 app.getName() 取自 package.json 的 name（prototype-edit-llm），
// 不是 electron-builder 的 productName —— 不显式改掉，打包版就会把 185M 的
// runtime-host/ 和 bin/node 写进 dev 的 userData（实测过）。
// 只在打包态改：dev 的 userData 里是用户真实的原型与对话，改名字等于换库。
// 字符串与 electron-builder.yml 的 productName 必须保持一致。
if (app.isPackaged) app.setName('Prototype Studio')

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

  // 打包版的图标由 electron-builder.yml 的 mac.icon 烤进 bundle，dev 下 dock 显示
  // 的却是 Electron 本体那个默认图；手动指过去，否则开发时看见的是「Electron」。
  // 路径按 out/main/ 往上两级找仓库根的 build/，打包版里没有这个目录，故只在 dev 走。
  if (is.dev && process.platform === 'darwin') {
    const devIcon = join(__dirname, '../../build/icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 先备好打包运行时（主要是把 thunder 的数据根挪出用户 home），再起任何子进程：
  // HostServerManager 与 thunder 都靠环境变量找东西。dev 下是空操作。
  await applyPackagedRuntimeEnv()

  // 启动 runtime-host 本地纯净 Vite 服务 (方案 C)
  const hostManager = HostServerManager.getInstance()
  await hostManager.startServer()

  // 注册通用宿主与原型代码写回 IPC
  ipcMain.handle('host:get-url', () => {
    return hostManager.getHostUrl()
  })

  // The preview host renders a single active prototype file
  // (`/prototypes/:id` is a dynamic segment over one component, the file
  // name is fixed per tech stack: active.vue / active.tsx / active.html).
  //
  // 内容没变就不写：每次落盘都会让 runtime-host 的 Vite 把预览整页刷新一次。
  // 渲染层开屏会把 store 里的代码写回这里（reload 后 store 可能是从快照恢复的），
  // 而「写 → 预览刷新」如果又能引回一次同步，就成了每秒好几次的自激循环。
  // 幂等写入把这条路堵死，顺带也消掉了切换原型时无意义的预览闪烁。
  ipcMain.handle('host:save-prototype-file', async (_, { code, techStack }: { prototypeId: string; code: string; techStack?: string }) => {
    try {
      // 栈由渲染层按当前原型传入（agent 仲裁出的栈会广播回来）；
      // 缺省 vue3-element，与存量快照的 .vue 落盘保持一致。
      const stack = techStack === 'react-ts' || techStack === 'native-html'
        ? techStack
        : 'vue3-element'
      // 标记文件与落盘文件必须同栈，否则预览刷回来还是旧栈的组件。
      const marker = prototypeStackMarker()
      await fs.mkdir(dirname(marker), { recursive: true })
      const markerCurrent = await fs.readFile(marker, 'utf-8').catch(() => null)
      if (markerCurrent !== stack) {
        await fs.writeFile(marker, stack, 'utf-8')
      }
      const filePath = activePrototypeFile(stack)
      // 栈切换后旧扩展名的文件还在磁盘上 —— 预览路由按标记走
      // 新文件，旧文件留着只会让「换回来」时读到陈年代码。
      for (const ext of ['vue', 'tsx', 'html']) {
        const cur = stack === 'react-ts' ? 'tsx' : stack === 'native-html' ? 'html' : 'vue'
        if (ext === cur) continue
        await fs.rm(join(dirname(filePath), `active.${ext}`), { force: true })
      }
      const current = await fs.readFile(filePath, 'utf-8').catch(() => null)
      if (current === code) {
        return { success: true, filePath, unchanged: true }
      }
      await fs.writeFile(filePath, code, 'utf-8')
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  BrowserViewManager.getInstance().destroy()
  HostServerManager.getInstance().stopServer()
})
