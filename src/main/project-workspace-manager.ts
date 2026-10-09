import { promises as fs } from 'fs'
import * as path from 'path'

export interface ProjectWorkspace {
  id: string
  name: string
  type: 'local-directory' | 'remote-url'
  url: string
  rootPath?: string
  framework: 'vue3' | 'vue2' | 'react' | 'native-dom' | 'unknown'
  uiLibrary?: string
  devTool?: 'vite' | 'webpack' | 'other'
  dependencies?: Record<string, string>
}

export class ProjectWorkspaceManager {
  private static instance: ProjectWorkspaceManager
  private currentWorkspace: ProjectWorkspace | null = null
  private workspaces: ProjectWorkspace[] = []

  public static getInstance(): ProjectWorkspaceManager {
    if (!ProjectWorkspaceManager.instance) {
      ProjectWorkspaceManager.instance = new ProjectWorkspaceManager()
    }
    return ProjectWorkspaceManager.instance
  }

  constructor() {
    // Default workspace: Built-in Prototype Host
    this.currentWorkspace = {
      id: 'default-host',
      name: '内置原型工程 (runtime-host)',
      type: 'local-directory',
      url: 'http://127.0.0.1:4321',
      rootPath: path.resolve(__dirname, '../../runtime-host'),
      framework: 'vue3',
      uiLibrary: 'Element Plus',
      devTool: 'vite'
    }
    this.workspaces.push(this.currentWorkspace)
  }

  public getCurrentWorkspace(): ProjectWorkspace | null {
    return this.currentWorkspace
  }

  public listWorkspaces(): ProjectWorkspace[] {
    return this.workspaces
  }

  /**
   * 导入本地项目目录
   */
  public async importDirectory(dirPath: string, portOrUrl?: string): Promise<ProjectWorkspace> {
    const pkgPath = path.join(dirPath, 'package.json')
    let pkg: any = {}
    let name = path.basename(dirPath)
    let framework: ProjectWorkspace['framework'] = 'unknown'
    let uiLibrary = ''
    let devTool: ProjectWorkspace['devTool'] = 'other'

    try {
      const content = await fs.readFile(pkgPath, 'utf-8')
      pkg = JSON.parse(content)
      if (pkg.name) name = pkg.name
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      // Detect Framework
      if (deps['vue']) {
        const v = deps['vue']
        if (v.includes('^3') || v.includes('3.') || v.startsWith('3')) {
          framework = 'vue3'
        } else {
          framework = 'vue2'
        }
      } else if (deps['react']) {
        framework = 'react'
      }

      // Detect DevTool
      if (deps['vite'] || deps['@vitejs/plugin-vue']) {
        devTool = 'vite'
      } else if (deps['webpack'] || deps['vue-cli-service']) {
        devTool = 'webpack'
      }

      // Detect UI library
      if (deps['wb-ui'] || dirPath.includes('wb-')) uiLibrary = 'wb-ui'
      if (deps['element-plus']) uiLibrary += (uiLibrary ? ' + ' : '') + 'Element Plus'
      if (deps['element-ui']) uiLibrary = 'Element UI'
      if (deps['antd'] || deps['ant-design-vue']) uiLibrary = 'Ant Design'
    } catch {
      // not a node project or no package.json
    }

    const id = `ws_${Date.now().toString(36)}`
    const defaultUrl = portOrUrl || 'http://localhost:3000'

    const ws: ProjectWorkspace = {
      id,
      name,
      type: 'local-directory',
      url: defaultUrl,
      rootPath: dirPath,
      framework,
      uiLibrary: uiLibrary || undefined,
      devTool,
      dependencies: pkg.dependencies
    }

    this.workspaces.unshift(ws)
    this.currentWorkspace = ws
    return ws
  }

  /**
   * 导入/绑定外部 URL
   */
  public importUrl(url: string, name?: string): ProjectWorkspace {
    const parsedName = name || new URL(url).hostname || '外部系统'
    const id = `ws_${Date.now().toString(36)}`

    const ws: ProjectWorkspace = {
      id,
      name: parsedName,
      type: 'remote-url',
      url,
      framework: 'native-dom'
    }

    this.workspaces.unshift(ws)
    this.currentWorkspace = ws
    return ws
  }

  /**
   * 切换当前激活工作区
   */
  public switchWorkspace(id: string): ProjectWorkspace | null {
    const ws = this.workspaces.find((w) => w.id === id)
    if (ws) {
      this.currentWorkspace = ws
      return ws
    }
    return null
  }

  /**
   * 在当前工作区中根据组件名或相对文件路径查找源文件内容
   */
  public async findSourceFile(
    fileNameOrComponent: string
  ): Promise<{ filePath: string; content: string } | null> {
    if (!this.currentWorkspace || !this.currentWorkspace.rootPath) return null
    const root = this.currentWorkspace.rootPath

    // 1. Direct path check
    const directPath = path.isAbsolute(fileNameOrComponent)
      ? fileNameOrComponent
      : path.join(root, fileNameOrComponent)

    try {
      const stat = await fs.stat(directPath)
      if (stat.isFile()) {
        const content = await fs.readFile(directPath, 'utf-8')
        return { filePath: directPath, content }
      }
    } catch {
      // search in src/
    }

    // 2. Search in src/ directory recursively
    const srcDir = path.join(root, 'src')
    const candidates = [
      `${fileNameOrComponent}.vue`,
      `${fileNameOrComponent}.tsx`,
      `${fileNameOrComponent}.jsx`,
      `${fileNameOrComponent}/index.vue`,
      `${fileNameOrComponent}/index.tsx`
    ]

    try {
      const match = await this.searchFileRecursive(srcDir, candidates)
      if (match) {
        const content = await fs.readFile(match, 'utf-8')
        return { filePath: match, content }
      }
    } catch {
      // ignore
    }

    return null
  }

  private async searchFileRecursive(dir: string, targetNames: string[]): Promise<string | null> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
          continue
        }
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const res = await this.searchFileRecursive(full, targetNames)
          if (res) return res
        } else if (entry.isFile()) {
          for (const name of targetNames) {
            if (entry.name.toLowerCase() === name.toLowerCase()) {
              return full
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return null
  }
}
