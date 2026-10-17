import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import * as path from 'node:path'
import type { AgentCapabilities, ClientConnection, ClientContext } from '@agentclientprotocol/sdk'
import { resolveSpawnCommand } from './process-path'
import { resolveAcpLaunchConfig } from './agent-registry'
import { createAcpClientApp } from './create-client-app'
import { getAcpSdk } from './sdk'
import type {
  AcpProvider,
  AcpAgentLaunchConfig,
  AcpConfigOption,
  AcpConfigOptionCategory,
  AcpConfigSelectOption,
  AcpConfigSelectGroup,
  AcpMode,
  AcpModelsState
} from './types'

const STDERR_BUFFER_LIMIT = 2048
const ACP_HANDSHAKE_TIMEOUT_MS = 60_000

export interface AcpSessionModes {
  currentModeId: string
  availableModes: AcpMode[]
}

export interface SessionMeta {
  modes: AcpSessionModes | null
  models: AcpModelsState | null
  configOptions: AcpConfigOption[]
}

export interface RestoreSessionResult extends SessionMeta {
  sessionId: string
  method: 'resume' | 'load' | 'new'
  raw?: Record<string, unknown>
}

export interface StartSessionResult extends SessionMeta {
  sessionId: string
  raw?: Record<string, unknown>
}

export type AcpPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | {
      type: 'resource_link'
      uri: string
      name: string
      mimeType?: string
      size?: number
      title?: string
    }
  | {
      type: 'resource'
      resource:
        | { uri: string; text: string; mimeType?: string }
        | { uri: string; blob: string; mimeType?: string }
    }

export function formatAcpError(error: unknown): string {
  if (error == null) return 'Unknown error'
  if (typeof error !== 'object') return String(error)

  let message = 'Unknown error'
  if (error instanceof Error) {
    message = error.message
  } else if ('message' in error && typeof error.message === 'string') {
    message = error.message
  }

  const code =
    'code' in error &&
    (typeof error.code === 'number' || typeof error.code === 'string')
      ? String(error.code)
      : undefined

  let detail = ''
  if ('data' in error) {
    const data = error.data
    if (typeof data === 'string') {
      detail = data
    } else if (data && typeof data === 'object') {
      if ('details' in data && typeof data.details === 'string') detail = data.details
      else if ('message' in data && typeof data.message === 'string') detail = data.message
      else {
        try {
          detail = JSON.stringify(data)
        } catch {
          detail = ''
        }
      }
    }
  }

  const parts = [message]
  if (code) parts.push(`code ${code}`)
  if (detail && detail !== message) parts.push(detail)
  return parts.join(': ')
}

function parseSessionModes(value: unknown): AcpSessionModes | null {
  if (!value || typeof value !== 'object') return null
  const currentModeId =
    'currentModeId' in value && typeof value.currentModeId === 'string'
      ? value.currentModeId
      : undefined
  const availableModes =
    'availableModes' in value && Array.isArray(value.availableModes)
      ? value.availableModes
      : undefined

  if (currentModeId && availableModes && availableModes.length > 0) {
    const list: AcpMode[] = []
    for (const entry of availableModes) {
      if (
        entry &&
        typeof entry === 'object' &&
        'id' in entry &&
        'name' in entry &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string'
      ) {
        list.push({ id: entry.id, name: entry.name })
      }
    }
    if (list.length > 0) {
      return { currentModeId, availableModes: list }
    }
  }
  return null
}

function parseSessionModels(value: unknown): AcpModelsState | null {
  if (!value || typeof value !== 'object') return null
  const currentModelId =
    'currentModelId' in value && typeof value.currentModelId === 'string'
      ? value.currentModelId
      : undefined
  const availableModels =
    'availableModels' in value && Array.isArray(value.availableModels)
      ? value.availableModels
      : undefined

  if (currentModelId && availableModels && availableModels.length > 0) {
    const list: Array<{ modelId: string; name: string }> = []
    for (const entry of availableModels) {
      if (
        entry &&
        typeof entry === 'object' &&
        'modelId' in entry &&
        'name' in entry &&
        typeof entry.modelId === 'string' &&
        typeof entry.name === 'string'
      ) {
        list.push({ modelId: entry.modelId, name: entry.name })
      }
    }
    if (list.length > 0) {
      return { currentModelId, availableModels: list }
    }
  }
  return null
}

function normalizeSelectOptions(
  value: unknown
): Array<AcpConfigSelectOption | AcpConfigSelectGroup> {
  if (!Array.isArray(value)) return []
  const out: Array<AcpConfigSelectOption | AcpConfigSelectGroup> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    if (
      'group' in item &&
      typeof item.group === 'string' &&
      'options' in item &&
      Array.isArray(item.options)
    ) {
      const options: AcpConfigSelectOption[] = []
      for (const opt of item.options) {
        if (opt && typeof opt === 'object' && 'value' in opt && typeof opt.value === 'string') {
          const name = 'name' in opt && typeof opt.name === 'string' ? opt.name : opt.value
          options.push({ value: opt.value, name })
        }
      }
      if (options.length > 0) {
        const groupName = 'name' in item && typeof item.name === 'string' ? item.name : item.group
        out.push({
          group: item.group,
          name: groupName,
          options
        })
      }
      continue
    }
    if ('value' in item && typeof item.value === 'string') {
      const name = 'name' in item && typeof item.name === 'string' ? item.name : item.value
      out.push({ value: item.value, name })
    }
  }
  return out
}

function firstSelectValue(
  options: Array<AcpConfigSelectOption | AcpConfigSelectGroup>
): string | undefined {
  for (const opt of options) {
    if ('value' in opt) return opt.value
    if ('options' in opt && opt.options[0]) return opt.options[0].value
  }
  return undefined
}

export function parseConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return []
  const result: AcpConfigOption[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = 'id' in raw && typeof raw.id === 'string' ? raw.id : ''
    const name = 'name' in raw && typeof raw.name === 'string' ? raw.name : id
    if (!id) continue
    const category =
      'category' in raw && typeof raw.category === 'string'
        ? (raw.category as AcpConfigOptionCategory)
        : undefined

    const hasBooleanType = 'type' in raw && raw.type === 'boolean'
    const hasBooleanValue = 'currentValue' in raw && typeof raw.currentValue === 'boolean'
    if (hasBooleanType || hasBooleanValue) {
      result.push({
        type: 'boolean',
        id,
        name,
        category,
        currentValue: 'currentValue' in raw ? Boolean(raw.currentValue) : false
      })
      continue
    }

    // select (default)
    let currentValue = ''
    if ('currentValue' in raw) {
      if (typeof raw.currentValue === 'string') currentValue = raw.currentValue
      else if (typeof raw.currentValue === 'number') currentValue = String(raw.currentValue)
    }
    const rawOptions = 'options' in raw ? raw.options : []
    const options = normalizeSelectOptions(rawOptions)
    if (!options.length) continue
    result.push({
      type: 'select',
      id,
      name,
      category,
      currentValue: currentValue || firstSelectValue(options) || '',
      options
    })
  }
  return result
}

export function parseSessionMeta(response: Record<string, unknown> | null | undefined): SessionMeta {
  if (!response || typeof response !== 'object') {
    return { modes: null, models: null, configOptions: [] }
  }
  return {
    modes: parseSessionModes(response.modes),
    models: parseSessionModels(response.models),
    configOptions: parseConfigOptions(response.configOptions)
  }
}

export class AcpAgentConnection {
  private readonly provider: AcpProvider
  private readonly launchOverrides?: Partial<Record<AcpProvider, Partial<AcpAgentLaunchConfig>>>
  private readonly projectPath?: string
  private process?: ChildProcessWithoutNullStreams
  private connection?: ClientConnection
  private initialized = false
  private agentCapabilities?: AgentCapabilities
  private stderrBuffer = ''

  constructor(
    provider: AcpProvider,
    launchOverrides?: Partial<Record<AcpProvider, Partial<AcpAgentLaunchConfig>>>,
    projectPath?: string
  ) {
    this.provider = provider
    this.launchOverrides = launchOverrides
    this.projectPath = projectPath
  }

  async connect(): Promise<ClientContext> {
    if (this.connection && this.initialized) {
      return this.connection.agent
    }

    const acp = await getAcpSdk()
    const launch = resolveAcpLaunchConfig(this.provider, this.launchOverrides)
    const spawnSpec = resolveSpawnCommand(launch.command, process.env, launch.env)
    const command = spawnSpec.command
    const env = spawnSpec.env
    const args = [...launch.args]

    if (!spawnSpec.resolved && !path.isAbsolute(command) && !command.includes(path.sep)) {
      throw new Error(
        `未找到命令: "${launch.command}"。请确保系统已安装 Node.js (支持 npx)，或在设置页配置 ${this.provider} 的绝对路径。`
      )
    }

    const useShell = process.platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat'))
    this.stderrBuffer = ''
    this.process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: useShell
    })

    let handshakeComplete = false
    let exitCode: number | null = null
    let exitSignal: NodeJS.Signals | null = null
    let spawnError: Error | undefined

    const processExit = new Promise<void>((resolve) => {
      this.process?.on('exit', (code, signal) => {
        exitCode = code
        exitSignal = signal
        this.initialized = false
        resolve()
      })
    })

    this.process.on('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      console.error(`[ACP ${this.provider}] spawn error`, spawnError)
    })

    this.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.stderrBuffer = (this.stderrBuffer + text).slice(-STDERR_BUFFER_LIMIT)
      console.error(`[ACP ${this.provider}]`, text)
    })

    const input = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>
    const output = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>
    const stream = acp.ndJsonStream(input, output)
    const app = await createAcpClientApp()
    this.connection = app.connect(stream)

    let handshakeTimer: NodeJS.Timeout | undefined
    try {
      const initResponse = await Promise.race([
        this.connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true
          }
        }),
        new Promise<never>((_, reject) => {
          handshakeTimer = setTimeout(() => {
            reject(
              new Error(
                `ACP 握手超时 (${Math.round(ACP_HANDSHAKE_TIMEOUT_MS / 1000)}s) ` +
                  `(执行命令: ${command} ${launch.args.join(' ')}). 请检查 Agent CLI 是否支持 ACP stdio。`
              )
            )
          }, ACP_HANDSHAKE_TIMEOUT_MS)
        })
      ])
      this.agentCapabilities = initResponse.agentCapabilities
      handshakeComplete = true
    } catch (error) {
      this.dispose()
      if (spawnError) {
        throw this.wrapConnectError(spawnError, handshakeComplete, exitCode, exitSignal)
      }
      const exited = exitCode != null || exitSignal != null
      if (exited) {
        throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal)
      }
      await Promise.race([processExit, new Promise<void>((r) => setTimeout(r, 500))])
      throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal)
    } finally {
      clearTimeout(handshakeTimer)
    }

    this.initialized = true
    return this.connection.agent
  }

  private wrapConnectError(
    error: unknown,
    handshakeComplete: boolean,
    exitCode: number | null,
    exitSignal: NodeJS.Signals | null
  ): Error {
    const baseMessage = formatAcpError(error)
    const details: string[] = []
    if (!handshakeComplete) {
      details.push(`${this.provider} agent 在完成 ACP 握手前退出`)
      if (exitSignal) details.push(`信号: ${exitSignal}`)
      else if (exitCode != null) details.push(`退出码: ${exitCode}`)
    }
    const stderr = this.stderrBuffer.trim()
    if (stderr) details.push(stderr)
    if (!details.length) {
      return new Error(baseMessage)
    }
    return new Error(`${baseMessage}: ${details.join(' — ')}`)
  }

  async startSession(projectPath: string): Promise<StartSessionResult> {
    const agent = await this.connect()
    const cwd = path.resolve(projectPath)
    const response = await agent.buildSession({ cwd, mcpServers: [] }).start()
    const raw = (response.newSessionResponse || {}) as Record<string, unknown>
    const meta = parseSessionMeta(raw)
    return {
      sessionId: response.sessionId,
      ...meta,
      raw
    }
  }

  async restoreSession(acpSessionId: string, projectPath: string): Promise<RestoreSessionResult> {
    const agent = await this.connect()
    const acp = await getAcpSdk()
    const cwd = path.resolve(projectPath)
    const params = { sessionId: acpSessionId, cwd, mcpServers: [] }

    const restoreMethods: Array<'load' | 'resume'> = []
    if (this.agentCapabilities?.loadSession) restoreMethods.push('load')
    const resume = this.agentCapabilities?.sessionCapabilities?.resume
    if (resume != null && typeof resume === 'object') restoreMethods.push('resume')

    for (const method of restoreMethods) {
      try {
        const response = await agent.request(
          method === 'load' ? acp.methods.agent.session.load : acp.methods.agent.session.resume,
          params
        )
        const raw = (response || {}) as Record<string, unknown>
        return {
          sessionId: acpSessionId,
          ...parseSessionMeta(raw),
          method,
          raw
        }
      } catch (error) {
        console.warn(
          `[ACP ${this.provider}] session/${method} failed for ${acpSessionId}: ${formatAcpError(error)}`
        )
      }
    }

    const response = await agent.buildSession({ cwd, mcpServers: [] }).start()
    const raw = (response.newSessionResponse || {}) as Record<string, unknown>
    return {
      sessionId: response.sessionId,
      ...parseSessionMeta(raw),
      method: 'new',
      raw
    }
  }

  supportsImageUpload(): boolean {
    return this.agentCapabilities?.promptCapabilities?.image === true
  }

  supportsEmbeddedContext(): boolean {
    return this.agentCapabilities?.promptCapabilities?.embeddedContext === true
  }

  isLive(): boolean {
    if (!this.connection || !this.initialized || !this.process) return false
    if (this.process.killed) return false
    if (this.process.exitCode != null) return false
    return true
  }

  async setMode(acpSessionId: string, modeId: string): Promise<void> {
    const agent = await this.connect()
    const acp = await getAcpSdk()
    await agent.request(acp.methods.agent.session.setMode, {
      sessionId: acpSessionId,
      modeId
    })
  }

  async setConfigOption(
    acpSessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigOption[]> {
    const agent = await this.connect()
    const acp = await getAcpSdk()
    const response = await agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: acpSessionId,
      configId,
      value
    } as never)
    const options =
      response && typeof response === 'object' && 'configOptions' in response
        ? response.configOptions
        : undefined
    return parseConfigOptions(options)
  }

  async prompt(acpSessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason: string }> {
    if (!blocks.length) throw new Error('Prompt 必须至少包含一个内容块。')
    const hasImage = blocks.some((block) => block.type === 'image')
    if (hasImage && !this.supportsImageUpload()) {
      throw new Error(`${this.provider} 不支持原生图片上传。`)
    }
    const hasEmbedded = blocks.some((block) => block.type === 'resource')
    if (hasEmbedded && !this.supportsEmbeddedContext()) {
      throw new Error(`${this.provider} 不支持内嵌资源上下文。`)
    }
    const agent = await this.connect()
    const acp = await getAcpSdk()
    return agent.request(acp.methods.agent.session.prompt, {
      sessionId: acpSessionId,
      prompt: blocks
    })
  }

  async cancel(acpSessionId: string): Promise<void> {
    const agent = await this.connect()
    const acp = await getAcpSdk()
    await agent.notify(acp.methods.agent.session.cancel, { sessionId: acpSessionId })
  }

  dispose(): void {
    if (this.connection) {
      try {
        this.connection.close()
      } catch {
        // ignore
      }
      this.connection = undefined
    }
    if (this.process) {
      try {
        this.process.kill()
      } catch {
        // ignore
      }
      this.process = undefined
    }
    this.initialized = false
    this.agentCapabilities = undefined
  }
}
