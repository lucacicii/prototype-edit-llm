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
import { resolveRuntimeBinary, RuntimeClient } from '../agent/runtime-client'
import { PrototypeAgent } from '../agent/prototype-agent'
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
  inspectTarget?: { tagName: string; text: string }
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
        const file = path.join(
          options.workspaceDir,
          'runtime-host/src/views/prototypes',
          `${active.prototypeId}.vue`
        )
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, code, 'utf-8')
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:code-updated', { code })
      }
    },
    getDiagnostics: () => BrowserViewManager.getInstance().getDiagnostics(),
    getInspectTarget: () => active?.inspectTarget,
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
        config: modelConfig
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
