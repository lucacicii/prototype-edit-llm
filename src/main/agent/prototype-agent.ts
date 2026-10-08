/**
 * The prototype app's agent session.
 *
 * It owns everything the runtime deliberately does not: the model choice, the
 * business tools, the conversation history, and the "did the page still render?"
 * check. The runtime only streams and asks.
 */

import {
  RuntimeClient,
  RuntimeFrame,
  RuntimeMessage,
  RuntimeModel,
  RuntimeToolSpec
} from './runtime-client'
import { PROTOTYPE_AGENT_SYSTEM_PROMPT } from './agent-prompt'
import { AgentConfigFile } from './model-config'

export interface DiagnosticSnapshot {
  hasErrors: boolean
  errorCount: number
  summary: string
  errors: { text: string }[]
}

export interface PrototypeAgentDeps {
  client: RuntimeClient
  workspaceDir: string
  /** Current prototype source, as the editor holds it. */
  getCode: () => string
  /** Persist an edit and push it into the editor. */
  applyEdit: (code: string) => Promise<void>
  /** Runtime errors collected from the embedded browser over CDP. */
  getDiagnostics: () => DiagnosticSnapshot
  /** The element the user圈选'd, when the request came from a selection. */
  getInspectTarget: () => { tagName: string; text: string } | undefined
  /** Forward every loop frame to the renderer for live display. */
  onFrame: (frame: RuntimeFrame) => void
  /** How long to let HMR settle before asking the browser for diagnostics. */
  settleMs?: number
}

export interface RunRequest {
  runId: string
  prompt: string
  history: RuntimeMessage[]
  model: RuntimeModel
  config: AgentConfigFile
}

export interface RunOutcome {
  finishReason: string
  finalContent: string | null
  /** Full transcript, for the app to persist as the new history. */
  messages: RuntimeMessage[]
  /** The code after the run, in case a tool edited it. */
  code: string
  gateRounds: number
}

const TOOLS: RuntimeToolSpec[] = [
  {
    name: 'read_prototype',
    description: '读取当前原型的完整 .vue 源码。修改前必须先读。',
    parameters: { type: 'object', properties: {} },
    effect: 'read'
  },
  {
    name: 'get_runtime_diagnostics',
    description: '获取内置浏览器当前的运行期报错（控制台错误、未捕获异常）。',
    parameters: { type: 'object', properties: {} },
    effect: 'read'
  },
  {
    name: 'get_inspect_target',
    description: '获取用户在页面上圈选的元素（标签名、文本内容）及批注。',
    parameters: { type: 'object', properties: {} },
    effect: 'read'
  },
  {
    name: 'apply_prototype_edit',
    description:
      '用新的完整 .vue 源码替换当前原型。必须传入完整文件内容，组件结构保持完整。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '完整的 .vue 文件内容' }
      },
      required: ['code']
    },
    effect: 'write'
  }
]

export class PrototypeAgent {
  private readonly deps: PrototypeAgentDeps
  private readonly active = new Map<string, { resolve: (o: RunOutcome) => void; reject: (e: Error) => void }>()
  private readonly gateRounds = new Map<string, number>()

  constructor(deps: PrototypeAgentDeps) {
    this.deps = deps
    this.deps.client.on('frame', (frame: RuntimeFrame) => void this.onFrame(frame))
  }

  /** Tool catalog, so a host can show what the agent may do. */
  public get toolSpecs(): RuntimeToolSpec[] {
    return TOOLS
  }

  public async run(request: RunRequest): Promise<RunOutcome> {
    const { client } = this.deps
    if (!client.isRunning) client.start()

    const messages: RuntimeMessage[] = [
      ...request.history,
      { role: 'user', content: request.prompt }
    ]

    const outcome = new Promise<RunOutcome>((resolve, reject) => {
      this.active.set(request.runId, { resolve, reject })
    })
    this.gateRounds.set(request.runId, 0)

    await client.startRun({
      runId: request.runId,
      model: request.model,
      systemPrompt: request.config.systemPrompt ?? PROTOTYPE_AGENT_SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTurns: request.config.maxTurns,
      temperature: request.config.temperature,
      thinkingLevel: request.config.thinkingLevel,
      requestTimeoutMs: request.config.requestTimeoutMs,
      sessionId: request.runId,
      // Every finish is verified against the live page.
      gate: { maxRounds: 3 }
    })

    return outcome
  }

  public cancel(runId: string): void {
    this.deps.client.cancel(runId)
  }

  private async onFrame(frame: RuntimeFrame): Promise<void> {
    this.deps.onFrame(frame)

    switch (frame.type) {
      case 'tool_call':
        await this.handleToolCall(frame)
        return
      case 'gate_request':
        await this.handleGate(frame.run_id, frame.final_text)
        return
      case 'run_finished': {
        const settle = this.active.get(frame.run_id)
        const gateRounds = this.gateRounds.get(frame.run_id) ?? 0
        this.active.delete(frame.run_id)
        this.gateRounds.delete(frame.run_id)
        settle?.resolve({
          finishReason: frame.finish_reason,
          finalContent: frame.final_content ?? null,
          messages: frame.messages,
          code: this.deps.getCode(),
          gateRounds
        })
        return
      }
      case 'error': {
        const runId = frame.run_id
        if (!runId) return
        const settle = this.active.get(runId)
        this.active.delete(runId)
        this.gateRounds.delete(runId)
        settle?.reject(new Error(frame.message))
        return
      }
      default:
        return
    }
  }

  private async handleToolCall(frame: Extract<RuntimeFrame, { type: 'tool_call' }>): Promise<void> {
    const { run_id: runId, call_id: callId, name, arguments: args } = frame
    try {
      const output = await this.executeTool(name, args)
      this.deps.client.sendToolResult(runId, callId, true, output)
    } catch (err: any) {
      // A failed tool is information, not a crash: the model gets the message
      // and decides what to do about it.
      this.deps.client.sendToolResult(runId, callId, false, err?.message ?? String(err))
    }
  }

  private async executeTool(name: string, args: Record<string, any>): Promise<string> {
    switch (name) {
      case 'read_prototype':
        return this.deps.getCode()
      case 'get_runtime_diagnostics': {
        const diag = this.deps.getDiagnostics()
        if (!diag.hasErrors) return '当前页面运行正常，没有捕获到运行期报错。'
        const lines = diag.errors.slice(0, 10).map((e) => `- ${e.text}`)
        return `${diag.errorCount} 项运行期报错：\n${lines.join('\n')}`
      }
      case 'get_inspect_target': {
        const target = this.deps.getInspectTarget()
        if (!target) return '用户当前没有圈选任何元素。'
        return `用户圈选：<${target.tagName}> ${target.text}`
      }
      case 'apply_prototype_edit': {
        const code = typeof args.code === 'string' ? args.code : ''
        if (!code.includes('<template')) {
          throw new Error('apply_prototype_edit 需要完整的 .vue 文件内容（包含 <template>）')
        }
        await this.deps.applyEdit(code)
        return '已写入原型文件，Vite 已热更新。'
      }
      default:
        throw new Error(`未知工具：${name}`)
    }
  }

  /**
   * The completion gate: let the page settle, then ask the browser whether the
   * edit actually held up. A run that left errors in the console is not done.
   */
  private async handleGate(runId: string, _finalText: string): Promise<void> {
    const round = (this.gateRounds.get(runId) ?? 0) + 1
    this.gateRounds.set(runId, round)

    await delay(this.deps.settleMs ?? 900)
    const diag = this.deps.getDiagnostics()

    if (!diag.hasErrors) {
      this.deps.client.sendGateResult(runId, 'pass')
      return
    }

    const lines = diag.errors.slice(0, 10).map((e) => `- ${e.text}`)
    this.deps.client.sendGateResult(
      runId,
      'retry',
      `页面仍有 ${diag.errorCount} 项运行期报错，请修复后再结束：\n${lines.join('\n')}`
    )
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
