/**
 * Unified Prototype Project Runner:
 *
 * 1. Static HTTP Server (`http://127.0.0.1:4322/projects/<id>/...`):
 *    Serves any project directory directly when it uses `native-html` (or has an `index.html`
 *    without needing a bundler). Zero compile overhead, instant reload on file change.
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
import { projectDirFor, syncProjectEntryAndStack } from './project-store'
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

          // Route: /projects/<projectId>/<relPath>
          const match = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(pathname)
          if (!match) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Not Found')
            return
          }

          const projectId = match[1]
          const relPath = match[2] || 'index.html'
          const projectRoot = projectDirFor(projectId)
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
    const synced = await syncProjectEntryAndStack(params.projectId)
    const stack: TechStack = params.techStack || synced?.techStack || 'native-html'
    const entryFile =
      synced?.entryFile ||
      (stack === 'native-html' ? 'index.html' : stack === 'react-ts' ? 'index.tsx' : 'index.vue')
    const code = params.code ?? synced?.vueCode ?? ''

    if (stack === 'native-html') {
      const previewUrl = this.getStaticProjectUrl(params.projectId, entryFile)
      return { previewUrl, techStack: stack, code, entryFile }
    }

    // Vue 3 / React TS: stage into ~/.prototype-studio/runtime-host
    const marker = prototypeStackMarker()
    await fs.mkdir(path.dirname(marker), { recursive: true })
    const markerCurrent = await fs.readFile(marker, 'utf-8').catch(() => null)
    const stackChanged = markerCurrent !== null && markerCurrent !== stack
    if (markerCurrent !== stack) {
      await fs.writeFile(marker, stack, 'utf-8')
    }

    const filePath = activePrototypeFile(stack)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    for (const ext of ['vue', 'tsx', 'html']) {
      const cur = stack === 'react-ts' ? 'tsx' : stack === 'native-html' ? 'html' : 'vue'
      if (ext === cur) continue
      await fs.rm(path.join(path.dirname(filePath), `active.${ext}`), { force: true })
    }

    const current = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (current !== code) {
      await fs.writeFile(filePath, code, 'utf-8')
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
