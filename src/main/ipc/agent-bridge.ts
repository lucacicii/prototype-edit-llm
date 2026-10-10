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
import { activePrototypeFile, prototypeStackMarker, providerStorePath } from '../app-paths'
import { agentReadiness } from '../runtime-env'
import { resolveRuntimeBinary, RuntimeClient } from '../agent/runtime-client'
import { PointedTarget, PrototypeAgent } from '../agent/prototype-agent'
import { detectTechStack, stackInfo, TechStack } from '../agent/tech-stack'
import {
  AgentConfigFile,
  loadLibrary,
  loadModelConfig,
  ModelLibrary,
  removeModel,
  removeProvider,
  resolveAgentModel,
  saveLibrary,
  saveModelConfig,
  updateProviderEndpoint,
  upsertModel,
  validateModel
} from '../agent/model-config'
import {
  availabilityOf,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING_LEVELS,
  LibraryModel,
  providerIds,
  selectionId,
  SUPPORTED_APIS,
  THINKING_LEVEL_VOCABULARY,
  thinkingLevelsFor
} from '../agent/provider-store'
import {
  encryptionAvailable,
  getApiKey,
  providersWithKeys,
  pruneKeys,
  setApiKey
} from '../agent/secrets'

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

/**
 * The library as the renderer is allowed to see it: no secrets, and the
 * availability verdict computed here rather than in the UI, so the settings
 * page and the composer cannot disagree about whether a model is usable.
 *
 * `keySource` is here because `hasApiKey` on its own lies. A global
 * `PROTOTYPE_AGENT_API_KEY` makes *every* provider look keyed, so a page reading
 * only the boolean would show「已保存（留空则不变）」and offer a
 * 「清除已存密钥」that clears nothing. Saying where the key comes from lets the
 * UI tell the truth, and disable that control when nothing is stored.
 *
 * The four optional passthrough fields are carried for a duller reason: an edit
 * sends back everything it was given, so anything missing here is dropped. The
 * settings page rewrites *every* model of a provider when its endpoint changes,
 * so an omission would not cost one entry — it would cost the whole group.
 */
function redactLibrary(library: ModelLibrary) {
  const keyed = new Set(providersWithKeys())
  const envKey = Boolean(process.env.PROTOTYPE_AGENT_API_KEY?.trim())
  return library.models.map((model) => {
    const keySource: 'stored' | 'env' | null = keyed.has(model.provider)
      ? 'stored'
      : envKey
        ? 'env'
        : null
    const hasApiKey = keySource !== null
    const levels = thinkingLevelsFor(model)
    const availability = availabilityOf(model, hasApiKey)
    return {
      selectionId: selectionId(model),
      provider: model.provider,
      id: model.id,
      name: model.name || model.id,
      api: model.api,
      baseUrl: model.baseUrl,
      hasApiKey,
      keySource,
      headers: model.headers,
      reasoning: Boolean(model.reasoning),
      contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
      thinkingLevels: levels,
      defaultThinkingLevel: model.defaultThinkingLevel ?? levels[0],
      thinkingLevelMap: model.thinkingLevelMap,
      cost: model.cost,
      promptCache: model.promptCache,
      available: availability.available,
      unavailableReason: availability.reason,
      input: model.input
    }
  })
}

/** What the renderer may know about the credential store's health. */
function keyStoreStatus() {
  return {
    /** False on a platform without a keyring — the dialog must say so. */
    encrypted: encryptionAvailable()
  }
}

export function setupAgentIpc(options: { workspaceDir: string }): RuntimeClient {
  const client = new RuntimeClient({ workspaceDir: options.workspaceDir })
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
  // activeStack 是当前激活原型的栈（仲裁结果），决定 applyEdit 落盘的
  // 扩展名与广播给渲染层的栈标记。
  let active: AgentRunParams | null = null
  let activeCode = ''
  let activeStack: TechStack = 'vue3-element'

  /**
   * 落栈标记 + 必要时整页刷新预览。
   *
   * dev server 不重启、Vite 配置只在启动时读，所以栈切换
   * （尤其 Vue↔React，插件装配不同）必须让浏览器重新拉模块图 ——
   * reload 是唯一可靠路径。标记同栈时是幂等写，不触发刷新。
   *
   * 注意：标记对 dev server 的 transform 缓存**不生效**（Vite
   * 的模块图按扩展名缓存，active.vue 与 active.tsx 是两个模块，
   * 路由在浏览器侧重新求值即可，无需清缓存）。
   */
  const applyStack = async (stack: TechStack, forceReload = false) => {
    const marker = prototypeStackMarker()
    const current = await fs.readFile(marker, 'utf-8').catch(() => null)
    if (current !== stack) {
      await fs.mkdir(path.dirname(marker), { recursive: true })
      await fs.writeFile(marker, stack, 'utf-8')
    }
    if (forceReload || (current !== null && current !== stack)) {
      BrowserViewManager.getInstance().reload()
    }
  }

  const agent = new PrototypeAgent({
    client,
    workspaceDir: options.workspaceDir,
    getCode: () => activeCode,
    applyEdit: async (code) => {
      activeCode = code
      // LLM 首行声明优先、内容特征次之（见 tech-stack.ts）。
      // 认不出时保持原栈 —— 存量原型多是 Vue，不能因为一次
      // 仲裁失败就把落盘扩展名换掉。
      const verdict = detectTechStack(code)
      const prevStack = activeStack
      if (verdict.stack) {
        activeStack = verdict.stack
      }
      // 栈换了要同步标记文件并整页刷新（Vite 插件装配只在启动时读）；
      // applyStack 内部对同栈写入是幂等的，不触发刷新。
      await applyStack(activeStack)
      if (active) {
        // The preview host serves one active prototype file; switching
        // prototypes overwrites it, so the route stays a single component.
        const file = activePrototypeFile(activeStack)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, code, 'utf-8')
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:code-updated', {
          code,
          techStack: activeStack,
          experimental: stackInfo(activeStack).experimental,
          stackChanged: activeStack !== prevStack
        })
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
    getTechStack: () => activeStack,
    onFrame: (frame) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:stream-event', frame)
      }
    }
  })

  ipcMain.handle('agent:ping', async () => {
    try {
      if (!client.isRunning) client.start()
      const readiness = await agentReadiness()
      return {
        ok: true,
        version: await client.ping(5_000),
        runtimePath: resolveRuntimeBinary(),
        readiness
      }
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message ?? String(err),
        runtimePath: resolveRuntimeBinary(),
        readiness: await agentReadiness()
      }
    }
  })

  ipcMain.handle('agent:get-config', async () => {
    // Everything is read fresh on every call, so a 「刷新」button and an edit to
    // providers.json out-of-band are both just another call to this handler.
    const resolved = await resolveAgentModel(options.workspaceDir)
    const suggestion = resolved.library.models.find(
      (m) => availabilityOf(m, Boolean(getApiKey(m.provider))).available
    )

    return {
      configured: Boolean(resolved.model),
      /** Why there is no model, when there isn't one — shown verbatim. */
      problem: resolved.model ? null : (resolved.reason ?? null),
      config: resolved.config,
      source: resolved.source,
      path: resolved.workspacePath,
      // When the env var wins, saving is still useful but won't take effect.
      envLocked: Boolean(process.env.PROTOTYPE_AGENT_MODEL?.trim()),
      runtimePath: resolveRuntimeBinary(),
      /** 两项就绪表（内核 / 数据根）：打包版缺哪一环，一眼能看出来。 */
      readiness: await agentReadiness(),
      models: redactLibrary(resolved.library),
      /** The library file itself, so the dialog can show where models live. */
      libraryPath: providerStorePath(),
      keyStore: keyStoreStatus(),
      // The vocabularies live here and only here; the dialog renders what it is
      // handed instead of keeping a second copy that can drift out of step
      // with what the transport actually accepts.
      apiOptions: [...SUPPORTED_APIS],
      thinkingVocabulary: [...THINKING_LEVEL_VOCABULARY],
      defaults: {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
        thinkingLevels: [...DEFAULT_THINKING_LEVELS]
      },
      /** Models just adopted out of a legacy inline config, if any. */
      migrated: resolved.migrated ?? [],
      defaultModel: suggestion
        ? { provider: suggestion.provider, id: suggestion.id, name: suggestion.name }
        : null,
      modelLabel: resolved.model?.name ?? null,
      modelOrigin: resolved.origin ?? null,
      tools: agent.toolSpecs.map((t) => ({
        name: t.name,
        description: t.description,
        effect: t.effect ?? 'write'
      }))
    }
  })

  /**
   * The workspace half: tuning plus a reference into the library. Endpoints and
   * secrets are never written here — that is the whole point of the split.
   */
  ipcMain.handle('agent:set-config', async (_, config: AgentConfigFile) => {
    try {
      if (!config || typeof config !== 'object') {
        return { ok: false, error: '无效的配置内容' }
      }
      if (config.model && (!config.model.provider || !config.model.id)) {
        return { ok: false, error: '模型信息不完整：provider / id 为必填' }
      }
      const file = await saveModelConfig(options.workspaceDir, config)
      return { ok: true, path: file }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  /**
   * Add or update a model in the library, and store its key.
   *
   * A blank `apiKey` means "leave the stored one alone" — the dialog never
   * receives a stored secret, so it also cannot send one back; clearing a key
   * is an explicit `clearApiKey`.
   */
  ipcMain.handle('agent:save-model', async (_, input: LibraryModel & { apiKey?: string; clearApiKey?: boolean }) => {
    try {
      const library = loadLibrary()
      const validated = validateModel(input, library)
      if (!validated.ok || !validated.model) {
        return { ok: false, error: validated.error ?? '模型信息无效' }
      }

      const next = upsertModel(library, validated.model)
      await saveLibrary(next)

      if (input.clearApiKey) {
        await setApiKey(validated.model.provider, undefined)
      } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
        await setApiKey(validated.model.provider, input.apiKey)
      }

      return {
        ok: true,
        model: redactLibrary(next).find(
          (m) => m.provider === validated.model!.provider && m.id === validated.model!.id
        ),
        keyStore: keyStoreStatus()
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  /**
   * Remove a model. If it was the selection, clear the reference too — a
   * dangling pointer would only surface as a failed run later.
   */
  ipcMain.handle('agent:delete-model', async (_, params: { provider: string; id: string }) => {
    try {
      if (!params?.provider || !params?.id) {
        return { ok: false, error: '需要 provider 与 id' }
      }
      const library = loadLibrary()
      const next = removeModel(library, params.provider, params.id)
      await saveLibrary(next)

      // Keys belong to a provider, so only drop one when its last model is gone.
      if (!next.models.some((m) => m.provider === params.provider)) {
        await setApiKey(params.provider, undefined)
      }

      const current = loadModelConfig(options.workspaceDir).config
      let clearedSelection = false
      if (current.model?.provider === params.provider && current.model.id === params.id) {
        await saveModelConfig(options.workspaceDir, { ...current, model: undefined })
        clearedSelection = true
      }

      return { ok: true, clearedSelection }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  /**
   * Remove a whole provider: every model that carries its id, plus its
   * credential.
   *
   * A provider is only the models sharing an id, so this is the delete
   * `delete-model` cannot express. Unlike that one this *reports* a provider it
   * could not find: the caller clicked a row in a list, so "it isn't there" is
   * real information rather than a no-op to swallow.
   */
  ipcMain.handle('agent:delete-provider', async (_, params: { provider: string }) => {
    try {
      if (!params?.provider) return { ok: false, error: '需要 provider' }
      const library = loadLibrary()
      const removed = library.models.filter((m) => m.provider === params.provider).length
      if (!removed) {
        return { ok: false, error: `模型库中没有服务商「${params.provider}」` }
      }

      await saveLibrary(removeProvider(library, params.provider))
      // One provider id names one gateway, so the key goes with it. pruneKeys
      // rather than setApiKey(…, undefined) so a providers.json edited by hand
      // — which can strand ids the library no longer mentions — is swept too.
      const droppedKeys = await pruneKeys(new Set(providerIds(loadLibrary())))

      const current = loadModelConfig(options.workspaceDir).config
      let clearedSelection = false
      if (current.model?.provider === params.provider) {
        // normalizeConfig keeps the tuning and drops just the dangling reference.
        await saveModelConfig(options.workspaceDir, { ...current, model: undefined })
        clearedSelection = true
      }

      return { ok: true, provider: params.provider, removed, clearedSelection, droppedKeys }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  /**
   * Change a provider's endpoint across all of its models, in one write.
   *
   * See `updateProviderEndpoint` for why this is not N calls to `save-model`:
   * `validateModel` checks a candidate against the models still on disk, so a
   * per-model loop collides with its own group and can never land.
   */
  ipcMain.handle(
    'agent:save-provider',
    async (
      _,
      input: { provider: string; api: string; baseUrl: string; apiKey?: string; clearApiKey?: boolean }
    ) => {
      try {
        const provider = typeof input?.provider === 'string' ? input.provider.trim() : ''
        const api = typeof input?.api === 'string' ? input.api.trim() : ''
        const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : ''
        if (!provider || !api || !baseUrl) {
          return { ok: false, error: '服务商标识 / API 协议 / Base URL 都是必填' }
        }

        const result = updateProviderEndpoint(loadLibrary(), provider, { api, baseUrl })
        if (!result) return { ok: false, error: `模型库中没有服务商「${provider}」` }
        await saveLibrary(result.library)

        if (input.clearApiKey) {
          await setApiKey(provider, undefined)
        } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
          await setApiKey(provider, input.apiKey)
        }

        return {
          ok: true,
          provider,
          updated: result.updated.length,
          keyStore: keyStoreStatus()
        }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  ipcMain.handle('agent:tools', () => agent.toolSpecs)

  ipcMain.handle('agent:run', async (_, params: AgentRunParams) => {
    // Same seam as agent:get-config, so the model a run uses is always the one
    // the dialog last showed — including any legacy-config adoption it did.
    const resolved = await resolveAgentModel(options.workspaceDir)
    if (!resolved.model) {
      return { ok: false, error: `尚未配置模型。${resolved.reason ?? ''}`.trim() }
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
        config: resolved.config,
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
