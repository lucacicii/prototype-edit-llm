/**
 * IPC surface for the prototype agent.
 *
 * The renderer owns the editor state, so a run request carries the current
 * source and the (optional) inspected element. Main owns the browser and the
 * file system, so it supplies diagnostics and performs writes. Neither side
 * needs to know how the other stores things.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { BrowserViewManager } from '../browser-view-manager'
import { activePrototypeFile, prototypeStackMarker, providerStorePath } from '../app-paths'
import { agentReadiness } from '../runtime-env'
import { resolveRuntimeBinary, RuntimeClient } from '../agent/runtime-client'
import { PointedTarget, PrototypeAgent } from '../agent/prototype-agent'
import { detectTechStack, stackInfo, TechStack } from '../agent/tech-stack'
import { ThunderClient, getSharedThunderClient } from './thunder-client'
import { syncThunderModelConfig } from '../agent/thunder-model-config'
import { ProjectRunner } from '../project-runner'
import {
  loadProjectItem,
  projectDirFor,
  syncProjectEntryAndStack,
  topologyPathsFor
} from '../project-store'
import { ProjectWorkspaceManager } from '../project-workspace-manager'
import {
  buildTopologyPrompt,
  parseTopologyReply,
  rawExcerpt
} from '../agent/topology'
import { capturePreviewShots, loadShotThumbs, renderGraphPng } from '../topology-capture'
import { djb2, normalizeTopology, type TopologyGraph } from '../../shared/topology'
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
  canonicalThinkingLevels,
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
    // 名字必须和探针 payload / 渲染层 MarkupAnnotation 一致，都是 target。
    // 这里曾写成 element（旧 Vue 渲染层有个 toPlainMarkupTarget 会改名），
    // React 重构删掉那个映射后就一直读到 undefined —— 圈改的定位整条链路是断的。
    target?: PointedTarget
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


/**
 * Turn a transport failure into something a person can act on.
 *
 * thunder reports a run that ended on an error as
 * `FinishReason::Error (see observed error events for details)` — accurate in a
 * log, useless in a chat bubble. The real reason (usually the provider's own
 * HTTP error) arrives separately as an observed `error` event, captured here as
 * `detail`. The provider text is kept verbatim underneath, because it is what a
 * bug report needs.
 */
function describeAgentFailure(rawError: string, detail?: string): string {
  const raw = (rawError || '').trim()
  const d = (detail || '').trim()
  const haystack = `${raw}\n${d}`
  const generic = /FinishReason::Error|see observed error events/i.test(raw)

  let hint: string | null = null
  if (/\b429\b|rate[_ ]?limit|too many requests|temporarily unavailable|overloaded/i.test(haystack)) {
    hint =
      '模型服务商限流或暂时不可用（HTTP 429）。这类问题多出在上游，稍等几十秒重试通常即可恢复；若持续出现，可在设置里换一个模型。'
  } else if (/\b401\b|\b403\b|invalid[_ ]?api[_ ]?key|unauthorized|authentication|no api key/i.test(haystack)) {
    hint = '模型鉴权失败（401/403）。请在设置里检查该模型的 API Key 与 Base URL。'
  } else if (/\b404\b|model[_ ]?not[_ ]?found|does not exist/i.test(haystack)) {
    hint = '模型不存在，或该服务商不提供这个模型（404）。请在设置里确认模型 ID。'
  } else if (/insufficient|quota|billing|balance/i.test(haystack)) {
    hint = '账户额度不足或计费异常，请检查模型服务商账户。'
  } else if (/timed? ?out|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(haystack)) {
    hint = '网络超时或连接被中断，请检查网络后重试。'
  }

  const lines: string[] = []
  if (hint) {
    lines.push(hint)
    if (d) lines.push(`原始错误：${d}`)
  } else if (generic) {
    lines.push('Agent 运行失败，未产出结果。')
    lines.push(d ? `原始错误：${d}` : '（daemon 未上报具体原因，详情见运行日志。）')
  } else {
    lines.push(raw)
    if (d && !raw.includes(d)) lines.push(`原始错误：${d}`)
  }

  return lines.filter(Boolean).join('\n\n')
}

function extractAllowedLevelsFromError(errorText: string): string[] | null {
  const lower = errorText.toLowerCase()

  if (
    lower.includes('reasoning_effort is not supported') ||
    lower.includes('reasoning_effort not supported') ||
    lower.includes('unrecognized request argument supplied: reasoning_effort') ||
    lower.includes('unknown parameter: reasoning_effort') ||
    lower.includes('unsupported parameter: reasoning_effort') ||
    (lower.includes('unsupported parameter') && lower.includes('reasoning_effort')) ||
    lower.includes("unexpected keyword argument 'reasoning_effort'") ||
    lower.includes('thinking is not supported') ||
    lower.includes('thinking is not enabled')
  ) {
    return ['off']
  }

  const candidateTokens = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const hasEnumHint =
    lower.includes('supported values') ||
    lower.includes('must be one of') ||
    lower.includes('input should be') ||
    lower.includes('valid choices') ||
    lower.includes('expected one of') ||
    lower.includes('allowed values') ||
    lower.includes('valid values') ||
    lower.includes('value_error')

  if (hasEnumHint) {
    const found: string[] = []
    if (
      lower.includes("'off'") ||
      lower.includes('"off"') ||
      lower.includes(' off ') ||
      lower.includes('[off')
    ) {
      found.push('off')
    }
    if (
      lower.includes("'none'") ||
      lower.includes('"none"') ||
      lower.includes(' none ') ||
      lower.includes('[none')
    ) {
      found.push('none')
    }

    for (const token of candidateTokens) {
      if (
        lower.includes(`'${token}'`) ||
        lower.includes(`"${token}"`) ||
        lower.includes(` ${token}`) ||
        lower.includes(`[${token}`) ||
        lower.includes(`,${token}`) ||
        lower.includes(`, ${token}`)
      ) {
        found.push(token)
      }
    }

    if (found.length > 0) {
      if (!found.includes('off') && !found.includes('none')) {
        found.unshift('off')
      }
      return canonicalThinkingLevels([...new Set(found)])
    }
  }

  return null
}

function inferThinkingSpec(id: string, item?: any): {
  reasoning: boolean
  thinkingLevels: string[]
  defaultThinkingLevel: string
} {
  const lower = id.toLowerCase()

  // Extract explicit thinking levels from item if provided by gateway
  const rawLevels = Array.isArray(item?.thinking_levels)
    ? item.thinking_levels
    : Array.isArray(item?.thinkingLevels)
      ? item.thinkingLevels
      : null
  if (rawLevels && rawLevels.length > 0) {
    const cleaned = canonicalThinkingLevels(
      rawLevels.filter((v: any) => typeof v === 'string' && v.trim())
    )
    const reasoning = cleaned.some((lv) => lv !== 'off' && lv !== 'none')
    const defaultThinkingLevel =
      typeof item?.default_thinking_level === 'string'
        ? item.default_thinking_level
        : typeof item?.defaultThinkingLevel === 'string'
          ? item.defaultThinkingLevel
          : reasoning
            ? cleaned.includes('medium')
              ? 'medium'
              : cleaned[cleaned.length - 1]
            : 'off'
    return { reasoning, thinkingLevels: cleaned, defaultThinkingLevel }
  }

  const supportedParams: string[] = Array.isArray(item?.supported_parameters)
    ? item.supported_parameters.map((p: any) => String(p).toLowerCase())
    : []
  const metaReasoning =
    Boolean(item?.reasoning) ||
    Boolean(item?.thinking) ||
    Boolean(item?.capabilities?.reasoning) ||
    Boolean(item?.capabilities?.thinking) ||
    supportedParams.includes('reasoning') ||
    supportedParams.includes('reasoning_effort') ||
    supportedParams.includes('include_reasoning') ||
    supportedParams.includes('thinking')

  const isOSeries = /(^|\/|-)o[134](-|$)/.test(lower)
  const isGpt5 = lower.includes('gpt-5')
  const isClaudeThinking =
    lower.includes('claude-3-7') ||
    lower.includes('claude-3.7') ||
    lower.includes('sonnet-3-7') ||
    lower.includes('claude-sonnet-4') ||
    lower.includes('claude-opus-4') ||
    lower.includes('claude-4')
  const isGeminiThinking = lower.includes('gemini-2.5') || lower.includes('gemini-3')

  const nameReasoning =
    lower.includes('r1') ||
    lower.includes('reasoner') ||
    lower.includes('reasoning') ||
    isOSeries ||
    isGpt5 ||
    isClaudeThinking ||
    isGeminiThinking ||
    lower.includes('qwq') ||
    lower.includes('qwen3') ||
    lower.includes('glm-z1') ||
    lower.includes('glm-4.5') ||
    lower.includes('kimi-k1') ||
    lower.includes('kimi-k2') ||
    lower.includes('thinking')

  const reasoning = metaReasoning || nameReasoning
  if (!reasoning) {
    return {
      reasoning: false,
      thinkingLevels: ['off'],
      defaultThinkingLevel: 'off'
    }
  }

  const thinkingLevels = isGpt5
    ? ['off', 'minimal', 'low', 'medium', 'high']
    : ['off', 'low', 'medium', 'high']

  const defaultThinkingLevel =
    lower.includes('reasoner') || lower.includes('r1') ? 'high' : 'medium'

  return {
    reasoning: true,
    thinkingLevels,
    defaultThinkingLevel
  }
}

async function probeModelThinkingLevels(params: {
  api: string
  baseUrl: string
  apiKey?: string
  modelId: string
}): Promise<{
  probed: boolean
  reasoning: boolean
  thinkingLevels: string[]
  defaultThinkingLevel: string
}> {
  const baseUrl = params.baseUrl.trim().replace(/\/+$/, '')
  const modelId = params.modelId.trim()
  const apiKey = params.apiKey?.trim()
  const isAnthropic =
    params.api === 'anthropic-messages' || baseUrl.toLowerCase().includes('anthropic.com')
  const isResponses = params.api === 'openai-responses'

  if (isAnthropic) {
    const url = baseUrl.endsWith('/messages')
      ? baseUrl
      : baseUrl.endsWith('/v1')
        ? `${baseUrl}/messages`
        : `${baseUrl}/v1/messages`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1025,
          messages: [{ role: 'user', content: '1' }],
          thinking: { type: 'enabled', budget_tokens: 1024 }
        }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const body = await resp.text().catch(() => '')
      const lower = body.toLowerCase()

      if (resp.ok || lower.includes('budget_tokens')) {
        return {
          probed: true,
          reasoning: true,
          thinkingLevels: ['off', 'low', 'medium', 'high'],
          defaultThinkingLevel: 'medium'
        }
      }
      if (
        lower.includes('thinking is not supported') ||
        lower.includes('unrecognized field thinking') ||
        lower.includes('extra inputs are not permitted')
      ) {
        return {
          probed: true,
          reasoning: false,
          thinkingLevels: ['off'],
          defaultThinkingLevel: 'off'
        }
      }
    } catch {
      // Fall through to inference
    }
  } else {
    const url = isResponses
      ? baseUrl.endsWith('/responses')
        ? baseUrl
        : baseUrl.endsWith('/v1')
          ? `${baseUrl}/responses`
          : `${baseUrl}/v1/responses`
      : baseUrl.endsWith('/chat/completions')
        ? baseUrl
        : baseUrl.endsWith('/v1')
          ? `${baseUrl}/chat/completions`
          : `${baseUrl}/v1/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    }

    const probePayload = isResponses
      ? {
          model: modelId,
          input: [{ role: 'user', content: [{ type: 'input_text', text: '1' }] }],
          max_output_tokens: 1,
          reasoning_effort: '__probe__'
        }
      : {
          model: modelId,
          messages: [{ role: 'user', content: '1' }],
          max_tokens: 1,
          reasoning_effort: '__probe__'
        }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(probePayload),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const body = await resp.text().catch(() => '')

      if (resp.status >= 400 && resp.status < 500) {
        const extracted = extractAllowedLevelsFromError(body)
        if (extracted) {
          const reasoning = extracted.some((lv) => lv !== 'off' && lv !== 'none')
          const defaultThinkingLevel = !reasoning
            ? extracted[0] || 'off'
            : extracted.includes('medium')
              ? 'medium'
              : extracted.includes('high')
                ? 'high'
                : extracted[extracted.length - 1] || 'off'
          return {
            probed: true,
            reasoning,
            thinkingLevels: extracted,
            defaultThinkingLevel
          }
        }
      }

      // Step 2: test with reasoning_effort = 'low'
      const testPayload = isResponses
        ? {
            model: modelId,
            input: [{ role: 'user', content: [{ type: 'input_text', text: '1' }] }],
            max_output_tokens: 1,
            reasoning_effort: 'low'
          }
        : {
            model: modelId,
            messages: [{ role: 'user', content: '1' }],
            max_tokens: 1,
            reasoning_effort: 'low'
          }

      const controller2 = new AbortController()
      const timeoutId2 = setTimeout(() => controller2.abort(), 6000)
      const testResp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
        signal: controller2.signal
      })
      clearTimeout(timeoutId2)

      if (testResp.ok) {
        return {
          probed: true,
          reasoning: true,
          thinkingLevels: ['off', 'low', 'medium', 'high'],
          defaultThinkingLevel: 'medium'
        }
      }
    } catch {
      // Fall through to inference
    }
  }

  const inferred = inferThinkingSpec(modelId)
  return {
    probed: false,
    ...inferred
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
  // 拓扑图生成与原型 run 共用同一个 daemon 与同一个 workspaceDir，必须串行。
  let topologyInFlight = false
  // 当前那一轮拓扑任务的 daemon task id（重试会换一个），取消要打到具体的它。
  let topologyTaskId: string | null = null
  let topologyCancelRequested = false

  // Full-capability Thunder Daemon client (`read_file`, `write_file`, `bash`, `grep`, `find`, `ls`, `ask_user_question`)
  const daemonClient: ThunderClient = getSharedThunderClient({ workspaceDir: options.workspaceDir })
  daemonClient.on('error', (err: Error) => {
    console.warn('[agent] thunder-daemon error:', err?.message ?? err)
  })
  daemonClient.on('user_question', (msg: any) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:user-question', msg)
    }
  })
  daemonClient.on('ui_request', (msg: any) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:ui-request', msg)
    }
  })
  try {
    daemonClient.start()
  } catch (err) {
    console.warn('[agent] thunder-daemon deferred start:', err)
  }

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
        if (m.target) list.push({ ...m.target, note: m.note })
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

  ipcMain.handle('agent:tools', () => [
    {
      name: 'ask_user_question',
      description: '向产品经理发起结构化的单选/多选问题卡片，澄清产品形态、核心模块、风格与技术栈',
      effect: 'read'
    },
    {
      name: 'read_file',
      description: '读取原型项目工作区内的源码文件',
      effect: 'read'
    },
    {
      name: 'write_file',
      description: '创建或修改原型项目工作区内的源码文件',
      effect: 'write'
    },
    {
      name: 'ls',
      description: '列出原型项目目录结构',
      effect: 'read'
    },
    {
      name: 'find',
      description: '在原型项目中按文件名搜索',
      effect: 'read'
    },
    {
      name: 'grep',
      description: '在原型项目中检索代码或文案内容',
      effect: 'read'
    },
    {
      name: 'bash',
      description: '在原型项目工作区中执行构建、脚本或包管理命令',
      effect: 'exec'
    }
  ])

  ipcMain.handle(
    'agent:answer-question',
    async (
      _,
      params: { questionId: string; answers?: Record<string, any> | any; cancelled?: boolean }
    ) => {
      try {
        if (!daemonClient) return { ok: false, error: 'daemon 未就绪' }
        await daemonClient.answerQuestion(params)
        return { ok: true }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  /**
   * 运行中插话：steer 在下一个工具边界进入（可续命），follow_up 只在
   * 本轮跑完后进入。都不会打断正在执行的工具。
   */
  ipcMain.handle(
    'agent:steer-task',
    async (
      _,
      params: { taskId: string; message: string; behavior?: 'steer' | 'follow_up' }
    ) => {
      try {
        if (!daemonClient) return { ok: false, error: 'daemon 未就绪' }
        await daemonClient.steerTask({
          taskId: params.taskId,
          message: params.message,
          behavior: params.behavior ?? 'steer'
        })
        return { ok: true }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) }
      }
    }
  )

  ipcMain.handle('agent:run', async (_, params: AgentRunParams) => {
    const resolved = await resolveAgentModel(options.workspaceDir)
    if (!resolved.model) {
      return { ok: false, error: `尚未配置模型。${resolved.reason ?? ''}`.trim() }
    }

    active = params
    activeCode = params.code
    const runId = params.runId ?? `run_${Date.now()}`

    // Resolve the target independent project workspace directory
    const wsManager = ProjectWorkspaceManager.getInstance()
    await wsManager.init()
    const currentWs = wsManager.getCurrentWorkspace()
    const isExternalWorkspace = Boolean(currentWs && currentWs.id !== 'default-host')
    if (isExternalWorkspace && currentWs) {
      await wsManager.refreshSharedWorkspace(currentWs.id)
    }
    const projectDir = isExternalWorkspace && currentWs
      ? currentWs.sharedDir || currentWs.rootPath || projectDirFor(params.prototypeId || 'blank-prototype')
      : projectDirFor(params.prototypeId || 'blank-prototype')
    const extraWorkspaceDirs = isExternalWorkspace && currentWs
      ? Array.from(
          new Set(
            [
              ...(currentWs.repos?.map((r) => r.path) ?? []),
              ...(currentWs.rootPath ? [currentWs.rootPath] : [])
            ].filter(Boolean)
          )
        )
      : []

    await fs.mkdir(projectDir, { recursive: true })
    const projectItem = !isExternalWorkspace ? await loadProjectItem(projectDir) : null
    if (projectItem?.techStack) {
      activeStack = projectItem.techStack
    }

    // Build enriched prompt with browser probe inspect/markup targets & runtime diagnostics
    const contextSections: string[] = []
    if (params.inspectTarget?.tagName) {
      const t = params.inspectTarget
      const loc = t.sourceFile
        ? `${t.sourceFile}${t.sourceLine ? ':' + t.sourceLine : ''}${
            t.sourceLocated === false ? ' (文本推断位置)' : ' (探针精确位置)'
          }`
        : `主入口文件 ${projectItem?.entryFile || 'index.html'}`
      contextSections.push(
        [
          `【浏览器探针圈选元素】`,
          `- 标签: <${t.tagName}>`,
          t.componentName ? `- 组件: <${t.componentName}>` : '',
          t.className ? `- 类名: ${t.className}` : '',
          t.selector ? `- 选择器: ${t.selector}` : '',
          `- 源码位置: ${loc}`,
          t.text ? `- 元素文本: "${t.text}"` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
    }

    if (params.markupTargets?.length) {
      const mLines = ['【浏览器探针圈改区域】']
      params.markupTargets.forEach((m, idx) => {
        const el = m.target
        // 定位不到就直说：以前这里退到 entryFile（index.html），模型会当真位置用，
        // 比不给还糟 —— 它会去改入口文件而不是框住的那块。
        const loc = el?.sourceFile
          ? `${el.sourceFile}${el.sourceLine ? ':' + el.sourceLine : ''}${
              el.sourceLocated === false ? ' (文本推断位置)' : ' (探针精确位置)'
            }`
          : '未在框内定位到元素（以批注与选择器为准，不要猜行号）'
        mLines.push(
          `${idx + 1}. 批注要求: "${m.note}" | 目标元素: <${el?.tagName || '未定位'}> | 源码位置: ${loc}${
            el?.selector ? ` | 选择器: ${el.selector}` : ''
          }`
        )
      })
      contextSections.push(mLines.join('\n'))
    }

    const diag = BrowserViewManager.getInstance().getDiagnostics()
    if (diag.hasErrors && diag.errors.length > 0) {
      const errLines = diag.errors.slice(0, 6).map((e) => `- ${e.text}`)
      contextSections.push(`【当前浏览器运行期报错 (${diag.errorCount} 项)】\n${errLines.join('\n')}`)
    }

    const fullPrompt = contextSections.length
      ? `${contextSections.join('\n\n')}\n\n${params.prompt}`
      : params.prompt

    const sessionId =
      projectItem?.sessionId || `sess_${params.prototypeId || 'proto'}`

    let lastStats: Record<string, any> | undefined
    /** Last non-recoverable AgentEvent::Error message; the daemon's own notice is generic. */
    let lastErrorDetail = ''
    const broadcastSyncProject = async () => {
      if (isExternalWorkspace) {
        BrowserViewManager.getInstance().reload()
        return
      }
      const prevStack = activeStack
      const synced = await ProjectRunner.getInstance().syncAndResolvePreviewUrl({
        projectId: params.prototypeId
      })
      activeStack = synced.techStack
      activeCode = synced.code
      if (synced.techStack === 'native-html') {
        BrowserViewManager.getInstance().reload()
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:code-updated', {
          code: synced.code,
          techStack: synced.techStack,
          previewUrl: synced.previewUrl,
          entryFile: synced.entryFile,
          experimental: stackInfo(synced.techStack).experimental,
          stackChanged: synced.techStack !== prevStack
        })
      }
    }

    try {
      // thunder resolves its background/utility model (auto-titles) from its own
      // models.json, not from the per-task descriptor we pass below. Refresh it
      // before the daemon starts so those calls have a real model to use.
      await syncThunderModelConfig()
      daemonClient.start()
      const taskResult = await daemonClient.runTask({
        taskId: runId,
        prompt: fullPrompt,
        sessionId,
        model: selectionId(resolved.model),
        modelDescriptor: resolved.model as unknown as Record<string, any>,
        thinkingLevel: resolved.config.thinkingLevel,
        workspaceDir: projectDir,
        extraWorkspaceDirs: extraWorkspaceDirs.length ? extraWorkspaceDirs : undefined,
        headless: false,
        attachments: params.attachments?.map((a) => ({
          data: a.data,
          mimeType: a.mimeType,
          name: a.name
        })),
        onEvent: (observed: any) => {
          const ev = observed?.event ?? observed
          if (!ev || typeof ev !== 'object') return

          if (ev.type === 'loop_complete' && ev.stats) {
            lastStats = ev.stats
          }

          // The daemon's own failure notice is generic ("see observed error
          // events for details"), so keep the real reason here to put it in
          // front of the user when the task rejects.
          if (ev.type === 'error' && typeof ev.message === 'string' && ev.message.trim()) {
            lastErrorDetail = ev.message.trim()
          }

          // When thunder-daemon modifies or creates a file via `write_file` or `bash`,
          // sync and refresh the live preview immediately!
          if (
            (ev.type === 'custom' && ev.kind === 'file_change') ||
            (ev.type === 'tool_exec_result' &&
              (ev.name === 'write_file' || ev.name === 'bash') &&
              !ev.result?.is_error)
          ) {
            void broadcastSyncProject()
          }

          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('agent:stream-event', {
              type: 'observation',
              run_id: runId,
              event: ev
            })
          }
        }
      })

      await broadcastSyncProject()

      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agent:stream-event', {
          type: 'run_finished',
          run_id: runId,
          finish_reason: (taskResult?.finish_reason || 'done').toLowerCase(),
          final_content: taskResult?.final_content ?? null,
          messages: [],
          stats: lastStats ?? {}
        })
      }

      const latestItem = !isExternalWorkspace
        ? await syncProjectEntryAndStack(params.prototypeId)
        : null

      return {
        ok: true,
        runId,
        finishReason: (taskResult?.finish_reason || 'done').toLowerCase(),
        finalContent: taskResult?.final_content ?? null,
        code: latestItem?.vueCode ?? activeCode,
        techStack: latestItem?.techStack ?? activeStack
      }
    } catch (err: any) {
      // Fallback to `thunder-runtime` if `thunder-daemon` is unavailable
      const errMsg = err?.message ?? String(err)
      if (errMsg.includes('Cancelled') || errMsg.includes('cancelled')) {
        return {
          ok: true,
          runId,
          finishReason: 'cancelled',
          finalContent: null,
          code: activeCode
        }
      }
      return { ok: false, runId, error: describeAgentFailure(errMsg, lastErrorDetail) }
    } finally {
      active = null
    }
  })

  ipcMain.handle('agent:cancel', async (_, runId: string) => {
    try {
      await daemonClient.cancelTask(runId)
    } catch {
      agent.cancel(runId)
    }
    return true
  })

  /**
   * 生成拓扑图（页面跳转流转图）。
   *
   * 走的是与 `agent:run` 同一条 daemon 通路，但只让模型读、只让它回 JSON：
   * - 独立 session：拓扑的提示词与 JSON 不该污染原型对话的上下文；
   * - `headless: true`：关掉 `ask_user_question`，这一轮不需要跟用户交互；
   * - 跑完比对入口文件内容与其它文件的 mtime —— 模型被要求不要写文件，
   *   但 daemon 手里确实有 `write_file`/`bash`，这条约束得能真正强制。
   */
  ipcMain.handle('topology:generate', async (_, params: { prototypeId?: string }) => {
    const prototypeId = params?.prototypeId
    if (!prototypeId) return { ok: false, error: '缺少原型 id' }
    if (topologyInFlight) return { ok: false, error: '正在生成拓扑图，请稍候' }
    if (active) return { ok: false, error: '正在生成原型，等这一轮结束再生成拓扑图' }

    const resolved = await resolveAgentModel(options.workspaceDir)
    if (!resolved.model) {
      return { ok: false, error: `尚未配置模型。${resolved.reason ?? ''}`.trim() }
    }

    const wsManager = ProjectWorkspaceManager.getInstance()
    await wsManager.init()
    const currentWs = wsManager.getCurrentWorkspace()
    if (currentWs && currentWs.id !== 'default-host') {
      // 外部业务工作区里「页面」是一整套工程的路由，跟原型的页面不是一回事。
      // 硬套一张图只会误导，先明确拒绝，别给一张看着像模像样的假图。
      return { ok: false, error: '外部业务工作区暂不支持生成拓扑图，请切回内置原型项目' }
    }

    const projectDir = projectDirFor(prototypeId)
    const item = await loadProjectItem(projectDir)
    if (!item) return { ok: false, error: '项目不存在' }

    const paths = topologyPathsFor(prototypeId)
    const runId = `topo_${Date.now().toString(36)}`
    // 生成前的入口源码：既是「图是否过期」的指纹，也是还原的底稿。
    const entryCode = item.vueCode
    const knownFiles = item.files ?? []
    const before = await fileMtimes(projectDir, knownFiles)

    topologyInFlight = true
    topologyCancelRequested = false
    try {
      const collected = await collectTopologySources(projectDir, item)
      const prompt = buildTopologyPrompt({
        projectName: item.name,
        techStack: item.techStack,
        entryFile: item.entryFile,
        files: knownFiles.length ? knownFiles : [item.entryFile],
        sources: collected.sources,
        truncated: collected.truncated
      })

      await syncThunderModelConfig()
      daemonClient.start()

      let failureDetail = ''
      let finalContent: string | null = null
      // 模型偶尔会回一段散文或带围栏的块；只重试一次，够用了 ——
      // 再失败就是模型不支持这个任务，多试只是烧钱。
      for (let attempt = 1; attempt <= 2; attempt++) {
        // 记下这一轮的 daemon task id，取消要打到具体的它（重试会换个 id）。
        topologyTaskId = `${runId}_a${attempt}`
        const result = await daemonClient.runTask({
          taskId: topologyTaskId,
          prompt:
            attempt === 1
              ? prompt
              : `${prompt}\n\n【上一次的回复无法解析】这一轮只输出那个 JSON 对象，不要解释、不要 markdown 围栏。`,
          sessionId: `sess_topology_${prototypeId}`,
          model: selectionId(resolved.model),
          modelDescriptor: resolved.model as unknown as Record<string, any>,
          // 抽页面与跳转不需要深思，压住延迟与成本。
          thinkingLevel: 'low',
          workspaceDir: projectDir,
          headless: true,
          onEvent: (observed: any) => {
            const ev = observed?.event ?? observed
            if (ev?.type === 'error' && typeof ev.message === 'string' && ev.message.trim()) {
              failureDetail = ev.message.trim()
            }
          }
        })
        finalContent = result?.final_content ?? null
        if (parseTopologyReply(finalContent)) break
      }

      const warnings = await restoreTouchedSources(projectDir, item.entryFile, entryCode, knownFiles, before)

      const parsed = parseTopologyReply(finalContent)
      if (!parsed) {
        // 留一份原文，用户能自己看出模型到底回了什么。
        await fs.mkdir(paths.dir, { recursive: true })
        await fs.writeFile(paths.raw, rawExcerpt(finalContent, 8000), 'utf-8')
        return {
          ok: false,
          runId,
          error: failureDetail
            ? `模型未返回可解析的 JSON：${failureDetail}`
            : '模型未返回可解析的 JSON（原文已存到 .prototype-meta/topology.raw.txt）',
          rawExcerpt: rawExcerpt(finalContent)
        }
      }

      const normalized = normalizeTopology(parsed, djb2(entryCode))
      if (!normalized.graph) {
        return { ok: false, runId, error: normalized.error ?? '模型没有给出可用的页面节点' }
      }

      const allWarnings = [...(normalized.graph.warnings ?? []), ...warnings]
      const graph: TopologyGraph = {
        ...normalized.graph,
        generatedAt: Date.now(),
        ...(allWarnings.length ? { warnings: allWarnings } : {})
      }

      // 接下来要真的去预览里点着截图，这会把带 selectors 的整张图跑一遍，
      // 所以放在写完 JSON 之前：截到的图要一起进 JSON。
      await fs.mkdir(paths.dir, { recursive: true })
      try {
        const preview = await ProjectRunner.getInstance().syncAndResolvePreviewUrl({
          projectId: prototypeId
        })
        const captured = await capturePreviewShots({
          graph,
          previewUrl: preview.previewUrl,
          entryFile: preview.entryFile,
          shotDir: paths.shotsDir
        })
        for (const node of graph.nodes) {
          const shot = captured.shots[node.id]
          if (shot) node.shot = shot
        }
        if (captured.warnings.length) {
          graph.warnings = [...(graph.warnings ?? []), ...captured.warnings]
        }
      } catch (err: any) {
        // 截图是加分项：拿不到图仍然要交出这张图（纯文字卡片）。
        graph.warnings = [
          ...(graph.warnings ?? []),
          `截图失败：${err?.message ?? String(err)}，本次只有页面名称`
        ]
      }

      await fs.writeFile(paths.json, JSON.stringify(graph, null, 2), 'utf-8')

      return { ok: true, runId, graph }
    } catch (err: any) {
      const message = err?.message ?? String(err)
      // daemon 自己的失败文案常常是泛泛一句，取消请求这个标志更可靠。
      if (topologyCancelRequested || /cancel/i.test(message)) {
        return { ok: false, runId, cancelled: true, error: '已取消' }
      }
      return { ok: false, runId, error: message }
    } finally {
      topologyInFlight = false
      topologyTaskId = null
    }
  })

  ipcMain.handle('topology:cancel', async () => {
    if (!topologyTaskId) return { ok: false }
    topologyCancelRequested = true
    try {
      await daemonClient.cancelTask(topologyTaskId)
    } catch {
      // 已经结束了就算了：cancel 的目的是让那一轮停下，不是保证打中。
    }
    return { ok: true }
  })

  /** 面板要的缩略图。单独取，不塞进 `prototype:list` —— 那边每次列项目都会跑。 */
  ipcMain.handle('topology:shots', async (_, params: { prototypeId?: string }) => {
    const prototypeId = params?.prototypeId
    if (!prototypeId) return { ok: false, error: '缺少原型 id' }
    const item = await loadProjectItem(projectDirFor(prototypeId))
    const thumbs = await loadShotThumbs(item?.topology ?? null, topologyPathsFor(prototypeId).dir)
    return { ok: true, shots: Object.fromEntries(thumbs) }
  })

  /**
   * 导出成一张图片。
   *
   * 没有一个「截图服务」能截出这张图 —— 它得由浏览器把 HTML 画出来。所以
   * 走一个隐藏窗口：渲染 → 量出内容尺寸 → 调窗口大小 → 抓成 PNG。用户在
   * 应用里看到的（以及别人收到的）就是这一张图，不再是 HTML。
   */
  ipcMain.handle('topology:export-image', async (_, params: { prototypeId?: string }) => {
    const prototypeId = params?.prototypeId
    if (!prototypeId) return { ok: false, error: '缺少原型 id' }

    const paths = topologyPathsFor(prototypeId)
    const raw = await fs.readFile(paths.json, 'utf-8').catch(() => null)
    if (raw === null) return { ok: false, error: '还没有生成过拓扑图' }

    let graph: TopologyGraph
    try {
      graph = JSON.parse(raw) as TopologyGraph
    } catch {
      return { ok: false, error: '拓扑图数据损坏，请重新生成' }
    }

    const item = await loadProjectItem(projectDirFor(prototypeId))
    const thumbs = await loadShotThumbs(graph, paths.dir)
    const png = await renderGraphPng(graph, thumbs)
    if (!png) return { ok: false, error: '图片渲染失败，请重试' }

    const options = {
      title: '导出拓扑图图片',
      defaultPath: `${item?.name || prototypeId}-页面拓扑图.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true }

    await fs.writeFile(result.filePath, png)
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle(
    'agent:fetch-remote-models',
    async (
      _,
      input: { provider?: string; api?: string; baseUrl: string; apiKey?: string }
    ) => {
      try {
        const baseUrl = (input?.baseUrl || '').trim().replace(/\/+$/, '')
        if (!baseUrl) {
          return { ok: false, error: 'Base URL 不能为空' }
        }

        let apiKey = (input?.apiKey || '').trim()
        if (!apiKey && input?.provider) {
          apiKey = (await getApiKey(input.provider)) || ''
        }
        if (!apiKey && process.env.PROTOTYPE_AGENT_API_KEY) {
          apiKey = process.env.PROTOTYPE_AGENT_API_KEY
        }

        const isAnthropic =
          input.api === 'anthropic-messages' || baseUrl.toLowerCase().includes('anthropic.com')

        const isOllama =
          baseUrl.toLowerCase().includes('ollama') ||
          baseUrl.includes(':11434') ||
          input.provider === 'ollama'

        const urlsToTry: Array<{ url: string; headers: Record<string, string> }> = []

        if (isAnthropic) {
          const u = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
          urlsToTry.push({
            url: u,
            headers: {
              ...(apiKey ? { 'x-api-key': apiKey } : {}),
              'anthropic-version': '2023-06-01'
            }
          })
        } else if (isOllama) {
          urlsToTry.push({
            url: `${baseUrl}/api/tags`,
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
          })
          urlsToTry.push({
            url: `${baseUrl}/v1/models`,
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
          })
        } else {
          const primaryUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
          urlsToTry.push({
            url: primaryUrl,
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
          })
          if (!baseUrl.endsWith('/v1')) {
            urlsToTry.push({
              url: `${baseUrl}/models`,
              headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
            })
          }
        }

        let rawData: any = null
        let lastError = ''

        for (const target of urlsToTry) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000)
            const resp = await fetch(target.url, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                ...target.headers
              },
              signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (resp.ok) {
              rawData = await resp.json()
              break
            } else {
              lastError = `HTTP ${resp.status}: ${resp.statusText}`
            }
          } catch (e: any) {
            lastError = e?.message || String(e)
          }
        }

        if (!rawData) {
          return { ok: false, error: `无法获取模型列表：${lastError || '请求失败'}` }
        }

        const rawList: any[] = Array.isArray(rawData.data)
          ? rawData.data
          : Array.isArray(rawData.models)
          ? rawData.models
          : Array.isArray(rawData)
          ? rawData
          : []

        const guessContextWindow = (id: string): number => {
          const lower = id.toLowerCase()
          if (lower.includes('1m') || lower.includes('gemini-1.5') || lower.includes('gemini-2')) return 1000000
          if (lower.includes('200k') || lower.includes('claude-3') || lower.includes('claude-sonnet') || lower.includes('claude-opus') || lower.includes('claude-4')) return 200000
          if (lower.includes('128k') || lower.includes('gpt-4o') || lower.includes('gpt-5') || lower.includes('qwen') || lower.includes('glm-4') || lower.includes('deepseek')) return 128000
          if (lower.includes('64k')) return 64000
          if (lower.includes('32k')) return 32000
          return 128000
        }

        const guessMaxTokens = (id: string): number => {
          const lower = id.toLowerCase()
          if (/(^|\/|-)o[134](-|$)/.test(lower) || lower.includes('gpt-5')) return 65536
          if (lower.includes('gpt-4o') || lower.includes('claude-3-7') || lower.includes('claude-sonnet-4') || lower.includes('claude-opus-4') || lower.includes('gemini-2')) return 16384
          if (lower.includes('claude-3-5') || lower.includes('deepseek') || lower.includes('qwen')) return 8192
          return 4096
        }

        const guessMultimodal = (id: string, item?: any): boolean => {
          const lower = id.toLowerCase()
          if (item?.architecture?.modality?.includes('image')) return true
          if (item?.input?.includes('image')) return true
          return (
            lower.includes('4o') ||
            lower.includes('gpt-5') ||
            lower.includes('vision') ||
            lower.includes('vl') ||
            lower.includes('claude-3') ||
            lower.includes('claude-sonnet-4') ||
            lower.includes('claude-opus-4') ||
            lower.includes('gemini') ||
            lower.includes('pixtral') ||
            lower.includes('omni')
          )
        }

        const models = rawList
          .map((item: any) => {
            const id = String(item.id || item.name || item.model || '').trim()
            const name = String(item.name || item.display_name || item.id || id).trim()
            const thinkingSpec = inferThinkingSpec(id, item)
            const supportsImages = guessMultimodal(id, item)
            const contextWindow =
              typeof item.context_length === 'number'
                ? item.context_length
                : typeof item.context_window === 'number'
                ? item.context_window
                : guessContextWindow(id)
            const maxTokens =
              typeof item.top_provider?.max_completion_tokens === 'number'
                ? item.top_provider.max_completion_tokens
                : typeof item.max_tokens === 'number'
                ? item.max_tokens
                : guessMaxTokens(id)

            return {
              id,
              name: name !== id ? name : '',
              contextWindow,
              maxTokens,
              reasoning: thinkingSpec.reasoning,
              supportsImages,
              thinkingLevels: thinkingSpec.thinkingLevels,
              defaultThinkingLevel: thinkingSpec.defaultThinkingLevel
            }
          })
          .filter((m: any) => Boolean(m.id))

        return { ok: true, models }
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) }
      }
    }
  )

  ipcMain.handle(
    'agent:probe-thinking-levels',
    async (
      _,
      input: { provider?: string; api?: string; baseUrl: string; apiKey?: string; modelId: string }
    ) => {
      try {
        const baseUrl = (input?.baseUrl || '').trim().replace(/\/+$/, '')
        const modelId = (input?.modelId || '').trim()
        if (!baseUrl || !modelId) {
          return { ok: false, error: 'Base URL 与模型 ID 不能为空' }
        }

        let apiKey = (input?.apiKey || '').trim()
        if (!apiKey && input?.provider) {
          apiKey = (await getApiKey(input.provider)) || ''
        }
        if (!apiKey && process.env.PROTOTYPE_AGENT_API_KEY) {
          apiKey = process.env.PROTOTYPE_AGENT_API_KEY
        }

        const result = await probeModelThinkingLevels({
          api: input.api || 'openai-completions',
          baseUrl,
          apiKey,
          modelId
        })

        return {
          ok: true,
          probed: result.probed,
          source: result.probed ? 'probed' : 'inferred',
          reasoning: result.reasoning,
          thinkingLevels: result.thinkingLevels,
          defaultThinkingLevel: result.defaultThinkingLevel
        }
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) }
      }
    }
  )

  return client
}

/** 图片/字体/压缩包之类不该塞进提示词的文件。 */
const TOPOLOGY_BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'tiff',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tar', 'pdf', 'mp4', 'mov', 'webm', 'mp3', 'wav'
])

// 原型体量都不大，但一个注入了大段数据的 HTML 能轻松上兆 —— 给总量封顶，
// 否则一次拓扑生成的输入就可能顶到模型上下文上限。
const TOPOLOGY_MAX_FILE_CHARS = 60_000
const TOPOLOGY_MAX_TOTAL_CHARS = 120_000

/**
 * 读出可以喂给模型的源码。入口排第一（它是页面的主要线索），
 * 二进制与超预算的跳过，并在 `truncated` 里如实告诉模型「有文件没看全」——
 * 让它别为没读到的文件编页面。
 */
async function collectTopologySources(
  dir: string,
  item: { entryFile: string; files?: string[] }
): Promise<{ sources: { file: string; code: string }[]; truncated: boolean }> {
  const listed = item.files ?? []
  const ordered = [item.entryFile, ...listed.filter((f) => f !== item.entryFile)]
  const sources: { file: string; code: string }[] = []
  const seen = new Set<string>()
  let total = 0
  let truncated = false

  for (const rel of ordered) {
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    if (TOPOLOGY_BINARY_EXT.has(path.extname(rel).slice(1).toLowerCase())) {
      truncated = true
      continue
    }
    if (total >= TOPOLOGY_MAX_TOTAL_CHARS) {
      truncated = true
      continue
    }
    const buf = await fs.readFile(path.join(dir, rel)).catch(() => null)
    if (!buf) continue
    // 空字节 = 二进制，扩展名骗人也拦得住
    if (buf.includes(0)) {
      truncated = true
      continue
    }
    let code = buf.toString('utf-8')
    if (code.length > TOPOLOGY_MAX_FILE_CHARS) {
      code = `${code.slice(0, TOPOLOGY_MAX_FILE_CHARS)}\n…（文件过长，已截断）`
      truncated = true
    }
    total += code.length
    sources.push({ file: rel, code })
  }

  return { sources, truncated }
}

/** 生成前的文件 mtime 快照，用来看模型有没有偷动别的文件。 */
async function fileMtimes(dir: string, files: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const rel of files) {
    const stat = await fs.stat(path.join(dir, rel)).catch(() => null)
    map.set(rel, stat?.isFile() ? stat.mtimeMs : -1)
  }
  return map
}

/**
 * 还原守卫。
 *
 * 提示词里写了「不要修改任何文件」，但 daemon 手里确实有 `write_file`/`bash`，
 * 而这一轮用的就是项目目录本身作为 workspace。入口文件我们有完整底稿，
 * 被改了就直接还原；其它文件只能按 mtime 报出来让用户自己看 ——
 * 读给模型的那些是截断过的，拿截断内容去「还原」反而会毁文件。
 */
async function restoreTouchedSources(
  dir: string,
  entryFile: string,
  entryCode: string,
  knownFiles: string[],
  before: Map<string, number>
): Promise<string[]> {
  const warnings: string[] = []

  const entryNow = await fs.readFile(path.join(dir, entryFile), 'utf-8').catch(() => null)
  if (entryNow !== null && entryNow !== entryCode) {
    await fs.writeFile(path.join(dir, entryFile), entryCode, 'utf-8').catch(() => {})
    warnings.push(`模型改动了入口文件 ${entryFile}，已还原为生成前的版本`)
  }

  const touched: string[] = []
  const after = await fileMtimes(dir, knownFiles)
  for (const [rel, mtime] of after) {
    if (rel === entryFile) continue
    if (before.get(rel) !== mtime) touched.push(rel)
  }

  // 新冒出来的文件也算「动了」
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const known = new Set(knownFiles)
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'AGENTS.md') continue
    if (!known.has(entry.name)) touched.push(entry.name)
  }

  if (touched.length) {
    warnings.push(`模型改动了 ${touched.slice(0, 5).join('、')}，请检查这些文件`)
  }

  return warnings
}
