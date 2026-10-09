/**
 * IPC surface for the prototype agent.
 *
 * The renderer owns the editor state, so a run request carries the current
 * source and the (optional) inspected element. Main owns the browser and the
 * file system, so it supplies diagnostics and performs writes. Neither side
 * needs to know how the other stores things.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { BrowserViewManager } from '../browser-view-manager'
import { activePrototypeFile } from '../app-paths'
import { resolveRuntimeBinary, RuntimeClient } from '../agent/runtime-client'
import { PointedTarget, PrototypeAgent } from '../agent/prototype-agent'
import {
  AgentConfigFile,
  isConfigured,
  loadModelConfig,
  resolveModel,
  saveModelConfig
} from '../agent/model-config'
import {
  loadThunderModels,
  pickDefaultThunderModel,
  ThunderModelCatalog
} from '../agent/thunder-models'

export interface AgentRunParams {
  runId?: string
  prompt: string
  code: string
  prototypeId: string
  history?: { role: 'user' | 'assistant' | 'tool' | 'system'; content: string | null }[]
  /**
   * 圈选点中的元素。走的是同一个 PointedTarget —— 以前这里是内联的
   * `{tagName, text}`，把选择器/组件/源码位置全挡在了 IPC 之外，模型调
   * get_inspect_target 也问不出目标在哪一行。
   */
  inspectTarget?: PointedTarget
  /**
   * 圈改（画方框）时框住的每一块：探针在框里认出来的元素 + 框的范围 + 该框的批注。
   * 一次可以框好几处，全部一起送 —— 只发最后一个是上一版的 bug。
   */
  markupTargets?: {
    id?: string
    note: string
    rect: { left: number; top: number; width: number; height: number }
    element?: PointedTarget
  }[]
  /** 图片附件：透传给 prototype-agent，落到本轮那条 user 消息的 parts 上。 */
  attachments?: { name: string; mimeType: string; data: string }[]
}

/** The catalog minus secrets: the renderer only learns whether a key exists. */
function redactCatalog(catalog: ThunderModelCatalog) {
  return catalog.models.map(({ apiKey, ...model }) => ({
    ...model,
    hasApiKey: Boolean(apiKey) || model.hasApiKey
  }))
}

export function setupAgentIpc(options: { workspaceDir: string }): RuntimeClient {
  const client = new RuntimeClient()
  // Without a listener an EventEmitter 'error' would take the whole app down;
  // a broken/missing runtime should only fail the run, never the window.
  client.on('error', (err: Error) => {
    console.error('[agent] thunder-runtime error:', err?.message ?? err)
  })
  client.on('exit', (code: number | null) => {
    console.warn(`[agent] thunder-runtime exited (code ${code})`)
  })

  // Per-run inputs the tools read. A run is single-flight in this app, so one
  // slot is enough, and it is cleared when the run settles.
  let active: AgentRunParams | null = null
  let activeCode = ''

  const agent = new PrototypeAgent({
    client,
    workspaceDir: options.workspaceDir,
    getCode: () => activeCode,
    applyEdit: async (code) => {
      activeCode = code
      if (active) {
        // The preview host serves one active prototype file; switching
        // prototypes overwrites it, so the route stays a single component.
        const file = activePrototypeFile()
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, code, 'utf-8')
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:code-updated', { code })
      }
    },
    getDiagnostics: () => BrowserViewManager.getInstance().getDiagnostics(),
    // 圈改没有「点中的元素」，但框里认出来的那个同样回答了
    // 「用户在说哪一块」，所以并到同一条通道上 —— 否则
    // get_inspect_target 会在圈改时回「没有圈选任何元素」，跟指令里
    // 描述的那几块区域自相矛盾。
    // 圈选排在最前：那是用户更明确的指认（同时也是老行为）。
    getPointedTargets: () => {
      const list: PointedTarget[] = []
      if (active?.inspectTarget) list.push(active.inspectTarget)
      for (const m of active?.markupTargets ?? []) {
        if (m.element) list.push({ ...m.element, note: m.note })
      }
      return list.filter((t) => t.tagName)
    },
    onFrame: (frame) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:stream-event', frame)
      }
    }
  })

  ipcMain.handle('agent:ping', async () => {
    try {
      if (!client.isRunning) client.start()
      return { ok: true, version: await client.ping(5_000), runtimePath: resolveRuntimeBinary() }
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message ?? String(err),
        runtimePath: resolveRuntimeBinary()
      }
    }
  })

  ipcMain.handle('agent:get-config', () => {
    const loaded = loadModelConfig(options.workspaceDir)
    // Read fresh every time, so the 「刷新」button and edits to models.json
    // are both just another call to this handler.
    const catalog = loadThunderModels(options.workspaceDir)
    const resolved = resolveModel(loaded.config, catalog)
    const suggestion = pickDefaultThunderModel(catalog)

    return {
      configured: Boolean(resolved),
      config: loaded.config,
      source: loaded.source,
      path: loaded.workspacePath,
      // When the env var wins, saving is still useful but won't take effect.
      envLocked: Boolean(process.env.PROTOTYPE_AGENT_MODEL?.trim()),
      runtimePath: resolveRuntimeBinary(),
      models: redactCatalog(catalog),
      utilityModel: catalog.utilityModel,
      modelSources: catalog.sources,
      defaultModel: suggestion
        ? { provider: suggestion.provider, id: suggestion.id, name: suggestion.name }
        : null,
      modelLabel: resolved?.model.name ?? null,
      modelOrigin: resolved?.origin ?? null,
      tools: agent.toolSpecs.map((t) => ({
        name: t.name,
        description: t.description,
        effect: t.effect ?? 'write'
      }))
    }
  })

  ipcMain.handle('agent:set-config', async (_, config: AgentConfigFile) => {
    try {
      if (!config || typeof config !== 'object') {
        return { ok: false, error: '无效的配置内容' }
      }
      if (config.model && (!config.model.provider || !config.model.id)) {
        return { ok: false, error: '模型信息不完整：provider / id 为必填' }
      }
      const manual = config.model as { api?: string; baseUrl?: string } | undefined
      if (manual && Boolean(manual.api) !== Boolean(manual.baseUrl)) {
        return { ok: false, error: '手动模式需要同时填写 api 与 baseUrl' }
      }
      const file = await saveModelConfig(options.workspaceDir, config)
      return { ok: true, path: file }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('agent:tools', () => agent.toolSpecs)

  ipcMain.handle('agent:run', async (_, params: AgentRunParams) => {
    const { config: modelConfig } = loadModelConfig(options.workspaceDir)
    const catalog = loadThunderModels(options.workspaceDir)
    const resolved = resolveModel(modelConfig, catalog)
    if (!resolved) {
      const hint = isConfigured(modelConfig)
        ? '当前模型无法解析。'
        : catalog.models.length
          ? '请点击右上角「⚙️ 模型设置」从 .thunder 列表中选择一个模型。'
          : '未在 ~/.thunder/models.json 找到模型，请在「⚙️ 模型设置」中手动填写。'
      return {
        ok: false,
        error: `尚未配置模型。${hint}`
      }
    }

    active = params
    activeCode = params.code
    const runId = params.runId ?? `run_${Date.now()}`

    try {
      const outcome = await agent.run({
        runId,
        prompt: params.prompt,
        history: (params.history ?? []).map((m) => m as any),
        model: resolved.model,
        config: modelConfig,
        attachments: params.attachments
      })
      return { ok: true, runId, ...outcome }
    } catch (err: any) {
      return { ok: false, runId, error: err?.message ?? String(err) }
    } finally {
      active = null
    }
  })

  ipcMain.handle('agent:cancel', (_, runId: string) => {
    agent.cancel(runId)
    return true
  })

  return client
}
