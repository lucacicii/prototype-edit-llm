import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { ProjectWorkspaceManager } from '../project-workspace-manager'
import {
  deleteSharedFile,
  isAgentsFileDisabled,
  listSharedFiles,
  readSharedFile,
  writeSharedFile,
  type RepoRole
} from '../shared-workspace'

export interface SaveCodeParams {
  filePath: string
  content: string
}

export function setupProjectIpc(): void {
  const wsManager = ProjectWorkspaceManager.getInstance()
  void wsManager.init()

  // 打开目录选择器（单选）
  ipcMain.handle('project:select-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window || (undefined as any), {
      title: '选择项目目标目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // 导入并注册本地项目工作区（支持一次性多选多个目录：第 1 个为 Primary 主仓，其余为 Reference 参考仓）
  ipcMain.handle('project:import-directory', async (event, portOrUrl?: string) => {
    await wsManager.init()
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window || (undefined as any), {
      title: '选择本地工程目录创建共享工作区（可按住 ⌘/Ctrl 多选多个仓库，首个设为主仓）',
      message: '支持一次多选多个仓库：第 1 个默认设为主仓（Primary），其余设为参考仓（Reference）',
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const ws = await wsManager.importDirectories(result.filePaths, portOrUrl)
    return ws
  })

  // 导入外部或现有 URL 工作区
  ipcMain.handle('project:import-url', async (_event, params: { url: string; name?: string }) => {
    await wsManager.init()
    return wsManager.importUrl(params.url, params.name)
  })

  // 获取所有工作区列表
  ipcMain.handle('project:list-workspaces', async () => {
    await wsManager.init()
    return wsManager.listWorkspaces()
  })

  // 获取当前工作区
  ipcMain.handle('project:get-current-workspace', async () => {
    await wsManager.init()
    return wsManager.getCurrentWorkspace()
  })

  // 切换工作区
  ipcMain.handle('project:switch-workspace', async (_event, id: string) => {
    await wsManager.init()
    return wsManager.switchWorkspace(id)
  })

  // 向共享工作区添加一个或多个仓库（支持多选弹窗选目录，或直接传 dirPath / dirPaths）
  ipcMain.handle(
    'project:add-repo',
    async (
      event,
      params: { workspaceId: string; dirPath?: string; dirPaths?: string[]; role?: RepoRole }
    ) => {
      await wsManager.init()
      let dirs: string[] = []
      if (Array.isArray(params.dirPaths) && params.dirPaths.length > 0) {
        dirs = params.dirPaths
      } else if (params.dirPath) {
        dirs = [params.dirPath]
      } else {
        const window = BrowserWindow.fromWebContents(event.sender)
        const result = await dialog.showOpenDialog(window || (undefined as any), {
          title:
            params.role === 'primary'
              ? '选择主项目仓库目录（可多选，首个设为主仓）'
              : '选择要关联的参考仓库目录（可按住 ⌘/Ctrl 多选多个仓库）',
          message:
            params.role === 'primary'
              ? '首个选中的仓库将设为主仓（Primary），其余设为参考仓（Reference）'
              : '支持一次多选多个参考仓库（如组件库、工具库、后端接口定义仓）',
          properties: ['openDirectory', 'multiSelections']
        })
        if (result.canceled || result.filePaths.length === 0) {
          return null
        }
        dirs = result.filePaths
      }
      return wsManager.addReposToWorkspace(params.workspaceId, dirs, params.role)
    }
  )

  // 从共享工作区移除一个仓库
  ipcMain.handle(
    'project:remove-repo',
    async (_event, params: { workspaceId: string; repoPath: string }) => {
      await wsManager.init()
      try {
        const ws = await wsManager.removeRepoFromWorkspace(params.workspaceId, params.repoPath)
        return { ok: true, workspace: ws }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  // 设置共享工作区的主仓库（primary）
  ipcMain.handle(
    'project:set-primary-repo',
    async (_event, params: { workspaceId: string; repoPath: string }) => {
      await wsManager.init()
      const ws = await wsManager.setPrimaryRepo(params.workspaceId, params.repoPath)
      return { ok: Boolean(ws), workspace: ws }
    }
  )

  // 更新工作区基本信息（名称、预览 URL）
  ipcMain.handle(
    'project:update-workspace-meta',
    async (_event, params: { workspaceId: string; name?: string; url?: string }) => {
      await wsManager.init()
      const ws = await wsManager.updateWorkspaceMeta(params.workspaceId, {
        name: params.name,
        url: params.url
      })
      return { ok: Boolean(ws), workspace: ws }
    }
  )

  // 删除一个外部工作区
  ipcMain.handle('project:remove-workspace', async (_event, workspaceId: string) => {
    await wsManager.init()
    try {
      const res = await wsManager.removeWorkspace(workspaceId)
      return { ok: true, ...res }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // 列出共享工作区中立目录下的文件（AGENTS.md + .ps/*）
  ipcMain.handle('project:list-shared-files', async (_event, workspaceId: string) => {
    await wsManager.init()
    const ws = wsManager.getWorkspaceById(workspaceId)
    if (!ws || ws.id === 'default-host') {
      return { ok: false, files: [], error: '非共享工作区' }
    }
    await wsManager.refreshSharedWorkspace(workspaceId)
    const studioDir = wsManager.getStudioDir()
    const files = await listSharedFiles(studioDir, workspaceId)
    const disabled = await isAgentsFileDisabled(studioDir, workspaceId)
    return {
      ok: true,
      files,
      sharedDir: ws.sharedDir,
      agentsDisabled: disabled
    }
  })

  // 读取共享工作区中立目录下的文件
  ipcMain.handle(
    'project:read-shared-file',
    async (_event, params: { workspaceId: string; relPath: string }) => {
      await wsManager.init()
      try {
        const studioDir = wsManager.getStudioDir()
        const content = await readSharedFile(studioDir, params.workspaceId, params.relPath)
        const disabled = await isAgentsFileDisabled(studioDir, params.workspaceId)
        return { ok: true, content, agentsDisabled: disabled }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  // 写入共享工作区中立目录下的文件（AGENTS.md 或 .ps/*）
  ipcMain.handle(
    'project:write-shared-file',
    async (_event, params: { workspaceId: string; relPath: string; content: string }) => {
      await wsManager.init()
      try {
        const studioDir = wsManager.getStudioDir()
        await writeSharedFile(studioDir, params.workspaceId, params.relPath, params.content)
        const files = await listSharedFiles(studioDir, params.workspaceId)
        const disabled = await isAgentsFileDisabled(studioDir, params.workspaceId)
        return { ok: true, files, agentsDisabled: disabled }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  // 删除共享工作区 .ps/ 下的产物文件
  ipcMain.handle(
    'project:delete-shared-file',
    async (_event, params: { workspaceId: string; relPath: string }) => {
      await wsManager.init()
      try {
        const studioDir = wsManager.getStudioDir()
        await deleteSharedFile(studioDir, params.workspaceId, params.relPath)
        const files = await listSharedFiles(studioDir, params.workspaceId)
        return { ok: true, files }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  // 刷新/重新同步工作区的 AGENTS.md 地址表
  ipcMain.handle('project:refresh-shared-workspace', async (_event, workspaceId: string) => {
    await wsManager.init()
    const ws = await wsManager.refreshSharedWorkspace(workspaceId)
    const studioDir = wsManager.getStudioDir()
    const disabled = await isAgentsFileDisabled(studioDir, workspaceId)
    return { ok: Boolean(ws), workspace: ws, agentsDisabled: disabled }
  })

  // 在工作区中反查源文件
  ipcMain.handle('project:find-source-file', async (_event, target: string, prototypeId?: string) => {
    await wsManager.init()
    return wsManager.findSourceFile(target, prototypeId)
  })

  // 保存代码到指定文件（支持自动创建多级子目录）
  ipcMain.handle('project:save-code', async (_event, params: SaveCodeParams) => {
    try {
      const { filePath, content } = params
      if (!filePath) {
        return { success: false, error: '文件路径不能为空' }
      }

      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')

      return {
        success: true,
        savedPath: filePath
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err)
      }
    }
  })

  // 检查目标文件是否已存在（以便前端提示覆写）
  ipcMain.handle('project:check-file-exists', async (_event, filePath: string) => {
    try {
      const exists = fsSync.existsSync(filePath)
      return { exists }
    } catch {
      return { exists: false }
    }
  })
}
