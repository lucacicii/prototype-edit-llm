/**
 * “导入 HTML 文件”的编排层：校验文件 → 规划资源 → 建独立原型项目 → 复制资源。
 *
 * 与 `html-assets.ts` 的分工：
 * - 这里只做 I/O 与项目生命周期，解析/规划/复制在纯模块里，便于自检。
 * - IPC 也注册在本模块，避免 `project-store.ts` 反过来 import 这里造成循环依赖。
 */

import * as electron from 'electron'
import { existsSync, promises as fs } from 'fs'
import * as path from 'path'
import {
  collectAssetPlan,
  copyAssetPlan,
  deriveProjectName,
  ensureNativeHtmlMarker
} from './html-assets'
import {
  createProjectOnDisk,
  loadProjectItem,
  projectDirFor,
  setActiveProjectId,
  type PrototypeProjectItem
} from './project-store'

const MAX_ENTRY_BYTES = 32 * 1024 * 1024

export interface HtmlImportResult {
  ok: boolean
  cancelled?: boolean
  item?: PrototypeProjectItem
  warnings?: string[]
  skipped?: Array<{ ref: string; reason: string }>
  copiedCount?: number
  error?: string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildImportedMessage(params: {
  name: string
  filePath: string
  assetCount: number
  warnings: string[]
}): string {
  const lines = [
    `已从本地 HTML 文件导入原型【${params.name}】。`,
    `源文件：\`${params.filePath}\``,
    params.assetCount > 0
      ? `已自动带上页面引用的 ${params.assetCount} 个本地资源（保持原相对路径）。`
      : '页面没有引用本地资源。',
    '可以直接预览、圈选，或告诉我想修改哪里。'
  ]
  if (params.warnings.length > 0) {
    lines.push('', '导入提示：', ...params.warnings.slice(0, 5).map((warning) => `- ${warning}`))
    if (params.warnings.length > 5) {
      lines.push(`- …另有 ${params.warnings.length - 5} 条提示`)
    }
  }
  return lines.join('\n')
}

export async function importHtmlFile(params: {
  filePath: string
  name?: string
}): Promise<HtmlImportResult> {
  const filePath = path.resolve(params.filePath)

  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) {
      return { ok: false, error: '所选路径不是文件' }
    }

    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.html' && ext !== '.htm') {
      return { ok: false, error: '只支持导入 .html / .htm 文件' }
    }
    if (stat.size === 0) {
      return { ok: false, error: 'HTML 文件为空' }
    }
    if (stat.size > MAX_ENTRY_BYTES) {
      return {
        ok: false,
        error: `HTML 文件超过 ${Math.round(MAX_ENTRY_BYTES / 1024 / 1024)} MB，无法导入`
      }
    }

    const buffer = await fs.readFile(filePath)
    if (buffer.subarray(0, 4096).includes(0)) {
      return { ok: false, error: '文件看起来是二进制内容，不是 HTML 文本' }
    }

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      return {
        ok: false,
        error: 'HTML 文件不是 UTF-8 编码（可能是 GBK/GB2312）。请先转成 UTF-8 再导入。'
      }
    }
    text = text.replace(/^﻿/, '')
    if (!text.trim()) {
      return { ok: false, error: 'HTML 文件为空' }
    }

    const marked = ensureNativeHtmlMarker(text)
    const name = (params.name?.trim() || deriveProjectName({ filePath, html: text })).slice(0, 60)

    // 先只读规划：缺失、越界、超限在这一步就知道，项目还没落盘。
    const plan = await collectAssetPlan({ entryAbsPath: filePath, html: marked.html })

    let id = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `proto-html-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`
      if (!existsSync(projectDirFor(candidate))) {
        id = candidate
        break
      }
    }
    if (!id) {
      return { ok: false, error: '无法分配项目 ID，请重试' }
    }

    const initialMessages = [
      {
        role: 'assistant' as const,
        content: buildImportedMessage({
          name,
          filePath,
          assetCount: plan.assets.length,
          warnings: plan.warnings
        }),
        timestamp: Date.now()
      }
    ]

    let item: PrototypeProjectItem
    try {
      item = await createProjectOnDisk({
        id,
        name,
        description: '从本地 HTML 文件导入（原文件未修改）',
        scenario: 'auto',
        preferredStack: 'native-html',
        forcedStack: 'native-html',
        initialCode: marked.html,
        initialMessages
      })
    } catch (err) {
      // 项目是本次新建的，失败就把半成品目录清掉。
      await fs.rm(projectDirFor(id), { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: `创建项目失败：${errorMessage(err)}` }
    }

    const copied = await copyAssetPlan(plan, projectDirFor(id))
    const warnings = [...plan.warnings, ...copied.warnings]

    setActiveProjectId(id)
    const loaded = await loadProjectItem(projectDirFor(id))

    return {
      ok: true,
      item: loaded ?? item,
      warnings,
      skipped: plan.skipped,
      copiedCount: copied.copied
    }
  } catch (err) {
    return { ok: false, error: `导入失败：${errorMessage(err)}` }
  }
}

export function setupHtmlImportIpc(): void {
  const ipcMain = (electron as any).ipcMain
  const dialog = (electron as any).dialog
  const BrowserWindow = (electron as any).BrowserWindow
  if (!ipcMain || !dialog) return

  ipcMain.handle(
    'prototype:import-html',
    async (event: any, params?: { filePath?: string; name?: string }) => {
      let filePath = params?.filePath
      if (!filePath) {
        const parent = BrowserWindow?.fromWebContents(event.sender)
        const res = await dialog.showOpenDialog(parent || (undefined as any), {
          title: '选择要导入的 HTML 原型文件',
          properties: ['openFile'],
          filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]
        })
        if (res.canceled || !res.filePaths?.[0]) {
          return { ok: true, cancelled: true }
        }
        filePath = res.filePaths[0]
      }
      return importHtmlFile({ filePath: String(filePath), name: params?.name })
    }
  )
}
