import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { ProjectWorkspaceManager } from '../project-workspace-manager'

export interface SaveCodeParams {
  filePath: string
  content: string
}

export function setupProjectIpc(): void {
  const wsManager = ProjectWorkspaceManager.getInstance()

  // 打开目录选择器
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

  // 导入并注册本地项目工作区
  ipcMain.handle('project:import-directory', async (event, portOrUrl?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window || (undefined as any), {
      title: '选择要导入的前端项目工程目录',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const dir = result.filePaths[0]
    const ws = await wsManager.importDirectory(dir, portOrUrl)
    return ws
  })

  // 导入外部或现有 URL 工作区
  ipcMain.handle('project:import-url', (_event, params: { url: string; name?: string }) => {
    return wsManager.importUrl(params.url, params.name)
  })

  // 获取所有工作区列表
  ipcMain.handle('project:list-workspaces', () => {
    return wsManager.listWorkspaces()
  })

  // 获取当前工作区
  ipcMain.handle('project:get-current-workspace', () => {
    return wsManager.getCurrentWorkspace()
  })

  // 切换工作区
  ipcMain.handle('project:switch-workspace', (_event, id: string) => {
    return wsManager.switchWorkspace(id)
  })

  // 在工作区中反查源文件
  ipcMain.handle('project:find-source-file', async (_event, target: string) => {
    return wsManager.findSourceFile(target)
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
