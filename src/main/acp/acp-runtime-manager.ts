import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as electron from 'electron'
const BrowserWindow =
  'BrowserWindow' in electron
    ? (electron.BrowserWindow as typeof import('electron').BrowserWindow)
    : undefined
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { AcpAgentConnection, formatAcpError, parseConfigOptions } from './agent-connection'
import { setFileWriteListener } from './handlers/fs'
import { setTerminalExitListener } from './handlers/terminal'
import { setPermissionPromptHandler } from './handlers/permission'
import { subscribeSessionUpdates, clearSessionUpdateListeners } from './session-update-bus'
import { usageMetricsPayload } from './usage-metrics'
import type {
  AcpAgentLaunchConfig,
  AcpAvailableCommand,
  AcpConfigOption,
  AcpMode,
  AcpModelsState,
  AcpPermissionPolicy,
  AcpPermissionRequestPayload,
  AcpProvider,
  AcpSessionState,
  SessionUpdatePayload
} from './types'

function parseAvailableCommands(value: unknown): AcpAvailableCommand[] {
  if (!Array.isArray(value)) return []
  const commands: AcpAvailableCommand[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const name = 'name' in item && typeof item.name === 'string' ? item.name.trim().replace(/^\/+/, '') : ''
    if (!name || /[\s/]/.test(name)) continue
    const normalized = name.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    const description = 'description' in item && typeof item.description === 'string' ? item.description.trim() : ''
    const inputHint =
      'input' in item && item.input && typeof item.input === 'object' && 'hint' in item.input && typeof item.input.hint === 'string'
        ? item.input.hint.trim()
        : undefined
    commands.push({ name, description, ...(inputHint ? { inputHint } : {}) })
  }
  return commands
}

export function extractChunkContent(content: unknown): { text: string; thinking: string } {
  if (typeof content === 'string') {
    return { text: content, thinking: '' }
  }
  if (!content) return { text: '', thinking: '' }
  const blocks = Array.isArray(content) ? content : typeof content === 'object' ? [content] : []
  let text = ''
  let thinking = ''
  for (const block of blocks) {
    if (typeof block === 'string') {
      text += block
      continue
    }
    if (!block || typeof block !== 'object') continue
    const type = 'type' in block && typeof block.type === 'string' ? block.type.toLowerCase() : ''
    const blockThinking = 'thinking' in block && typeof block.thinking === 'string' ? block.thinking : ''
    const blockText = 'text' in block && typeof block.text === 'string' ? block.text : ''
    const blockDelta = 'delta' in block && typeof block.delta === 'string' ? block.delta : ''

    if (type === 'thinking' || type === 'thought' || type === 'reasoning' || blockThinking) {
      thinking += blockThinking || blockText
    } else if (blockText) {
      text += blockText
    } else if (blockDelta) {
      text += blockDelta
    }
  }
  return { text, thinking }
}

export function resolveAcpToolName(update: Record<string, unknown>): string {
  const title = 'title' in update && typeof update.title === 'string' ? update.title.trim() : ''
  if (title && title.toLowerCase() !== 'tool') {
    return title
  }
  const kind = 'kind' in update && typeof update.kind === 'string' ? update.kind.toLowerCase() : ''
  const rawInput = 'rawInput' in update && update.rawInput && typeof update.rawInput === 'object' ? update.rawInput : null
  if (rawInput) {
    if ('command' in rawInput || 'parsed_cmd' in rawInput) return 'bash'
    if ('old_string' in rawInput || 'new_string' in rawInput) return 'edit_file'
    if ('content' in rawInput && ('path' in rawInput || 'file_path' in rawInput)) return 'write_file'
    if ('path' in rawInput || 'file_path' in rawInput) return 'read_file'
  }
  if (kind === 'execute') return 'bash'
  if (kind === 'edit') return 'edit_file'
  if (kind === 'read') return 'read_file'
  if (kind === 'delete' || kind === 'move') return kind
  return 'tool'
}

function extractToolArgs(update: Record<string, unknown>): Record<string, unknown> {
  if ('rawInput' in update && update.rawInput && typeof update.rawInput === 'object') {
    return update.rawInput as Record<string, unknown>
  }
  if ('locations' in update && Array.isArray(update.locations)) {
    return { locations: update.locations }
  }
  return {}
}

function formatToolOutput(update: Record<string, unknown>): string | Record<string, unknown> {
  if ('rawOutput' in update && update.rawOutput !== undefined) {
    if (typeof update.rawOutput === 'string') return update.rawOutput
    if (typeof update.rawOutput === 'object' && update.rawOutput !== null) {
      return update.rawOutput as Record<string, unknown>
    }
    return String(update.rawOutput)
  }
  if ('content' in update && Array.isArray(update.content)) {
    return update.content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c && typeof c.text === 'string') return c.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

interface ActiveSessionEntry {
  connection: AcpAgentConnection
  state: AcpSessionState
  unsubscribeUpdates?: () => void
}

export class AcpRuntimeManager {
  private static instance: AcpRuntimeManager | null = null
  private readonly sessions = new Map<string, ActiveSessionEntry>()
  private readonly activeRuns = new Map<string, { sessionKey: string }>()
  private readonly permissionWaiters = new Map<
    string,
    { resolve: (value: RequestPermissionResponse) => void }
  >()
  private readonly alwaysAllowedOptions = new Set<string>()

  static getInstance(): AcpRuntimeManager {
    if (!AcpRuntimeManager.instance) {
      AcpRuntimeManager.instance = new AcpRuntimeManager()
    }
    return AcpRuntimeManager.instance
  }

  private sessionKey(provider: AcpProvider, workspaceKey: string): string {
    return `${provider}:${workspaceKey}`
  }

  private broadcastState(state: AcpSessionState): void {
    try {
      if (typeof BrowserWindow !== 'undefined' && BrowserWindow?.getAllWindows) {
        for (const win of BrowserWindow.getAllWindows()) {
          win?.webContents?.send?.('agent:acp-state', state)
        }
      }
    } catch {
      // ignore in test
    }
  }

  getState(provider: AcpProvider, workspaceKey: string): AcpSessionState | null {
    const key = this.sessionKey(provider, workspaceKey)
    return this.sessions.get(key)?.state ?? null
  }

  async connectSession(params: {
    provider: AcpProvider
    workspaceKey: string
    projectPath: string
    savedSessionId?: string
    launchOverrides?: Partial<Record<AcpProvider, Partial<AcpAgentLaunchConfig>>>
    force?: boolean
  }): Promise<AcpSessionState> {
    const key = this.sessionKey(params.provider, params.workspaceKey)
    const existing = this.sessions.get(key)

    if (
      !params.force &&
      existing &&
      existing.connection.isLive() &&
      existing.state.projectPath === params.projectPath &&
      existing.state.status === 'ready'
    ) {
      this.broadcastState(existing.state)
      return existing.state
    }

    if (existing) {
      existing.unsubscribeUpdates?.()
      existing.connection.dispose()
      this.sessions.delete(key)
    }

    const state: AcpSessionState = {
      provider: params.provider,
      workspaceKey: params.workspaceKey,
      projectPath: params.projectPath,
      status: 'connecting',
      modes: [],
      models: null,
      configOptions: [],
      availableCommands: [],
      imageUpload: false,
      embeddedContext: false
    }
    this.broadcastState(state)

    const connection = new AcpAgentConnection(params.provider, params.launchOverrides)

    try {
      let sessionId = ''
      let modes: AcpMode[] = []
      let currentModeId: string | undefined
      let models: AcpModelsState | null = null
      let configOptions: AcpConfigOption[] = []

      if (params.savedSessionId) {
        const restored = await connection.restoreSession(params.savedSessionId, params.projectPath)
        sessionId = restored.sessionId
        modes = restored.modes?.availableModes ?? []
        currentModeId = restored.modes?.currentModeId
        models = restored.models
        configOptions = restored.configOptions
      } else {
        const started = await connection.startSession(params.projectPath)
        sessionId = started.sessionId
        modes = started.modes?.availableModes ?? []
        currentModeId = started.modes?.currentModeId
        models = started.models
        configOptions = started.configOptions
      }

      state.acpSessionId = sessionId
      state.status = 'ready'
      state.modes = modes
      state.currentModeId = currentModeId
      state.models = models
      state.configOptions = configOptions
      state.imageUpload = connection.supportsImageUpload()
      state.embeddedContext = connection.supportsEmbeddedContext()

      const unsubscribe = subscribeSessionUpdates(sessionId, (payload: SessionUpdatePayload) => {
        this.handleExternalSessionUpdate(key, payload)
      })

      this.sessions.set(key, { connection, state, unsubscribeUpdates: unsubscribe })
      this.broadcastState(state)
      return state
    } catch (err: unknown) {
      state.status = 'error'
      state.error = formatAcpError(err)
      this.broadcastState(state)
      connection.dispose()
      throw err
    }
  }

  private handleExternalSessionUpdate(sessionKey: string, payload: SessionUpdatePayload): void {
    const entry = this.sessions.get(sessionKey)
    if (!entry) return
    const update = payload.update
    if (update.sessionUpdate === 'available_commands_update' && 'availableCommands' in update) {
      entry.state.availableCommands = parseAvailableCommands(update.availableCommands)
      this.broadcastState(entry.state)
    } else if (
      update.sessionUpdate === 'config_options_update' &&
      Array.isArray(update.configOptions)
    ) {
      entry.state.configOptions = parseConfigOptions(update.configOptions)
      this.broadcastState(entry.state)
    }
  }

  async runPrompt(params: {
    runId: string
    provider: AcpProvider
    workspaceKey: string
    projectPath: string
    prompt: string
    attachments?: Array<{ name: string; mimeType: string; data: string }>
    savedSessionId?: string
    launchOverrides?: Partial<Record<AcpProvider, Partial<AcpAgentLaunchConfig>>>
    permissionPolicy: AcpPermissionPolicy
    onEvent: (ev: Record<string, unknown>) => void
    onFileChange: () => void
    onSessionIdChanged?: (acpSessionId: string) => Promise<void>
  }): Promise<{ finishReason: string; finalContent: string }> {
    const key = this.sessionKey(params.provider, params.workspaceKey)
    const sessionState = await this.connectSession({
      provider: params.provider,
      workspaceKey: params.workspaceKey,
      projectPath: params.projectPath,
      savedSessionId: params.savedSessionId,
      launchOverrides: params.launchOverrides
    })

    const entry = this.sessions.get(key)
    if (!entry || !sessionState.acpSessionId) {
      throw new Error(`无法启动 ACP 会话: ${key}`)
    }

    if (params.savedSessionId && sessionState.acpSessionId !== params.savedSessionId) {
      await params.onSessionIdChanged?.(sessionState.acpSessionId)
    }

    this.activeRuns.set(params.runId, { sessionKey: key })
    entry.state.status = 'running'
    this.broadcastState(entry.state)

    let fileChangeTimer: NodeJS.Timeout | undefined
    const triggerFileChangeDebounced = () => {
      clearTimeout(fileChangeTimer)
      fileChangeTimer = setTimeout(() => {
        params.onFileChange()
      }, 150)
    }

    setFileWriteListener((filePath: string) => {
      const resolved = path.resolve(filePath)
      const root = path.resolve(params.projectPath)
      if (resolved.startsWith(root)) {
        triggerFileChangeDebounced()
      }
    })

    setTerminalExitListener((info) => {
      if (info.exitCode === 0) {
        triggerFileChangeDebounced()
      }
    })

    setPermissionPromptHandler(async (permReq: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
      const options = permReq.options || []
      const allowOnce = options.find((o) => o.kind === 'allow_once')
      const allowAlways = options.find((o) => o.kind === 'allow_always')
      const firstAllow = allowOnce || allowAlways || options[0]

      if (params.permissionPolicy === 'allowAll') {
        if (firstAllow) {
          return { outcome: { outcome: 'selected', optionId: firstAllow.optionId } }
        }
        return { outcome: { outcome: 'cancelled' } }
      }

      if (allowAlways && this.alwaysAllowedOptions.has(allowAlways.optionId)) {
        return { outcome: { outcome: 'selected', optionId: allowAlways.optionId } }
      }

      params.onEvent({
        type: 'custom',
        kind: 'agent_status',
        payload: {
          session_id: sessionState.acpSessionId,
          phase: 'awaiting_user',
          turn: 1,
          started_at_ms: Date.now(),
          seq: 1
        }
      })

      const requestId = crypto.randomUUID()
      const payload: AcpPermissionRequestPayload = {
        requestId,
        runId: params.runId,
        workspaceKey: params.workspaceKey,
        provider: params.provider,
        title: permReq.toolCall.title || '需要授权操作',
        options: options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind
        }))
      }

      try {
        if (typeof BrowserWindow !== 'undefined' && BrowserWindow?.getAllWindows) {
          for (const win of BrowserWindow.getAllWindows()) {
            win?.webContents?.send?.('agent:acp-permission-request', payload)
          }
        }
      } catch {
        // ignore in test
      }

      return new Promise<RequestPermissionResponse>((resolve) => {
        let timer: NodeJS.Timeout | undefined
        const finish = (res: RequestPermissionResponse) => {
          clearTimeout(timer)
          this.permissionWaiters.delete(requestId)
          resolve(res)
        }
        timer = setTimeout(() => {
          finish({ outcome: { outcome: 'cancelled' } })
        }, 120_000)

        this.permissionWaiters.set(requestId, {
          resolve: (val) => finish(val)
        })
      })
    })

    // Prepare prompt blocks
    type PromptBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string; uri?: string }
      | { type: 'resource_link'; uri: string; name: string; mimeType?: string }

    const blocks: PromptBlock[] = []
    if (params.attachments && params.attachments.length > 0) {
      for (const att of params.attachments) {
        if (entry.connection.supportsImageUpload() && att.mimeType.startsWith('image/')) {
          blocks.push({
            type: 'image',
            data: att.data,
            mimeType: att.mimeType
          })
        } else {
          try {
            const attDir = path.join(params.projectPath, '.prototype-meta', 'attachments')
            await fs.mkdir(attDir, { recursive: true })
            const filePath = path.join(attDir, att.name)
            await fs.writeFile(filePath, Buffer.from(att.data, 'base64'))
            blocks.push({
              type: 'resource_link',
              uri: pathToFileURL(filePath).href,
              name: att.name,
              mimeType: att.mimeType
            })
          } catch (e) {
            console.warn('[ACP] failed to save attachment:', e)
          }
        }
      }
    }
    blocks.push({ type: 'text', text: params.prompt })

    let currentTurn = 1
    let seq = 0
    let finalText = ''
    const startTime = Date.now()

    params.onEvent({ type: 'turn_start', turn: currentTurn })
    params.onEvent({
      type: 'custom',
      kind: 'agent_status',
      payload: {
        session_id: sessionState.acpSessionId,
        phase: 'thinking',
        turn: currentTurn,
        started_at_ms: startTime,
        seq: ++seq
      }
    })

    // ACP 能给的用量只有 `usage_update`（上下文占用 / 窗口上限）。本轮多少
    // token、多快、缓存、会话累计 —— 协议不回，也就不算、不发（见 usage-metrics.ts）。
    const thoughtOption = sessionState.configOptions.find(
      (opt) =>
        opt.type === 'select' && (opt.category === 'thought_level' || opt.id === 'reasoning_effort')
    )
    const metricLabels = {
      sessionId: sessionState.acpSessionId,
      model: sessionState.models?.currentModelId,
      thinkingLevel:
        thoughtOption && thoughtOption.type === 'select'
          ? String(thoughtOption.currentValue)
          : undefined
    }

    const handleUpdate = (payload: SessionUpdatePayload) => {
      const update = payload.update
      const kind = update.sessionUpdate

      if (kind === 'agent_thought_chunk') {
        let thought = ''
        if ('thought' in update && typeof update.thought === 'string') {
          thought = update.thought
        } else if ('content' in update) {
          const extracted = extractChunkContent(update.content)
          thought = extracted.thinking || extracted.text
        }
        if (thought) {
          params.onEvent({ type: 'reasoning_delta', turn: currentTurn, delta: thought })
          params.onEvent({
            type: 'custom',
            kind: 'agent_status',
            payload: {
              session_id: sessionState.acpSessionId,
              phase: 'thinking',
              turn: currentTurn,
              started_at_ms: Date.now(),
              seq: ++seq
            }
          })
        }
      } else if (kind === 'agent_message_chunk' && 'content' in update) {
        const extracted = extractChunkContent(update.content)
        if (extracted.thinking) {
          params.onEvent({ type: 'reasoning_delta', turn: currentTurn, delta: extracted.thinking })
        }
        if (extracted.text) {
          finalText += extracted.text
          params.onEvent({ type: 'token_delta', turn: currentTurn, delta: extracted.text })
          params.onEvent({
            type: 'custom',
            kind: 'agent_status',
            payload: {
              session_id: sessionState.acpSessionId,
              phase: 'streaming',
              turn: currentTurn,
              started_at_ms: Date.now(),
              seq: ++seq
            }
          })
        }
      } else if (kind === 'tool_call') {
        const toolCallId =
          'toolCallId' in update && typeof update.toolCallId === 'string'
            ? update.toolCallId
            : crypto.randomUUID()
        const toolName = resolveAcpToolName(update)
        const toolArgs = extractToolArgs(update)

        params.onEvent({
          type: 'tool_exec_start',
          turn: currentTurn,
          tool_call_id: toolCallId,
          name: toolName,
          arguments: toolArgs
        })
        params.onEvent({
          type: 'custom',
          kind: 'agent_status',
          payload: {
            session_id: sessionState.acpSessionId,
            phase: 'tool',
            tool: toolName,
            turn: currentTurn,
            started_at_ms: Date.now(),
            seq: ++seq
          }
        })
      } else if (kind === 'tool_call_update') {
        const status = 'status' in update && typeof update.status === 'string' ? update.status : ''
        const toolCallId =
          'toolCallId' in update && typeof update.toolCallId === 'string' ? update.toolCallId : ''
        const toolName = resolveAcpToolName(update)

        if (status === 'completed' || status === 'failed') {
          const formatted = formatToolOutput(update)
          params.onEvent({
            type: 'tool_exec_result',
            turn: currentTurn,
            tool_call_id: toolCallId,
            name: toolName,
            result: {
              output: formatted,
              is_error: status === 'failed'
            }
          })

          const rawKind = 'kind' in update && typeof update.kind === 'string' ? update.kind : ''
          const modifiesFiles =
            rawKind === 'edit' ||
            rawKind === 'delete' ||
            rawKind === 'move' ||
            rawKind === 'execute' ||
            /write|edit|bash|create/i.test(toolName)

          if (status === 'completed' && modifiesFiles) {
            triggerFileChangeDebounced()
          }
        }
      } else if (kind === 'usage_update') {
        // ACP 唯一的用量数字：上下文占了多少 / 窗口多大。一来就转发。
        const used = typeof update.used === 'number' ? update.used : 0
        const size = typeof update.size === 'number' ? update.size : 0
        if (used > 0 || size > 0) {
          params.onEvent({
            type: 'custom',
            kind: 'metrics_update',
            payload: usageMetricsPayload({
              isRunning: true,
              turn: currentTurn,
              used,
              size,
              ...metricLabels
            })
          })
        }
      }
    }

    const unsubRun = subscribeSessionUpdates(sessionState.acpSessionId, handleUpdate)

    try {
      const res = await entry.connection.prompt(sessionState.acpSessionId, blocks)
      const durationMs = Date.now() - startTime

      params.onEvent({
        type: 'turn_end',
        turn: currentTurn,
        finish_reason: res.stopReason || 'done',
        // 只报我们真的测得到的：这一轮用了多久。token 用量协议不回。
        stats: { duration_ms: durationMs }
      })

      return {
        finishReason: res.stopReason || 'done',
        finalContent: finalText
      }
    } finally {
      unsubRun()
      if (fileChangeTimer) {
        clearTimeout(fileChangeTimer)
        params.onFileChange()
      }
      setFileWriteListener(null)
      setTerminalExitListener(null)
      setPermissionPromptHandler(null)
      this.activeRuns.delete(params.runId)
      entry.state.status = 'ready'
      this.broadcastState(entry.state)
    }
  }

  async cancelRun(runId: string): Promise<boolean> {
    const run = this.activeRuns.get(runId)
    if (!run) return false
    const entry = this.sessions.get(run.sessionKey)
    if (entry && entry.state.acpSessionId) {
      await entry.connection.cancel(entry.state.acpSessionId)
      return true
    }
    return false
  }

  respondPermission(requestId: string, optionId?: string, cancelled = false): void {
    const waiter = this.permissionWaiters.get(requestId)
    if (!waiter) return
    if (cancelled || !optionId) {
      waiter.resolve({ outcome: { outcome: 'cancelled' } })
    } else {
      if (optionId.includes('always')) {
        this.alwaysAllowedOptions.add(optionId)
      }
      waiter.resolve({ outcome: { outcome: 'selected', optionId } })
    }
    try {
      if (typeof BrowserWindow !== 'undefined' && BrowserWindow?.getAllWindows) {
        for (const win of BrowserWindow.getAllWindows()) {
          win?.webContents?.send?.('agent:acp-permission-resolved', { requestId, optionId, cancelled })
        }
      }
    } catch {
      // ignore in test
    }
  }

  async setMode(provider: AcpProvider, workspaceKey: string, modeId: string): Promise<void> {
    const key = this.sessionKey(provider, workspaceKey)
    const entry = this.sessions.get(key)
    if (!entry || !entry.state.acpSessionId) return
    await entry.connection.setMode(entry.state.acpSessionId, modeId)
    entry.state.currentModeId = modeId
    this.broadcastState(entry.state)
  }

  async setConfigOption(
    provider: AcpProvider,
    workspaceKey: string,
    configId: string,
    value: string | boolean
  ): Promise<void> {
    const key = this.sessionKey(provider, workspaceKey)
    const entry = this.sessions.get(key)
    if (!entry || !entry.state.acpSessionId) return
    const updatedOptions = await entry.connection.setConfigOption(
      entry.state.acpSessionId,
      configId,
      value
    )
    entry.state.configOptions = updatedOptions
    this.broadcastState(entry.state)
  }

  disconnectSession(provider: AcpProvider, workspaceKey: string): void {
    const key = this.sessionKey(provider, workspaceKey)
    const entry = this.sessions.get(key)
    if (entry) {
      if (entry.state.acpSessionId) {
        clearSessionUpdateListeners(entry.state.acpSessionId)
      }
      entry.unsubscribeUpdates?.()
      entry.connection.dispose()
      entry.state.status = 'disconnected'
      this.broadcastState(entry.state)
      this.sessions.delete(key)
    }
  }

  disposeAll(): void {
    for (const [key, entry] of this.sessions) {
      if (entry.state.acpSessionId) {
        clearSessionUpdateListeners(entry.state.acpSessionId)
      }
      entry.unsubscribeUpdates?.()
      entry.connection.dispose()
      this.sessions.delete(key)
    }
    this.activeRuns.clear()
    this.permissionWaiters.clear()
    this.alwaysAllowedOptions.clear()
  }
}
