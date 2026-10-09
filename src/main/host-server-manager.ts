import { spawn, ChildProcess } from 'child_process'
import http from 'http'
import { runtimeHostDir } from './app-paths'

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

  public getHostUrl(): string {
    return this.hostUrl
  }

  public async startServer(): Promise<string> {
    const isPortOpen = await this.checkPortAvailable(4321)
    if (isPortOpen) {
      this.isRunning = true
      return this.hostUrl
    }

    const hostDir = runtimeHostDir()
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

    try {
      this.process = spawn(npxCmd, ['vite', '--port', '4321', '--strictPort'], {
        cwd: hostDir,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' }
      })

      this.process.stdout?.on('data', (data) => {
        const msg = data.toString()
        if (msg.includes('Local:')) {
          this.isRunning = true
        }
      })

      this.process.stderr?.on('data', (data) => {
        console.error('[HostServer Vite]', data.toString())
      })

      this.process.on('close', (code) => {
        this.isRunning = false
        this.process = null
      })

      await this.waitForServer(4321, 10000)
    } catch (err) {
      console.error('Failed to start HostServer Vite:', err)
    }

    return this.hostUrl
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
