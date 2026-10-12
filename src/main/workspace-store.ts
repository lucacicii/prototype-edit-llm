import { promises as fs } from 'fs'
import * as path from 'path'

/**
 * 工作区列表的持久化：`~/.prototype-studio/workspaces.json`。
 *
 * 以前列表只在内存里，重启就丢；现在导入的工作区会落盘。内置的默认工作区
 * （我的原型）由代码构造，不进这个文件。当前激活的工作区也不记——每次启动
 * 仍然回到默认工作区。
 *
 * 不依赖 electron，路径由调用方传入。
 */

const STORE_VERSION = 1

interface StoreFile<T> {
  version: number
  activeWorkspaceId?: string
  workspaces: T[]
}

export function workspaceStorePath(studioDir: string): string {
  return path.join(studioDir, 'workspaces.json')
}

export async function loadActiveWorkspaceId(studioDir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(workspaceStorePath(studioDir), 'utf8')) as StoreFile<unknown>
    if (!parsed || parsed.version !== STORE_VERSION) return null
    return typeof parsed.activeWorkspaceId === 'string' && parsed.activeWorkspaceId.trim()
      ? parsed.activeWorkspaceId.trim()
      : null
  } catch {
    return null
  }
}

/** 读失败（不存在 / 损坏 / 版本不认识）一律当作空列表，不能挡住启动。 */
export async function loadWorkspaceList<T>(studioDir: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(workspaceStorePath(studioDir), 'utf8')) as StoreFile<T>
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.workspaces)) return []
    return parsed.workspaces
  } catch {
    return []
  }
}

/** 先写临时文件再 rename，避免崩在半截留下损坏的 JSON。 */
export async function saveWorkspaceList<T>(
  studioDir: string,
  workspaces: readonly T[],
  activeWorkspaceId?: string
): Promise<void> {
  const file = workspaceStorePath(studioDir)
  const body: StoreFile<T> = {
    version: STORE_VERSION,
    ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
    workspaces: [...workspaces]
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
  await fs.rename(tmp, file)
}
