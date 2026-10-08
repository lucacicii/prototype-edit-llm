import { ipcMain, BrowserWindow } from 'electron'
import { BrowserViewManager, BrowserBounds } from '../browser-view-manager'

export function setupBrowserIpc(mainWindow: BrowserWindow): void {
  const browserManager = BrowserViewManager.getInstance()
  browserManager.init(mainWindow)

  ipcMain.handle('browser:set-bounds', (_event, bounds: BrowserBounds) => {
    browserManager.setBounds(bounds)
    return true
  })

  ipcMain.handle('browser:show', () => {
    browserManager.show()
    return true
  })

  ipcMain.handle('browser:hide', () => {
    browserManager.hide()
    return true
  })

  ipcMain.handle('browser:load-url', async (_event, url: string) => {
    await browserManager.loadURL(url)
    return true
  })

  ipcMain.handle('browser:reload', () => {
    browserManager.reload()
    return true
  })

  ipcMain.handle('browser:go-back', () => {
    browserManager.goBack()
    return true
  })

  ipcMain.handle('browser:go-forward', () => {
    browserManager.goForward()
    return true
  })

  ipcMain.handle('browser:set-zoom', (_event, factor: number) => {
    browserManager.setZoom(factor)
    return true
  })

  ipcMain.handle('browser:get-state', () => {
    return browserManager.getNavState()
  })

  ipcMain.handle('browser:toggle-devtools', () => {
    browserManager.toggleDevTools()
    return true
  })

  ipcMain.handle('browser:open-devtools', (_event, mode?: 'detach' | 'bottom' | 'right') => {
    browserManager.openDevTools(mode)
    return true
  })

  ipcMain.handle('browser:close-devtools', () => {
    browserManager.closeDevTools()
    return true
  })

  ipcMain.handle('browser:set-inspect-mode', async (_event, mode: 'inspect' | 'markup' | 'off') => {
    await browserManager.setInspectMode(mode)
    return true
  })

  ipcMain.handle('browser:capture-page', async () => {
    return browserManager.capturePage()
  })

  ipcMain.handle('browser:get-diagnostics', () => {
    return browserManager.getDiagnostics()
  })

  ipcMain.handle('browser:clear-diagnostics', () => {
    browserManager.clearDiagnostics()
    return true
  })
}
