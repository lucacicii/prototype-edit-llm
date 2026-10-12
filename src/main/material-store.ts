/**
 * Prototype Material Library Store (`~/.prototype-studio/materials/`).
 *
 * Users can upload images, documents, mock data (JSON/CSV), code snippets, and
 * design specs as global or referenced material dependencies for prototypes.
 */

import * as electron from 'electron'
import { promises as fs, existsSync } from 'fs'
import * as path from 'path'
import { materialsFilesDir, materialsRootDir } from './app-paths'
import { ProjectRunner } from './project-runner'

export type MaterialCategory = 'image' | 'document' | 'data' | 'code' | 'other'

export interface MaterialItem {
  id: string
  /** Display name */
  name: string
  /** Original uploaded filename */
  originalName: string
  /** Stored filename inside `~/.prototype-studio/materials/files/` */
  fileName: string
  category: MaterialCategory
  mimeType: string
  size: number
  /** Optional usage note/description for AI Agent (e.g. "品牌 Logo", "首页 Banner", "订单列表字段") */
  description: string
  tags: string[]
  /** Whether this material is enabled as an active dependency for prototype generation */
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Resolved HTTP URL served by ProjectRunner static server (`http://127.0.0.1:4322/materials/<fileName>`) */
  url?: string
  /** Absolute file path on disk */
  filePath?: string
}

const INDEX_FILE = 'index.json'

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.vue': 'text/vue'
}

export function inferCategoryAndMime(fileName: string, providedMime?: string): {
  category: MaterialCategory
  mimeType: string
} {
  const ext = path.extname(fileName).toLowerCase()
  const mime = (providedMime && providedMime !== 'application/octet-stream'
    ? providedMime
    : EXT_MIME_MAP[ext] || 'application/octet-stream'
  ).toLowerCase()

  if (
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'].includes(ext)
  ) {
    return { category: 'image', mimeType: mime }
  }
  if (['.json', '.csv', '.xml', '.yaml', '.yml'].includes(ext) || mime.includes('json') || mime.includes('csv')) {
    return { category: 'data', mimeType: mime }
  }
  if (
    ['.md', '.txt', '.pdf', '.doc', '.docx'].includes(ext) ||
    mime.startsWith('text/markdown') ||
    mime === 'application/pdf'
  ) {
    return { category: 'document', mimeType: mime }
  }
  if (['.vue', '.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.less', '.html'].includes(ext)) {
    return { category: 'code', mimeType: mime }
  }
  if (mime.startsWith('text/')) {
    return { category: 'document', mimeType: mime }
  }
  return { category: 'other', mimeType: mime }
}

function sanitizeFileName(raw: string): string {
  const parsed = path.parse(raw)
  const safeBase =
    parsed.name
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5.]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || 'material'
  const safeExt = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase()
  return `${safeBase}${safeExt}`
}

async function readIndexFile(): Promise<MaterialItem[]> {
  const indexPath = path.join(materialsRootDir(), INDEX_FILE)
  try {
    if (!existsSync(indexPath)) return []
    const raw = await fs.readFile(indexPath, 'utf-8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeIndexFile(items: MaterialItem[]): Promise<void> {
  const root = materialsRootDir()
  await fs.mkdir(root, { recursive: true })
  const indexPath = path.join(root, INDEX_FILE)
  // Strip runtime computed properties before persisting
  const serializable = items.map(({ url: _u, filePath: _p, ...rest }) => rest)
  await fs.writeFile(indexPath, JSON.stringify(serializable, null, 2), 'utf-8')
}

export async function listMaterials(): Promise<MaterialItem[]> {
  const filesDir = materialsFilesDir()
  const rawItems = await readIndexFile()
  const runner = ProjectRunner.getInstance()
  await runner.startStaticServer()

  const validItems: MaterialItem[] = []
  let dirty = false

  for (const item of rawItems) {
    const fullPath = path.join(filesDir, item.fileName)
    if (!existsSync(fullPath)) {
      dirty = true
      continue
    }
    validItems.push({
      ...item,
      enabled: item.enabled !== false,
      description: item.description || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      url: runner.getStaticMaterialUrl(item.fileName),
      filePath: fullPath
    })
  }

  if (dirty) {
    await writeIndexFile(validItems)
  }

  validItems.sort((a, b) => b.updatedAt - a.updatedAt)
  return validItems
}

async function allocateUniqueFileName(filesDir: string, desiredName: string): Promise<string> {
  const safe = sanitizeFileName(desiredName)
  if (!existsSync(path.join(filesDir, safe))) {
    return safe
  }
  const parsed = path.parse(safe)
  let counter = 1
  while (existsSync(path.join(filesDir, `${parsed.name}-${counter}${parsed.ext}`))) {
    counter++
  }
  return `${parsed.name}-${counter}${parsed.ext}`
}

export async function importMaterialFromPath(
  srcPath: string,
  options?: { description?: string; category?: MaterialCategory }
): Promise<MaterialItem> {
  const filesDir = materialsFilesDir()
  await fs.mkdir(filesDir, { recursive: true })

  const stat = await fs.stat(srcPath)
  const originalName = path.basename(srcPath)
  const storedFileName = await allocateUniqueFileName(filesDir, originalName)
  const dstPath = path.join(filesDir, storedFileName)
  await fs.copyFile(srcPath, dstPath)

  const inferred = inferCategoryAndMime(originalName)
  const now = Date.now()
  const id = `mat_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const item: MaterialItem = {
    id,
    name: path.parse(originalName).name || originalName,
    originalName,
    fileName: storedFileName,
    category: options?.category || inferred.category,
    mimeType: inferred.mimeType,
    size: stat.size,
    description: options?.description || '',
    tags: [],
    enabled: true,
    createdAt: now,
    updatedAt: now
  }

  const current = await readIndexFile()
  current.unshift(item)
  await writeIndexFile(current)

  const runner = ProjectRunner.getInstance()
  await runner.startStaticServer()

  return {
    ...item,
    url: runner.getStaticMaterialUrl(storedFileName),
    filePath: dstPath
  }
}

export async function saveUploadedMaterialBuffer(params: {
  name: string
  dataBase64: string
  mimeType?: string
  description?: string
  category?: MaterialCategory
}): Promise<MaterialItem> {
  const filesDir = materialsFilesDir()
  await fs.mkdir(filesDir, { recursive: true })

  const originalName = params.name || 'material.bin'
  const storedFileName = await allocateUniqueFileName(filesDir, originalName)
  const dstPath = path.join(filesDir, storedFileName)

  const base64Clean = params.dataBase64.includes(',')
    ? params.dataBase64.split(',')[1]
    : params.dataBase64
  const buf = Buffer.from(base64Clean, 'base64')
  await fs.writeFile(dstPath, buf)

  const inferred = inferCategoryAndMime(originalName, params.mimeType)
  const now = Date.now()
  const id = `mat_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const item: MaterialItem = {
    id,
    name: path.parse(originalName).name || originalName,
    originalName,
    fileName: storedFileName,
    category: params.category || inferred.category,
    mimeType: inferred.mimeType,
    size: buf.byteLength,
    description: params.description || '',
    tags: [],
    enabled: true,
    createdAt: now,
    updatedAt: now
  }

  const current = await readIndexFile()
  current.unshift(item)
  await writeIndexFile(current)

  const runner = ProjectRunner.getInstance()
  await runner.startStaticServer()

  return {
    ...item,
    url: runner.getStaticMaterialUrl(storedFileName),
    filePath: dstPath
  }
}

const TEXT_PREVIEW_MAX_BYTES = 128 * 1024

export async function readMaterialContent(idOrFileName: string): Promise<{
  ok: boolean
  item?: MaterialItem
  isText?: boolean
  content?: string
  truncated?: boolean
  error?: string
}> {
  const all = await listMaterials()
  const target = all.find(
    (m) =>
      m.id === idOrFileName ||
      m.fileName === idOrFileName ||
      `materials/${m.fileName}` === idOrFileName
  )
  if (!target || !target.filePath) {
    return { ok: false, error: '物料不存在' }
  }

  const isText =
    target.category === 'document' ||
    target.category === 'data' ||
    target.category === 'code' ||
    target.mimeType.startsWith('text/') ||
    target.mimeType.includes('json') ||
    target.mimeType.includes('xml') ||
    target.mimeType.includes('svg')

  if (!isText || target.mimeType === 'application/pdf') {
    return { ok: true, item: target, isText: false }
  }

  try {
    const buf = await fs.readFile(target.filePath)
    const truncated = buf.byteLength > TEXT_PREVIEW_MAX_BYTES
    const content = buf.subarray(0, TEXT_PREVIEW_MAX_BYTES).toString('utf-8')
    return {
      ok: true,
      item: target,
      isText: true,
      content,
      truncated
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || '读取物料失败' }
  }
}

/**
 * Ensure a project directory has a `materials` symlink pointing to `~/.prototype-studio/materials/files`
 * so relative paths like `./materials/<fileName>` also work seamlessly inside the project.
 */
export async function ensureProjectMaterialsLink(projectDir: string): Promise<void> {
  try {
    const targetDir = materialsFilesDir()
    const linkPath = path.join(projectDir, 'materials')
    const stat = await fs.lstat(linkPath).catch(() => null)
    if (stat) return
    await fs.symlink(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    // Ignore if symlink creation is unsupported or already exists
  }
}

export function setupMaterialStoreIpc(): void {
  const ipcMain = (electron as any).ipcMain
  const dialog = (electron as any).dialog
  if (!ipcMain) return

  ipcMain.handle('material:list', async () => {
    const items = await listMaterials()
    return { ok: true, items }
  })

  ipcMain.handle(
    'material:upload-dialog',
    async (_: any, options?: { category?: MaterialCategory; description?: string }) => {
      if (!dialog) return { ok: false, error: 'Dialog unavailable' }
      const res = await dialog.showOpenDialog({
        title: '选择上传至物料库的文件或图片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '所有物料 (图片 / 文档 / 数据 / 代码)',
            extensions: [
              'png',
              'jpg',
              'jpeg',
              'webp',
              'gif',
              'svg',
              'ico',
              'md',
              'txt',
              'json',
              'csv',
              'html',
              'css',
              'js',
              'ts',
              'tsx',
              'vue',
              'pdf',
              'yaml',
              'yml',
              'xml'
            ]
          },
          { name: '图片素材', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'] },
          { name: '文档与数据', extensions: ['md', 'txt', 'json', 'csv', 'yaml', 'yml', 'pdf'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (res.canceled || !res.filePaths?.length) {
        return { ok: true, added: [], items: await listMaterials() }
      }

      const added: MaterialItem[] = []
      for (const filePath of res.filePaths) {
        try {
          const item = await importMaterialFromPath(filePath, options)
          added.push(item)
        } catch (err) {
          console.warn('[material-store] failed to import:', filePath, err)
        }
      }

      const items = await listMaterials()
      return { ok: true, added, items }
    }
  )

  ipcMain.handle(
    'material:upload-files',
    async (
      _: any,
      params: {
        files: Array<{
          name: string
          dataBase64: string
          mimeType?: string
          description?: string
          category?: MaterialCategory
        }>
      }
    ) => {
      if (!Array.isArray(params?.files) || params.files.length === 0) {
        return { ok: false, error: '未提供文件数据' }
      }
      const added: MaterialItem[] = []
      for (const f of params.files) {
        if (!f?.name || typeof f.dataBase64 !== 'string') continue
        const item = await saveUploadedMaterialBuffer(f)
        added.push(item)
      }
      const items = await listMaterials()
      return { ok: true, added, items }
    }
  )

  ipcMain.handle(
    'material:update',
    async (
      _: any,
      params: {
        id: string
        name?: string
        description?: string
        category?: MaterialCategory
        tags?: string[]
        enabled?: boolean
      }
    ) => {
      if (!params?.id) return { ok: false, error: '缺少物料 ID' }
      const current = await readIndexFile()
      const idx = current.findIndex((m) => m.id === params.id)
      if (idx < 0) return { ok: false, error: '未找到该物料' }

      const updated: MaterialItem = {
        ...current[idx],
        ...(params.name !== undefined ? { name: params.name.trim() || current[idx].name } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.category !== undefined ? { category: params.category } : {}),
        ...(params.tags !== undefined ? { tags: params.tags } : {}),
        ...(params.enabled !== undefined ? { enabled: Boolean(params.enabled) } : {}),
        updatedAt: Date.now()
      }
      current[idx] = updated
      await writeIndexFile(current)

      const items = await listMaterials()
      const fullItem = items.find((m) => m.id === params.id)
      return { ok: true, item: fullItem, items }
    }
  )

  ipcMain.handle('material:delete', async (_: any, id: string) => {
    if (!id) return { ok: false, error: '缺少物料 ID' }
    const current = await readIndexFile()
    const target = current.find((m) => m.id === id)
    if (target) {
      const fullPath = path.join(materialsFilesDir(), target.fileName)
      await fs.rm(fullPath, { force: true }).catch(() => {})
    }
    const next = current.filter((m) => m.id !== id)
    await writeIndexFile(next)
    const items = await listMaterials()
    return { ok: true, items }
  })

  ipcMain.handle('material:read-content', async (_: any, idOrFileName: string) => {
    return readMaterialContent(idOrFileName)
  })
}
