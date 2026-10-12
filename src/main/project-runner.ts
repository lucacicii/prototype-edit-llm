/**
 * Unified Prototype Project Runner:
 *
 * 1. Static HTTP Server (`http://127.0.0.1:4322/projects/<id>/...` & `/workspaces/<id>/...`):
 *    Serves any project directory or imported workspace primary repo directly when it uses
 *    `native-html` (or has an `index.html` without needing a bundler). Zero compile overhead,
 *    instant reload on file change.
 * 2. Vite Compile Host (`http://127.0.0.1:4321/prototypes/<id>`):
 *    Runs inside `~/.prototype-studio/runtime-host` for Vue 3 (`index.vue`) and React (`index.tsx`)
 *    prototypes without touching the git repository.
 */

import http from 'http'
import { promises as fs, existsSync } from 'fs'
import * as path from 'path'
import { BrowserViewManager } from './browser-view-manager'
import { HostServerManager } from './host-server-manager'
import { activePrototypeFile, prototypeStackMarker } from './app-paths'
import { projectDirFor, syncProjectEntryAndStack, entryFileForStack, ENTRY_CANDIDATES } from './project-store'
import { ProjectWorkspaceManager } from './project-workspace-manager'
import { type TechStack } from './agent/tech-stack'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

export class ProjectRunner {
  private static instance: ProjectRunner
  private staticServer: http.Server | null = null
  private staticPort = 4322

  public static getInstance(): ProjectRunner {
    if (!ProjectRunner.instance) {
      ProjectRunner.instance = new ProjectRunner()
    }
    return ProjectRunner.instance
  }

  public async startStaticServer(): Promise<number> {
    if (this.staticServer) return this.staticPort

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${this.staticPort}`)
          const pathname = decodeURIComponent(parsedUrl.pathname)

          // Route: /projects/<projectId>/<relPath> OR /workspaces/<workspaceId>/<relPath>
          const projectMatch = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(pathname)
          const wsMatch = !projectMatch ? /^\/workspaces\/([^/]+)(?:\/(.*))?$/.exec(pathname) : null

          if (!projectMatch && !wsMatch) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Not Found')
            return
          }

          let projectRoot: string | undefined
          let relPath: string

          if (projectMatch) {
            const projectId = projectMatch[1]
            relPath = projectMatch[2] || 'index.html'
            projectRoot = projectDirFor(projectId)
          } else {
            const workspaceId = wsMatch![1]
            relPath = wsMatch![2] || 'index.html'
            const wsManager = ProjectWorkspaceManager.getInstance()
            await wsManager.init()
            const ws = wsManager.getWorkspaceById(workspaceId)
            projectRoot =
              ws?.repos?.find((r) => r.role === 'primary')?.path ?? ws?.rootPath
          }

          if (!projectRoot) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Workspace root not found')
            return
          }

          const targetPath = path.resolve(projectRoot, relPath)

          if (!targetPath.startsWith(path.resolve(projectRoot))) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Forbidden')
            return
          }

          let fileToRead = targetPath
          const stat = await fs.stat(fileToRead).catch(() => null)
          if (stat?.isDirectory()) {
            fileToRead = path.join(fileToRead, 'index.html')
          }

          if (!existsSync(fileToRead)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(`File not found: ${relPath}`)
            return
          }

          const ext = path.extname(fileToRead).toLowerCase()
          const contentType = MIME_TYPES[ext] || 'application/octet-stream'
          const content = await fs.readFile(fileToRead)

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
          })
          res.end(content)
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(err?.message || 'Internal Server Error')
        }
      })

      server.on('error', () => {
        // Port might be in use, try next port
        this.staticPort += 1
        server.listen(this.staticPort, '127.0.0.1')
      })

      server.listen(this.staticPort, '127.0.0.1', () => {
        this.staticServer = server
        resolve(this.staticPort)
      })
    })
  }

  public getStaticProjectUrl(projectId: string, entryFile = 'index.html'): string {
    return `http://127.0.0.1:${this.staticPort}/projects/${encodeURIComponent(projectId)}/${entryFile}`
  }

  public getStaticWorkspaceUrl(workspaceId: string, entryFile = 'index.html'): string {
    return `http://127.0.0.1:${this.staticPort}/workspaces/${encodeURIComponent(workspaceId)}/${entryFile}`
  }

  public getStaticPort(): number {
    return this.staticPort
  }

  /**
   * Sync a project's entry file to the preview stage and return the preview URL.
   * - For `native-html`: served directly from `~/.prototype-studio/projects/<id>/index.html`
   *   via the built-in static server!
   * - For `vue3-element` / `react-ts`: staged to `~/.prototype-studio/runtime-host` Vite server.
   */
  public async syncAndResolvePreviewUrl(params: {
    projectId: string
    code?: string
    techStack?: TechStack
  }): Promise<{ previewUrl: string; techStack: TechStack; code: string; entryFile: string }> {
    await this.startStaticServer()
    const dir = projectDirFor(params.projectId)

    // 显式给了栈就信它（渲染层知道当前项目是什么），只有没给时才去磁盘
    // 自动侦测（`thunder-daemon` 可能刚写了个新栈的入口文件）。
    const synced = params.techStack ? null : await syncProjectEntryAndStack(params.projectId)
    const stack: TechStack = params.techStack || synced?.techStack || 'native-html'
    const entryFile = entryFileForStack(stack)

    // 先把同层的旧入口文件清掉。一个项目只能有一个入口，
    // index.html 与 index.vue 并存时「按 mtime 取最新」会随机翻转。
    for (const c of ENTRY_CANDIDATES) {
      if (c.file === entryFile) continue
      await fs.rm(path.join(dir, c.file), { force: true })
    }

    // 无论哪个栈，都把最新代码落到项目自己的入口文件上：
    // 不写的话「渲染层的新代码」就只活在内存里。
    const storedPath = path.join(dir, entryFile)
    const stored = await fs.readFile(storedPath, 'utf-8').catch(() => null)
    const code = params.code ?? stored ?? synced?.vueCode ?? ''
    if (params.code !== undefined && stored !== code) {
      await fs.mkdir(path.dirname(storedPath), { recursive: true })
      await fs.writeFile(storedPath, code, 'utf-8')
    }

    if (stack === 'native-html') {
      // 静态直出：直接服务项目目录里的 index.html，零编译。
      return {
        previewUrl: this.getStaticProjectUrl(params.projectId, entryFile),
        techStack: stack,
        code,
        entryFile
      }
    }

    // Vue 3 / React TS：把入口代码投到 ~/.prototype-studio/runtime-host 的
    // 单槽位 active.<ext> 上，由那里的真 Vite dev server 编译 + HMR。
    const marker = prototypeStackMarker()
    await fs.mkdir(path.dirname(marker), { recursive: true })
    const markerCurrent = await fs.readFile(marker, 'utf-8').catch(() => null)
    const stackChanged = markerCurrent !== null && markerCurrent !== stack
    if (markerCurrent !== stack) {
      await fs.writeFile(marker, stack, 'utf-8')
    }

    const activePath = activePrototypeFile(stack)
    await fs.mkdir(path.dirname(activePath), { recursive: true })
    const curExt = stack === 'react-ts' ? 'tsx' : 'vue'
    for (const ext of ['vue', 'tsx', 'html']) {
      if (ext === curExt) continue
      await fs.rm(path.join(path.dirname(activePath), `active.${ext}`), { force: true })
    }

    const activeCurrent = await fs.readFile(activePath, 'utf-8').catch(() => null)
    if (activeCurrent !== code) {
      await fs.writeFile(activePath, code, 'utf-8')
    }
    if (stackChanged) {
      BrowserViewManager.getInstance().reload()
    }

    const hostUrl = HostServerManager.getInstance().getHostUrl()
    return {
      previewUrl: `${hostUrl}/prototypes/${params.projectId}`,
      techStack: stack,
      code,
      entryFile
    }
  }

  public stop(): void {
    if (this.staticServer) {
      this.staticServer.close()
      this.staticServer = null
    }
  }
}
