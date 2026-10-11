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
   * 把随包或仓库里的预览宿主模板铺一份到可写的 ~/.prototype-studio/runtime-host 下再跑。
   *
   * 这样不论是 dev 还是打包态，都不会往 git 仓库里的 runtime-host 写 active.vue / .prototype-stack，
   * 保证代码仓库永远干净。
   */
  private async ensureProvisioned(): Promise<void> {
    const bundled = bundledRuntimeHostDir()
    if (!bundled) return

    const target = runtimeHostDir()
    if (bundled === target) return

    const stampFile = join(target, '.runtime-host-version')
    const viteCli = join(target, 'node_modules', 'vite', 'bin', 'vite.js')
    const expectedStamp = `${app.getVersion()}-clean-v2`

    try {
      const stamp = await fs.readFile(stampFile, 'utf-8').catch(() => null)
      if (stamp?.trim() === expectedStamp && existsSync(viteCli)) {
        return
      }
      console.log(`[preview] 铺设预览宿主：${bundled} → ${target}（首次或版本变化）`)
      await fs.rm(target, { recursive: true, force: true })
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.cp(bundled, target, { recursive: true, verbatimSymlinks: true })
      const marker = join(target, '.prototype-stack')
      const markerCurrent = await fs.readFile(marker, 'utf-8').catch(() => null)
      if (!markerCurrent) await fs.writeFile(marker, 'vue3-element', 'utf-8')
      await fs.writeFile(stampFile, expectedStamp, 'utf-8')
      console.log('[preview] 预览宿主就绪')
    } catch (err: any) {
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
