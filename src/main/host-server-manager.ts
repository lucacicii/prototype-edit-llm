import { spawn, ChildProcess } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import { dirname, join } from 'path'
import http from 'http'
import { app } from 'electron'
import { bundledRuntimeHostDir, isPackaged, runtimeHostDir } from './app-paths'

/** 预览宿主（一个真 Vite dev server）的生命周期。 */
export class HostServerManager {
  private static instance: HostServerManager
  private process: ChildProcess | null = null
  private hostUrl: string = 'http://127.0.0.1:4321'
  private isRunning: boolean = false

  public static getInstance(): HostServerManager {
    if (!HostServerManager.instance) {
      HostServerManager.instance = new HostServerManager()
    }
    return HostServerManager.instance
  }

  public getIsRunning(): boolean {
    return this.isRunning
  }

  public getHostUrl(): string {
    return this.hostUrl
  }

  public async startServer(): Promise<string> {
    const isPortOpen = await this.checkPortAvailable(4321)
    if (isPortOpen) {
      this.isRunning = true
      return this.hostUrl
    }

    await this.ensureProvisioned()

    const hostDir = runtimeHostDir()

    try {
      this.process = this.spawnVite(hostDir)

      this.process.stdout?.on('data', (data) => {
        const msg = data.toString()
        if (msg.includes('Local:')) {
          this.isRunning = true
        }
      })

      this.process.stderr?.on('data', (data) => {
        console.error('[HostServer Vite]', data.toString())
      })

      this.process.on('close', (_code) => {
        this.isRunning = false
        this.process = null
      })

      await this.waitForServer(4321, 10000)
    } catch (err) {
      console.error('Failed to start HostServer Vite:', err)
    }

    return this.hostUrl
  }

  private spawnVite(hostDir: string): ChildProcess {
    // Vite 配置只在启动时读 .prototype-stack —— 两种启动
    // 路径（dev 的 npx / 打包态的 ELECTRON_RUN_AS_NODE）
    // 都不需要按栈传参；栈切换靠 BrowserView 整页刷新，
    // 不重启 dev server（见 agent-bridge 的 applyStack）。
    if (!isPackaged()) {
      // dev：照旧用用户 PATH 里的 npx，跑仓库里的 runtime-host。
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      return spawn(npxCmd, ['vite', '--port', '4321', '--strictPort'], {
        cwd: hostDir,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' }
      })
    }

    // 打包态：包里没有 npx 可指望，用 Electron 自带的 Node 直接跑 Vite 的 CLI。
    // ELECTRON_RUN_AS_NODE 放在子进程的 env 里（不是我们自己的），只影响这一个。
    return spawn(
      process.execPath,
      [join(hostDir, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '4321', '--strictPort'],
      {
        cwd: hostDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }
    )
  }

  /**
   * 打包态：把随包的预览宿主铺一份到可写的 userData 下再跑。
   *
   * 不能在 Resources/runtime-host 里就地跑：.app 包内等同只读，而 Vite 要在那儿
   * 写自己的依赖缓存，我们每改一次原型还要重写活动原型文件 —— 往包体里写还会
   * 破坏签名。首启复制约 165M（SSD 上一两秒），之后靠版本戳判断是否要重铺：
   * app 一升级就重铺，免得旧的 Vite 配置残留下来。
   *
   * pnpm 的 node_modules 软链是相对的（`element-plus -> .pnpm/...`），整树复制
   * 后依然自洽，所以这里用 verbatimSymlinks 保住链接原样。
   */
  private async ensureProvisioned(): Promise<void> {
    const bundled = bundledRuntimeHostDir()
    if (!bundled) return // dev：直接用仓库里的 runtime-host

    const target = runtimeHostDir()
    const stampFile = join(target, '.runtime-host-version')
    const viteCli = join(target, 'node_modules', 'vite', 'bin', 'vite.js')

    try {
      const stamp = await fs.readFile(stampFile, 'utf-8').catch(() => null)
      if (stamp?.trim() === app.getVersion() && existsSync(viteCli)) {
        return
      }
      console.log(`[preview] 铺设预览宿主：${bundled} → ${target}（首次或版本变化，约 165M）`)
      await fs.rm(target, { recursive: true, force: true })
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.cp(bundled, target, { recursive: true, verbatimSymlinks: true })
      // 多栈宿主：铺完确保栈标记存在（缺省 vue3-element，
      // 与存量快照一致）。LLM 运行中换栈时主进程会重写这里。
      const marker = join(target, '.prototype-stack')
      const markerCurrent = await fs.readFile(marker, 'utf-8').catch(() => null)
      if (!markerCurrent) await fs.writeFile(marker, 'vue3-element', 'utf-8')
      await fs.writeFile(stampFile, app.getVersion(), 'utf-8')
      console.log('[preview] 预览宿主就绪')
    } catch (err: any) {
      // 不抛：让它继续走到 startServer 的 waitForServer，那里会失败并留下日志，
      // 而这里的一句「为什么没铺成」通常才是真正的线索。
      console.error('[preview] 铺设预览宿主失败：', err?.message ?? err)
    }
  }

  public stopServer() {
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
      this.isRunning = false
    }
  }

  private checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}`, () => {
        resolve(true)
      })
      req.on('error', () => {
        resolve(false)
      })
      req.setTimeout(1000, () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  private waitForServer(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    return new Promise((resolve) => {
      const check = async () => {
        const ready = await this.checkPortAvailable(port)
        if (ready) {
          resolve(true)
        } else if (Date.now() - start > timeoutMs) {
          resolve(false)
        } else {
          setTimeout(check, 300)
        }
      }
      check()
    })
  }
}
