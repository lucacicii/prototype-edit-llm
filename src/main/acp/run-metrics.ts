import { estimateTokenCount } from '../../shared/tokenEstimate'

/**
 * ACP 一次 run 的实时指标，输出成与 thunder `MetricsSnapshot` 同形状的快照。
 *
 * 为什么要自己算：thunder 由 daemon 侧的 `MetricsPlugin` 下发 `metrics_update`，
 * 渲染层只负责显示；Claude Code / Codex 走 ACP 时没有任何人下发这种东西 ——
 * 协议只给两件事：`usage_update`（上下文用了多少 `used` / 窗口多大 `size`）和
 * token 增量本身。所以「本轮多少 token、多快」只能在主进程按同一套口径估出来，
 * 再用**同一个快照形状**发给渲染层：面板那边不需要知道数据来自哪个引擎。
 *
 * 口径对齐 thunder（也是 agent-resume-panel 的算法）：
 * - token 数 = 本轮正文 + 思考的估算值（`estimateTokenCount`，与内核同源）；
 * - 速率的分母是**生成时长**，不是从发出消息算起的墙钟：工具执行期间不计时，
 *   否则一次长 `grep` 就能把 20 tok/s 摊成 2 tok/s。
 *
 * 一个实例对应一次 prompt（ACP 一次 run 就是一次 prompt）。
 */
export interface AcpMetricsSnapshot {
  session_id?: string
  model?: string
  thinking_level?: string
  is_running: boolean
  turn: number
  /** 本轮生成速率（token / 生成秒）。 */
  live_tps: number
  /** run 结束时给出整 run 的平均速率（与 live_tps 同口径）。 */
  avg_tps?: number
  live_tokens: number
  live_reasoning_tokens: number
  /**
   * 本轮生成量。thunder 的 `total_tokens` 是 prompt+completion，ACP 只拿得到
   * 生成的那半边（提示词用了多少 token 协议不回），所以这里两者同值。
   */
  completion_tokens: number
  reasoning_tokens: number
  total_tokens: number
  context_tokens: number
  context_window_limit?: number
  session_total_tokens: number
  /** 生成时长（毫秒），不含工具执行。 */
  generation_duration_ms: number
  tool_duration_ms?: number
  wall_duration_ms?: number
  duration_ms?: number
}

/** ACP 的 `usage_update` 里与本面板相关的部分。 */
export interface AcpUsageSample {
  /** 当前上下文里的 token 数。 */
  used: number
  /** 上下文窗口上限。 */
  size: number
}

export class AcpRunMetrics {
  private readonly startedAt = Date.now()
  /** 正文 / 思考文本缓冲：估算按整段算，逐 delta 累加会越数越多。 */
  private textBuf = ''
  private reasoningBuf = ''
  /** 第一次拿到 token 的时刻；没有它就没有可用的速率分母。 */
  private firstTokenAt: number | null = null
  /** 正在跑的工具：id → 开始时刻。 */
  private readonly runningTools = new Map<string, number>()
  private settledToolMs = 0
  private usage: AcpUsageSample | null = null

  /** @param sessionTokensBefore 本次 run 之前该会话已累计的 token（由调用方按 sessionKey 记账）。 */
  constructor(private readonly sessionTokensBefore = 0) {}

  noteText(delta: string): void {
    if (!delta) return
    if (this.firstTokenAt === null) this.firstTokenAt = Date.now()
    this.textBuf += delta
  }

  noteReasoning(delta: string): void {
    if (!delta) return
    if (this.firstTokenAt === null) this.firstTokenAt = Date.now()
    this.reasoningBuf += delta
  }

  /** ACP 的 `usage_update`：上下文占用与窗口上限（协议唯一的权威 token 数字）。 */
  noteUsage(sample: AcpUsageSample): void {
    if (sample.used > 0 || sample.size > 0) this.usage = sample
  }

  noteToolStart(toolCallId: string): void {
    if (!this.runningTools.has(toolCallId)) this.runningTools.set(toolCallId, Date.now())
  }

  noteToolEnd(toolCallId: string): void {
    const startedAt = this.runningTools.get(toolCallId)
    if (startedAt === undefined) return
    this.settledToolMs += this.overlapMs(startedAt, Date.now())
    this.runningTools.delete(toolCallId)
  }

  /**
   * 只算落在生成窗口（第一个 token 之后）里的那段。
   * 开聊前的工具（比如先读一遍仓库）不属于分母，全算上会把速率压成 0。
   */
  private overlapMs(from: number, to: number): number {
    if (this.firstTokenAt === null) return 0
    return Math.max(0, to - Math.max(from, this.firstTokenAt))
  }

  private toolMsAt(now: number): number {
    let total = this.settledToolMs
    for (const startedAt of this.runningTools.values()) total += this.overlapMs(startedAt, now)
    return total
  }

  /**
   * 生成时长：从第一个 token 到此刻，扣掉工具占用的那段。
   * 还没有 token 时说 0 —— 宁可速率显示 0，也不拿整段墙钟当分母。
   */
  private generationMsAt(now: number): number {
    if (this.firstTokenAt === null) return 0
    return Math.max(0, now - this.firstTokenAt - this.toolMsAt(now))
  }

  /**
   * 拍一张快照。`isRunning: false` 时额外给出整 run 的口径
   * （`avg_tps` / `wall_duration_ms`），与 thunder 的字段一一对应。
   */
  snapshot(opts: {
    turn: number
    isRunning: boolean
    sessionId?: string
    model?: string
    thinkingLevel?: string
  }): AcpMetricsSnapshot {
    const now = Date.now()
    const textTokens = estimateTokenCount(this.textBuf)
    const reasoningTokens = estimateTokenCount(this.reasoningBuf)
    const tokens = textTokens + reasoningTokens
    const toolMs = this.toolMsAt(now)
    const wallMs = Math.max(0, now - this.startedAt)
    const generationMs = this.generationMsAt(now)
    const tps = tokens > 0 && generationMs >= 200 ? tokens / (generationMs / 1000) : 0

    return {
      session_id: opts.sessionId,
      model: opts.model,
      thinking_level: opts.thinkingLevel,
      is_running: opts.isRunning,
      turn: opts.turn,
      live_tps: tps,
      ...(opts.isRunning ? {} : { avg_tps: tps }),
      live_tokens: tokens,
      live_reasoning_tokens: reasoningTokens,
      completion_tokens: tokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: tokens,
      context_tokens: this.usage?.used ?? 0,
      ...(this.usage?.size ? { context_window_limit: this.usage.size } : {}),
      session_total_tokens: this.sessionTokensBefore + tokens,
      generation_duration_ms: generationMs,
      ...(toolMs > 0 ? { tool_duration_ms: toolMs } : {}),
      wall_duration_ms: wallMs
    }
  }
}
