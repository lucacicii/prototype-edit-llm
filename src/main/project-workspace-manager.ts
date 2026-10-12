import { promises as fs } from 'fs'
import * as path from 'path'
import { projectsRootDir, workspaceDir } from './app-paths'
import { projectDirFor } from './project-store'
import {
  ensureSharedWorkspace,
  sharedWorkspaceDir,
  type RepoRole,
  type SharedRepo
} from './shared-workspace'
import { loadWorkspaceList, saveWorkspaceList } from './workspace-store'

/** 默认工作区 id：用户自己的独立原型项目（~/.prototype-studio/projects/<id>/）。 */
export const DEFAULT_WORKSPACE_ID = 'default-host'

export type WorkspaceFramework = 'vue3' | 'vue2' | 'react' | 'native-dom' | 'unknown'
export type WorkspaceDevTool = 'vite' | 'webpack' | 'other'

export interface WorkspaceRepo extends SharedRepo {
  framework: WorkspaceFramework
  uiLibrary?: string
  devTool?: WorkspaceDevTool
  dependencies?: Record<string, string>
}

export interface ProjectWorkspace {
  id: string
  name: string
  type: 'local-directory' | 'remote-url' | 'shared'
  url: string
  /** 兼容旧字段：始终等于主仓库（primary）路径。 */
  rootPath?: string
  /** 共享工作区引用的仓库列表（1 个 primary + N 个 reference）。 */
  repos?: WorkspaceRepo[]
  /** 中立共享目录 ~/.prototype-studio/workspaces/<id>/。 */
  sharedDir?: string
  framework: WorkspaceFramework
  uiLibrary?: string
  devTool?: WorkspaceDevTool
  dependencies?: Record<string, string>
}

/** 探测单个目录的 package.json 元信息。 */
export async function inspectRepoDirectory(dirPath: string): Promise<{
  label: string
  framework: WorkspaceFramework
  uiLibrary?: string
  devTool: WorkspaceDevTool
  dependencies?: Record<string, string>
}> {
  const pkgPath = path.join(dirPath, 'package.json')
  let pkg: any = {}
  let label = path.basename(dirPath)
  let framework: WorkspaceFramework = 'unknown'
  let uiLibrary = ''
  let devTool: WorkspaceDevTool = 'other'

  try {
    const content = await fs.readFile(pkgPath, 'utf-8')
    pkg = JSON.parse(content)
    if (pkg.name) label = pkg.name
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (deps['vue']) {
      const v = String(deps['vue'])
      framework = v.includes('^3') || v.includes('3.') || v.startsWith('3') ? 'vue3' : 'vue2'
    } else if (deps['react']) {
      framework = 'react'
    }

    if (deps['vite'] || deps['@vitejs/plugin-vue']) {
      devTool = 'vite'
    } else if (deps['webpack'] || deps['vue-cli-service']) {
      devTool = 'webpack'
    }

    if (deps['wb-ui'] || dirPath.includes('wb-')) uiLibrary = 'wb-ui'
    if (deps['element-plus']) uiLibrary += (uiLibrary ? ' + ' : '') + 'Element Plus'
    if (deps['element-ui']) uiLibrary = 'Element UI'
    if (deps['antd'] || deps['ant-design-vue']) uiLibrary = 'Ant Design'
  } catch {
    // 非 node 工程或没有 package.json
  }

  return {
    label,
    framework,
    uiLibrary: uiLibrary || undefined,
    devTool,
    dependencies: pkg.dependencies
  }
}

export class ProjectWorkspaceManager {
  private static instance: ProjectWorkspaceManager
  private currentWorkspace: ProjectWorkspace | null = null
  private workspaces: ProjectWorkspace[] = []
  private studioDir: string
  private loaded = false

  public static getInstance(): ProjectWorkspaceManager {
    if (!ProjectWorkspaceManager.instance) {
      ProjectWorkspaceManager.instance = new ProjectWorkspaceManager()
    }
    return ProjectWorkspaceManager.instance
  }

  constructor(studioDir: string = workspaceDir()) {
    this.studioDir = studioDir
    // 默认工作区：用户自己的独立原型项目。技术栈由每个原型自选，这里不预设。
    const defaultWs: ProjectWorkspace = {
      id: DEFAULT_WORKSPACE_ID,
      name: '我的原型',
      type: 'local-directory',
      url: '',
      rootPath: projectsRootDir(),
      framework: 'unknown'
    }
    this.currentWorkspace = defaultWs
    this.workspaces.push(defaultWs)
  }

  /** 允许测试用独立的临时目录创建实例。 */
  public static createForTest(studioDir: string): ProjectWorkspaceManager {
    return new ProjectWorkspaceManager(studioDir)
  }

  public getStudioDir(): string {
    return this.studioDir
  }

  /**
   * 从磁盘恢复持久化的外部工作区列表，并为每个工作区刷新一次共享目录与 AGENTS.md。
   */
  public async init(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const saved = await loadWorkspaceList<ProjectWorkspace>(this.studioDir)
    const defaultWs = this.workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID)!
    const hydrated: ProjectWorkspace[] = []
    for (const raw of saved) {
      if (!raw || !raw.id || raw.id === DEFAULT_WORKSPACE_ID) continue
      const normalized = this.normalizeWorkspace(raw)
      await this.syncSharedDir(normalized)
      hydrated.push(normalized)
    }
    this.workspaces = [...hydrated, defaultWs]
    if (!this.currentWorkspace || !this.workspaces.some((w) => w.id === this.currentWorkspace!.id)) {
      this.currentWorkspace = defaultWs
    }
  }

  /**
   * 兼容旧版只有 rootPath 没有 repos/sharedDir 的工作区：补齐 primary 仓库与中立目录。
   */
  private normalizeWorkspace(ws: ProjectWorkspace): ProjectWorkspace {
    const copy: ProjectWorkspace = { ...ws }
    if (copy.type !== 'remote-url') {
      let repos = Array.isArray(copy.repos) ? copy.repos.map((r) => ({ ...r })) : []
      if (repos.length === 0 && copy.rootPath) {
        repos = [
          {
            path: copy.rootPath,
            label: copy.name || path.basename(copy.rootPath),
            role: 'primary',
            framework: copy.framework ?? 'unknown',
            uiLibrary: copy.uiLibrary,
            devTool: copy.devTool,
            dependencies: copy.dependencies
          }
        ]
      }
      // 保证至少有一个 primary
      if (repos.length > 0 && !repos.some((r) => r.role === 'primary')) {
        repos[0].role = 'primary'
      }
      const primary = repos.find((r) => r.role === 'primary')
      if (primary) {
        copy.rootPath = primary.path
        copy.framework = primary.framework ?? copy.framework ?? 'unknown'
        copy.uiLibrary = primary.uiLibrary
        copy.devTool = primary.devTool
        copy.dependencies = primary.dependencies
      }
      copy.repos = repos
      copy.sharedDir = sharedWorkspaceDir(this.studioDir, copy.id)
      if (repos.length > 1) copy.type = 'shared'
    } else {
      // remote-url 工作区也给一个中立共享目录（方便放参考仓库与笔记）
      copy.repos = Array.isArray(copy.repos) ? copy.repos.map((r) => ({ ...r })) : []
      copy.sharedDir = sharedWorkspaceDir(this.studioDir, copy.id)
    }
    return copy
  }

  private async syncSharedDir(ws: ProjectWorkspace): Promise<void> {
    if (ws.id === DEFAULT_WORKSPACE_ID) return
    try {
      const { dir } = await ensureSharedWorkspace(this.studioDir, {
        id: ws.id,
        name: ws.name,
        url: ws.url,
        repos: ws.repos ?? []
      })
      ws.sharedDir = dir
    } catch (err) {
      console.warn('[ProjectWorkspaceManager] ensureSharedWorkspace failed:', err)
    }
  }

  private async persist(): Promise<void> {
    const external = this.workspaces.filter((w) => w.id !== DEFAULT_WORKSPACE_ID)
    try {
      await saveWorkspaceList(this.studioDir, external)
    } catch (err) {
      console.warn('[ProjectWorkspaceManager] saveWorkspaceList failed:', err)
    }
  }

  public getCurrentWorkspace(): ProjectWorkspace | null {
    return this.currentWorkspace
  }

  public getWorkspaceById(id: string): ProjectWorkspace | null {
    return this.workspaces.find((w) => w.id === id) ?? null
  }

  public listWorkspaces(): ProjectWorkspace[] {
    return this.workspaces
  }

  /**
   * 一次性导入一个或多个本地项目目录（创建新的共享工作区）。
   * 第一个目录默认设为主仓库（primary），其余目录设为参考仓库（reference）。
   */
  public async importDirectories(
    dirPaths: string[],
    portOrUrl?: string,
    workspaceName?: string
  ): Promise<ProjectWorkspace> {
    const uniqueDirs = Array.from(
      new Set(dirPaths.map((d) => path.resolve(d)).filter(Boolean))
    )
    if (uniqueDirs.length === 0) {
      throw new Error('至少需要选择一个工程目录')
    }

    const repos: WorkspaceRepo[] = []
    for (let i = 0; i < uniqueDirs.length; i++) {
      const resolvedDir = uniqueDirs[i]
      const info = await inspectRepoDirectory(resolvedDir)
      repos.push({
        path: resolvedDir,
        label: info.label,
        role: i === 0 ? 'primary' : 'reference',
        framework: info.framework,
        uiLibrary: info.uiLibrary,
        devTool: info.devTool,
        dependencies: info.dependencies
      })
    }

    const primaryRepo = repos[0]
    const id = `ws_${Date.now().toString(36)}`
    const defaultUrl = portOrUrl || 'http://localhost:3000'
    const name = workspaceName?.trim() || primaryRepo.label

    const ws: ProjectWorkspace = this.normalizeWorkspace({
      id,
      name,
      type: repos.length > 1 ? 'shared' : 'local-directory',
      url: defaultUrl,
      rootPath: primaryRepo.path,
      repos,
      sharedDir: sharedWorkspaceDir(this.studioDir, id),
      framework: primaryRepo.framework,
      uiLibrary: primaryRepo.uiLibrary,
      devTool: primaryRepo.devTool,
      dependencies: primaryRepo.dependencies
    })

    await this.syncSharedDir(ws)
    this.workspaces.unshift(ws)
    this.currentWorkspace = ws
    await this.persist()
    return ws
  }

  /**
   * 导入本地项目目录（兼容单目录调用：内部委托给 importDirectories）。
   */
  public async importDirectory(dirPath: string, portOrUrl?: string): Promise<ProjectWorkspace> {
    return this.importDirectories([dirPath], portOrUrl)
  }

  /**
   * 导入/绑定外部 URL
   */
  public async importUrl(url: string, name?: string): Promise<ProjectWorkspace> {
    let parsedHost = '外部系统'
    try {
      parsedHost = new URL(url).hostname || '外部系统'
    } catch {
      // ignore
    }
    const parsedName = name || parsedHost
    const id = `ws_${Date.now().toString(36)}`

    const ws: ProjectWorkspace = this.normalizeWorkspace({
      id,
      name: parsedName,
      type: 'remote-url',
      url,
      repos: [],
      sharedDir: sharedWorkspaceDir(this.studioDir, id),
      framework: 'native-dom'
    })

    await this.syncSharedDir(ws)
    this.workspaces.unshift(ws)
    this.currentWorkspace = ws
    await this.persist()
    return ws
  }

  /**
   * 向指定工作区批量添加多个仓库（默认作为 reference 参考仓库；若当前没有 primary 则第一个设为 primary）。
   */
  public async addReposToWorkspace(
    workspaceId: string,
    dirPaths: string[],
    role?: RepoRole
  ): Promise<ProjectWorkspace | null> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id === DEFAULT_WORKSPACE_ID) return null

    const uniqueDirs = Array.from(
      new Set(dirPaths.map((d) => path.resolve(d)).filter(Boolean))
    )
    if (uniqueDirs.length === 0) return ws

    const repos = Array.isArray(ws.repos) ? [...ws.repos] : []

    for (let i = 0; i < uniqueDirs.length; i++) {
      const resolvedDir = uniqueDirs[i]
      const info = await inspectRepoDirectory(resolvedDir)
      const existingIdx = repos.findIndex((r) => path.resolve(r.path) === resolvedDir)

      const hasPrimary = repos.some((r) => r.role === 'primary')
      const targetRole: RepoRole =
        role === 'primary' && i === 0 ? 'primary' : hasPrimary ? 'reference' : 'primary'

      if (targetRole === 'primary') {
        for (const r of repos) r.role = 'reference'
      }

      const entry: WorkspaceRepo = {
        path: resolvedDir,
        label: info.label,
        role: targetRole,
        framework: info.framework,
        uiLibrary: info.uiLibrary,
        devTool: info.devTool,
        dependencies: info.dependencies
      }

      if (existingIdx >= 0) {
        repos[existingIdx] = entry
      } else {
        repos.push(entry)
      }
    }

    ws.repos = repos
    const normalized = this.normalizeWorkspace(ws)
    Object.assign(ws, normalized)
    await this.syncSharedDir(ws)
    await this.persist()
    return ws
  }

  /**
   * 向指定工作区添加一个仓库（默认作为 reference 参考仓库；若当前没有 primary 则设为 primary）。
   */
  public async addRepoToWorkspace(
    workspaceId: string,
    dirPath: string,
    role?: RepoRole
  ): Promise<ProjectWorkspace | null> {
    return this.addReposToWorkspace(workspaceId, [dirPath], role)
  }

  /**
   * 从工作区移除一个仓库（若只剩最后一个 primary 仓库则不允许移除，避免工作区变成空壳）。
   */
  public async removeRepoFromWorkspace(
    workspaceId: string,
    repoPath: string
  ): Promise<ProjectWorkspace | null> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id === DEFAULT_WORKSPACE_ID) return null

    const resolvedTarget = path.resolve(repoPath)
    const repos = (ws.repos ?? []).filter((r) => path.resolve(r.path) !== resolvedTarget)
    if (repos.length === 0 && ws.type !== 'remote-url') {
      throw new Error('工作区至少需要保留一个主仓库')
    }
    if (repos.length > 0 && !repos.some((r) => r.role === 'primary')) {
      repos[0].role = 'primary'
    }
    ws.repos = repos
    if (repos.length === 0) {
      ws.rootPath = undefined
    }
    const normalized = this.normalizeWorkspace(ws)
    Object.assign(ws, normalized)
    await this.syncSharedDir(ws)
    await this.persist()
    return ws
  }

  /**
   * 把工作区内的某个已关联仓库切换为主仓库（primary），原 primary 自动降为 reference。
   */
  public async setPrimaryRepo(
    workspaceId: string,
    repoPath: string
  ): Promise<ProjectWorkspace | null> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id === DEFAULT_WORKSPACE_ID || !ws.repos?.length) return null

    const resolvedTarget = path.resolve(repoPath)
    const found = ws.repos.find((r) => path.resolve(r.path) === resolvedTarget)
    if (!found) return null

    for (const r of ws.repos) {
      r.role = path.resolve(r.path) === resolvedTarget ? 'primary' : 'reference'
    }
    // 把 primary 排到第一位，阅读顺序更直观
    ws.repos.sort((a, b) => (a.role === 'primary' ? -1 : b.role === 'primary' ? 1 : 0))

    const normalized = this.normalizeWorkspace(ws)
    Object.assign(ws, normalized)
    await this.syncSharedDir(ws)
    await this.persist()
    return ws
  }

  /**
   * 更新工作区基本信息（名称、预览 URL）。
   */
  public async updateWorkspaceMeta(
    workspaceId: string,
    patch: { name?: string; url?: string }
  ): Promise<ProjectWorkspace | null> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id === DEFAULT_WORKSPACE_ID) return null

    if (typeof patch.name === 'string' && patch.name.trim()) {
      ws.name = patch.name.trim()
    }
    if (typeof patch.url === 'string' && patch.url.trim()) {
      ws.url = patch.url.trim()
    }
    await this.syncSharedDir(ws)
    await this.persist()
    return ws
  }

  /**
   * 删除一个外部工作区（不会删用户本地仓库，只删工作区注册项与中立目录）。
   */
  public async removeWorkspace(workspaceId: string): Promise<{
    workspaces: ProjectWorkspace[]
    currentWorkspace: ProjectWorkspace | null
  }> {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new Error('默认工作区不可删除')
    }
    const target = this.workspaces.find((w) => w.id === workspaceId)
    this.workspaces = this.workspaces.filter((w) => w.id !== workspaceId)
    if (this.currentWorkspace?.id === workspaceId) {
      this.currentWorkspace =
        this.workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID) ?? this.workspaces[0] ?? null
    }
    if (target?.sharedDir) {
      await fs.rm(target.sharedDir, { recursive: true, force: true }).catch(() => {})
    }
    await this.persist()
    return {
      workspaces: this.workspaces,
      currentWorkspace: this.currentWorkspace
    }
  }

  /**
   * 重新生成/同步某个工作区的 AGENTS.md 地址表。
   */
  public async refreshSharedWorkspace(workspaceId: string): Promise<ProjectWorkspace | null> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id === DEFAULT_WORKSPACE_ID) return null
    await this.syncSharedDir(ws)
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
   * 在当前工作区的 primary 主仓库中根据组件名或相对文件路径查找源文件内容。
   * 注意：只搜 primary 仓库（rootPath），避免跨参考仓库误匹配。
   */
  public async findSourceFile(
    fileNameOrComponent: string,
    prototypeId?: string
  ): Promise<{ filePath: string; content: string } | null> {
    if (!this.currentWorkspace) return null
    const isDefault = this.currentWorkspace.id === DEFAULT_WORKSPACE_ID
    // 默认工作区：只在当前原型自己的项目目录里找，而不是整个 projects 根目录
    if (isDefault && !prototypeId) return null
    const primaryPath =
      this.currentWorkspace.repos?.find((r) => r.role === 'primary')?.path ??
      this.currentWorkspace.rootPath
    const root = isDefault ? projectDirFor(prototypeId!) : primaryPath
    if (!root) return null

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
    const srcDir = isDefault ? root : path.join(root, 'src')
    const candidates = [
      `${fileNameOrComponent}.vue`,
      `${fileNameOrComponent}.tsx`,
      `${fileNameOrComponent}.jsx`,
      `${fileNameOrComponent}/index.vue`,
      `${fileNameOrComponent}/index.tsx`,
      `${fileNameOrComponent}.html`,
      `${fileNameOrComponent}.css`,
      `${fileNameOrComponent}.js`
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
