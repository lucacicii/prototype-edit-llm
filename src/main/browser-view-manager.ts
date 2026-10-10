import { BrowserView, BrowserWindow, WebContents } from 'electron'
import { CdpDebugBridge, DiagnosticSnapshot } from './cdp-debug-bridge'
import { BROWSER_PROBE_SCRIPT } from './injected-browser-probe'

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NavState {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  url: string
  title: string
}

export class BrowserViewManager {
  private static instance: BrowserViewManager
  private ownerWindow: BrowserWindow | null = null
  private browserView: BrowserView | null = null
  private cdpBridge: CdpDebugBridge | null = null
  private isVisible: boolean = false
  private currentBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  private currentUrl: string = 'http://127.0.0.1:4321'
  private currentZoomFactor: number = 1.0

  public static getInstance(): BrowserViewManager {
    if (!BrowserViewManager.instance) {
      BrowserViewManager.instance = new BrowserViewManager()
    }
    return BrowserViewManager.instance
  }

  public getZoomFactor(): number {
    return this.currentZoomFactor
  }

  public init(ownerWindow: BrowserWindow): void {
    if (this.browserView) {
      return
    }

    this.ownerWindow = ownerWindow

    this.browserView = new BrowserView({
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        webSecurity: false,
        nodeIntegration: false
      }
    })

    const wc = this.browserView.webContents

    // Set background color
    this.browserView.setBackgroundColor('#ffffff')

    // Setup CDP
    this.cdpBridge = new CdpDebugBridge(wc, ownerWindow)
    this.cdpBridge.attach().catch((err) => {
      console.warn('[BrowserViewManager] CDP attach failed:', err)
    })

    // Auto-inject probe script when DOM is ready
    wc.on('dom-ready', async () => {
      await this.injectProbeScript()
      this.sendNavState()
    })

    wc.on('did-finish-load', async () => {
      await this.injectProbeScript()
      this.sendNavState()
    })

    wc.on('did-start-loading', () => {
      this.sendNavState()
    })

    wc.on('did-stop-loading', () => {
      this.sendNavState()
    })

    wc.on('page-title-updated', () => {
      this.sendNavState()
    })

    wc.setWindowOpenHandler((details) => {
      this.loadURL(details.url)
      return { action: 'deny' }
    })
  }

  public async injectProbeScript(): Promise<void> {
    if (!this.browserView) return
    try {
      await this.browserView.webContents.executeJavaScript(BROWSER_PROBE_SCRIPT)
    } catch (e) {
      // ignore frame unload / navigation errors
    }
  }

  public setBounds(bounds: BrowserBounds): void {
    this.currentBounds = { ...bounds }
    if (this.browserView && this.isVisible && this.ownerWindow) {
      const integerBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height))
      }
      this.browserView.setBounds(integerBounds)
    }
  }

  public show(): void {
    if (!this.browserView || !this.ownerWindow) return
    if (!this.isVisible) {
      this.ownerWindow.setBrowserView(this.browserView)
      this.isVisible = true
      this.setBounds(this.currentBounds)
    }
  }

  public hide(): void {
    if (!this.browserView || !this.ownerWindow) return
    if (this.isVisible) {
      this.ownerWindow.removeBrowserView(this.browserView)
      this.isVisible = false
    }
  }

  public async loadURL(url: string): Promise<void> {
    if (!this.browserView) return
    this.currentUrl = url
    try {
      await this.browserView.webContents.loadURL(url)
    } catch (err: any) {
      console.warn('[BrowserView] loadURL error:', err.message)
    }
  }

  public reload(): void {
    if (!this.browserView) return
    this.browserView.webContents.reload()
  }

  public goBack(): void {
    if (this.browserView && this.browserView.webContents.canGoBack()) {
      this.browserView.webContents.goBack()
    }
  }

  public goForward(): void {
    if (this.browserView && this.browserView.webContents.canGoForward()) {
      this.browserView.webContents.goForward()
    }
  }

  public setZoom(factor: number): void {
    if (!this.browserView) return
    this.currentZoomFactor = factor
    this.browserView.webContents.setZoomFactor(factor)
  }

  public getNavState(): NavState {
    if (!this.browserView) {
      return {
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        url: this.currentUrl,
        title: ''
      }
    }
    const wc = this.browserView.webContents
    return {
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
      url: wc.getURL() || this.currentUrl,
      title: wc.getTitle() || ''
    }
  }

  public sendNavState(): void {
    if (this.ownerWindow && !this.ownerWindow.isDestroyed()) {
      this.ownerWindow.webContents.send('browser:nav-state', this.getNavState())
    }
  }

  public toggleDevTools(): void {
    if (!this.browserView) return
    const wc = this.browserView.webContents
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
    } else {
      wc.openDevTools({ mode: 'detach' })
    }
  }

  public openDevTools(mode: 'detach' | 'bottom' | 'right' = 'detach'): void {
    if (!this.browserView) return
    this.browserView.webContents.openDevTools({ mode })
  }

  public closeDevTools(): void {
    if (!this.browserView) return
    this.browserView.webContents.closeDevTools()
  }

  /**
   * 能执行探针脚本的 webContents，还没有就返回 null。
   *
   * 一个从未导航过的 BrowserView 没有可执行脚本的渲染帧，此时
   * `webContents.executeJavaScript()` **永不 settle** —— 不是 reject，是一直
   * pending，于是调用方永远卡在这一行（渲染层的 `onMounted` 正是先
   * `setInspectMode('off')` 再 `loadUrl`，一卡住预览就永远不导航）。
   * 实测是 Electron 自身行为（29 与 44 一致），与 debugger 是否 attach、
   * 视图是否 setBrowserView 都无关；唯一能把渲染帧拉起来的是导航。
   *
   * 所以「首帧导航之前」的探针调用必须当空操作：那时本来也没有探针可谈。
   */
  private probeWebContents(): WebContents | null {
    const wc = this.browserView?.webContents
    if (!wc || wc.isDestroyed() || !wc.getURL()) return null
    return wc
  }

  public async setInspectMode(mode: 'inspect' | 'markup' | 'off'): Promise<void> {
    const wc = this.probeWebContents()
    if (!wc) return
    try {
      await wc.executeJavaScript(`
        if (window.__PROTOTYPE_PROBE__) {
          window.__PROTOTYPE_PROBE__.setMode('${mode}');
        }
      `)
    } catch (e) {
      console.warn('[BrowserView] setInspectMode failed:', e)
    }
  }

  /**
   * 清掉预览里画过的圈改框。带 id 只清那一个（批注卡片上那一行的 ✕），
   * 不带就全清。渲染层发完请求也要清 —— 框是「这一轮批注」的临时记号，
   * 留着不但挡视线，重进圈改还会被当成新框重新采样。
   */
  public async clearMarkups(id?: string): Promise<void> {
    const wc = this.probeWebContents()
    if (!wc) return
    try {
      await wc.executeJavaScript(`
        if (window.__PROTOTYPE_PROBE__) {
          window.__PROTOTYPE_PROBE__.clearMarkups(${JSON.stringify(id ?? null)});
        }
      `)
    } catch (e) {
      console.warn('[BrowserView] clearMarkups failed:', e)
    }
  }

  public async capturePage(): Promise<string> {
    if (!this.browserView) return ''
    try {
      const image = await this.browserView.webContents.capturePage()
      return image.toDataURL()
    } catch (err) {
      console.error('[BrowserView] capturePage failed:', err)
      return ''
    }
  }

  public getCdpBridge(): CdpDebugBridge | null {
    return this.cdpBridge
  }

  public getDiagnostics(): DiagnosticSnapshot {
    if (!this.cdpBridge) {
      return {
        hasErrors: false,
        errorCount: 0,
        warningCount: 0,
        errors: [],
        warnings: [],
        probeErrorCount: 0,
        summary: 'CDP 未激活'
      }
    }
    return this.cdpBridge.getDiagnosticSnapshot()
  }

  public clearDiagnostics(): void {
    if (this.cdpBridge) {
      this.cdpBridge.clearLogs()
    }
  }

  public destroy(): void {
    if (this.cdpBridge) {
      this.cdpBridge.detach()
      this.cdpBridge = null
    }
    if (this.browserView) {
      if (this.ownerWindow && !this.ownerWindow.isDestroyed()) {
        try {
          this.ownerWindow.removeBrowserView(this.browserView)
        } catch (e) {
          // ignore
        }
      }
      this.browserView = null
    }
    this.isVisible = false
  }
}
