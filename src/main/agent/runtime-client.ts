/**
 * Client for `thunder-runtime` — the generic agent core over stdio NDJSON.
 *
 * This is deliberately *not* the thunder daemon: the runtime holds no session
 * store and no product plugins. It streams the model, asks us to run tools, and
 * asks us to verify the result. Model configuration and conversation history
 * belong to this app.
 */

import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { isPackaged } from '../app-paths'

/** pi-ai model descriptor; the runtime forwards it to the pi bridge verbatim. */
export interface RuntimeModel {
  provider: string
  id: string
  name: string
  api: string
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  /** pi `thinkingLevelMap`: level → provider-native level (null = unsupported). */
  thinkingLevelMap?: Record<string, string | null>
  /** pi `Model.cost` passthrough (per-million pricing). */
  cost?: Record<string, unknown>
  /** pi `Model.promptCache` passthrough (seconds per retention tier). */
  promptCache?: Record<string, unknown>
}

export interface RuntimeToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** `read` | `write` | `exec`; omitted means "unclassified" (treated as a mutation). */
  effect?: string
}

/** thunder 的多模态 part（Rust `ContentPart`，message.rs:52-74）。 */
export type RuntimeContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      /** key 必须是 camelCase —— Rust 侧是 `#[serde(rename = "mimeType")]`。 */
      mimeType: string
      /** base64，**不含** `data:` 前缀（runtime 直接当字节用，带了前缀就是坏图）。 */
      data: string
      name?: string
      path?: string
      sha256?: string
    }

export type RuntimeMessage =
  | { role: 'system'; content: string }
  // 纯文本消息不带 parts（协议侧 skip_serializing_if），形状与历史逐字节一致
  | { role: 'user'; content: string; parts?: RuntimeContentPart[] }
  | { role: 'assistant'; content: string | null }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface RuntimeRunRequest {
  runId: string
  model: RuntimeModel
  systemPrompt?: string
  messages: RuntimeMessage[]
  tools: RuntimeToolSpec[]
  maxTurns?: number
  temperature?: number
  thinkingLevel?: string
  requestTimeoutMs?: number
  sessionId?: string
  gate?: { maxRounds: number }
}

/** Frames the runtime sends us. `type` is the discriminator. */
export type RuntimeFrame =
  | { type: 'response'; id?: string; ok: boolean; version?: string; error?: string }
  | { type: 'observation'; run_id: string; event: Record<string, any> }
  | {
      type: 'tool_call'
      run_id: string
      call_id: string
      name: string
      arguments: Record<string, any>
    }
  | { type: 'gate_request'; run_id: string; round: number; final_text: string }
  | {
      type: 'run_finished'
      run_id: string
      finish_reason: string
      final_content?: string | null
      messages: RuntimeMessage[]
      stats: Record<string, any>
    }
  | { type: 'error'; run_id?: string; message: string }

export interface RuntimeClientOptions {
  /** Path to the `thunder-runtime` binary; auto-detected when omitted. */
  binaryPath?: string
}

interface Pending {
  resolve: (frame: RuntimeFrame) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class RuntimeClient extends EventEmitter {
  private process: ChildProcess | null = null
  private reader: readline.Interface | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private readonly options: RuntimeClientOptions

  constructor(options: RuntimeClientOptions = {}) {
    super()
    this.options = options
  }

  public start(): void {
    if (this.process) return

    const binary = this.options.binaryPath || resolveRuntimeBinary()
    this.process = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] })
    this.reader = readline.createInterface({ input: this.process.stdout!, crlfDelay: Infinity })
    this.reader.on('line', (line) => this.onLine(line))

    this.process.on('exit', (code) => {
      this.failAll(new Error(`thunder-runtime exited with code ${code}`))
      this.emit('exit', code)
    })
    // A missing binary surfaces here (not on `exit`); fail fast so a ping does
    // not sit on a 15s timeout.
    this.process.on('error', (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)))
      this.emit('error', err)
    })
  }

  public stop(): void {
    this.process?.kill()
    this.process = null
    this.reader = null
  }

  public get isRunning(): boolean {
    return this.process !== null
  }

  /** Send a request that has a direct reply, and wait for it. */
  public request(method: string, payload: Record<string, any>, timeoutMs = 15_000): Promise<RuntimeFrame> {
    const id = `req_${++this.seq}`
    return new Promise<RuntimeFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`thunder-runtime did not answer \`${method}\` within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ method, id, ...payload })
    })
  }

  public async ping(timeoutMs = 5_000): Promise<string> {
    const frame = await this.request('ping', {}, timeoutMs)
    if (frame.type === 'response' && frame.ok) return frame.version ?? 'unknown'
    throw new Error(frame.type === 'response' ? frame.error ?? 'ping failed' : 'unexpected reply')
  }

  /** Begin a run. Events arrive on `observation`, `tool_call`, `gate_request`. */
  public startRun(req: RuntimeRunRequest): Promise<void> {
    const payload: Record<string, any> = {
      run_id: req.runId,
      model: req.model,
      messages: req.messages,
      tools: req.tools
    }
    if (req.systemPrompt !== undefined) payload.system_prompt = req.systemPrompt
    if (req.maxTurns !== undefined) payload.max_turns = req.maxTurns
    if (req.temperature !== undefined) payload.temperature = req.temperature
    if (req.thinkingLevel !== undefined) payload.thinking_level = req.thinkingLevel
    if (req.requestTimeoutMs !== undefined) payload.request_timeout_ms = req.requestTimeoutMs
    if (req.sessionId !== undefined) payload.session_id = req.sessionId
    if (req.gate !== undefined) {
      payload.gate = {
        max_rounds: req.gate.maxRounds
      }
    }
    return this.request('start', payload).then((frame) => {
      if (frame.type === 'response' && !frame.ok) {
        throw new Error(frame.error ?? 'run could not be started')
      }
    })
  }

  public sendToolResult(runId: string, callId: string, ok: boolean, output: string): void {
    this.write({ method: 'tool_result', run_id: runId, call_id: callId, ok, output })
  }

  public sendGateResult(
    runId: string,
    verdict: 'pass' | 'retry' | 'fail',
    feedback?: string
  ): void {
    this.write({ method: 'gate_result', run_id: runId, verdict, feedback })
  }

  public cancel(runId: string): void {
    this.write({ method: 'cancel', run_id: runId })
  }

  /** Tear down the child and reject everything waiting on it. */
  private failAll(err: Error): void {
    this.process?.stdin?.end()
    this.process?.removeAllListeners()
    this.process = null
    this.reader = null
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private write(payload: Record<string, any>): void {
    if (!this.process?.stdin) {
      throw new Error('thunder-runtime is not running')
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let frame: RuntimeFrame
    try {
      frame = JSON.parse(trimmed)
    } catch {
      this.emit('protocol-error', trimmed)
      return
    }

    this.emit('frame', frame)
    this.emit(frame.type, frame)

    if (frame.type === 'response') {
      const id = (frame as any).id as string | undefined
      if (id && this.pending.has(id)) {
        const p = this.pending.get(id)!
        clearTimeout(p.timer)
        this.pending.delete(id)
        p.resolve(frame)
      }
    } else if (frame.type === 'error') {
      const id = (frame as any).id as string | undefined
      if (id && this.pending.has(id)) {
        const p = this.pending.get(id)!
        clearTimeout(p.timer)
        this.pending.delete(id)
        p.reject(new Error(frame.message))
      } else if (this.pending.size === 1) {
        for (const [, p] of this.pending) {
          clearTimeout(p.timer)
          p.reject(new Error(frame.message))
        }
        this.pending.clear()
      }
    }
  }
}

/**
 * Where the runtime binary lives. Release builds ship it beside the app's other
 * sidecars; a dev checkout builds it in the thunder workspace.
 */
export function resolveRuntimeBinary(): string {
  const name = process.platform === 'win32' ? 'thunder-runtime.exe' : 'thunder-runtime'
  if (process.env.THUNDER_RUNTIME_BIN && fs.existsSync(process.env.THUNDER_RUNTIME_BIN)) {
    return process.env.THUNDER_RUNTIME_BIN
  }

  const resourcesPath = (process as any).resourcesPath as string | undefined
  if (isPackaged() && resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'bin', name)
    if (fs.existsSync(packagedPath)) {
      return packagedPath
    }
  }

  const thunderRepo = process.env.THUNDER_REPO || '/Users/lucas/wz/GitHub/thunder'
  const candidates = [
    path.join(thunderRepo, 'target', 'debug', name),
    path.join(thunderRepo, 'target', 'release', name),
    path.resolve(process.cwd(), '../thunder/target/debug', name),
    path.resolve(process.cwd(), '../thunder/target/release', name),
    ...(resourcesPath ? [path.join(resourcesPath, 'bin', name)] : [])
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(thunderRepo, 'target', 'debug', name)
}
