/**
 * Agent 聊天流的核心状态 Hook（移植自 agent-resume-panel 的 useThunderChat）。
 *
 * 职责：把 `agent:stream-event` 的原始事件流重写成 **LiveSegment 时序模型**
 * —— 思考、工具、正文按真实发生顺序交错，而不是各自归并成三条泳道。
 * 同时聚合指标（tok/s、缓存、上下文、耗时）、维护 `ask_user_question`
 * 的问题卡与 steer/follow_up 插话队列。
 *
 * 提示词的组装（圈选/圈改指令、#文件引用）不属于这里：调用方负责拼好
 * prompt 再 `startRun`。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEngine, AcpPermissionRequestPayload } from '../../../../main/acp/types'


export interface ActiveToolInfo {
  toolCallId: string
  name: string
  arguments: Record<string, any>
  result?: unknown
  isRunning?: boolean
  isError?: boolean
}

/** 一段按时间顺序发生的运行切片：思考 / 正文 / 一批工具。 */
export type LiveSegment =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tools'; tools: ActiveToolInfo[] }

/**
 * 一次 run 里的一轮（turn）。
 *
 * thunder 的每个 observation 事件都带 `turn`，所以轮次可以就地切分：换轮时
 * 换一条新的 segments 数组，上一轮整体冻住。界面上这些轮由一排圆点索引 ——
 * 主体区只直播当前轮，跑完的轮折叠回圆点，点开可回看该轮全部思考与工具。
 *
 * 只活在内存里（不做持久化）：下一次 run 开始时清空。
 */
export interface LiveTurn {
  turn: number
  /** 该轮的时序切片；正在跑时这个数组就是实时 segments。 */
  segments: LiveSegment[]
  status: 'running' | 'done' | 'error'
  toolCount: number
  /** 相对 run 起点的毫秒偏移，用于给正在跑的那一轮做实时计时。 */
  startedAtOffset: number
  durationMs?: number
  promptTokens?: number
  completionTokens?: number
  finishReason?: string
}

export interface ChatRunMetrics {
  tps?: number
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  durationMs?: number
}

/**
 * thunder `MetricsPlugin` 推送的权威遥测快照（`metrics_update` 自定义事件的 payload）。
 *
 * 0.4 起 daemon 在每条与指标相关的事件后随流下发它；字段名与 thunder 的
 * `MetricsSnapshot` 一致。旧版 daemon 不发，此时退回本地估算。
 */
export interface AgentMetricsSnapshot {
  session_id?: string
  task_id?: string
  model?: string
  thinking_level?: string
  is_running: boolean
  turn: number
  live_tps: number
  avg_tps?: number
  live_tokens: number
  live_reasoning_tokens: number
  prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  total_tokens?: number
  cached_tokens: number
  cache_write_tokens?: number
  cache_hit_percent?: number
  context_tokens: number
  context_window_limit?: number
  context_usage_percent?: number
  session_total_tokens: number
  generation_duration_ms: number
  tool_duration_ms: number
  duration_ms?: number
  wall_duration_ms?: number
}

export type ThunderAgentPhase =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool'
  | 'awaiting_user'
  | 'paused'
  | 'compacting'
  | 'done'
  | 'error'

export interface ThunderAgentStatus {
  session_id: string
  phase: ThunderAgentPhase
  tool?: string
  turn: number
  detail?: string
  started_at_ms: number
  seq: number
}

/**
 * 快速 token 估算，与 thunder 内核 `core::token_estimator` 同一口径：
 * CJK/假名/谚文约 1.5 token/字，ASCII（空白半权）约 3.7 字符/token，标点 +0.2。
 *
 * 只用于**降级路径**——没收到 `metrics_update`（旧版 daemon）时的流式计数。
 * 权威数值一律以快照为准。
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let space = 0
  let punct = 0
  let total = 0
  for (const ch of text) {
    total += 1
    const u = ch.codePointAt(0) ?? 0
    if (
      (u >= 0x4e00 && u <= 0x9fff) ||
      (u >= 0x3400 && u <= 0x4dbf) ||
      (u >= 0x3040 && u <= 0x30ff) ||
      (u >= 0xac00 && u <= 0xd7af)
    ) {
      cjk += 1
    } else if (u === 0x20 || u === 0x09 || u === 0x0a || u === 0x0d) {
      space += 1
    } else if (
      (u >= 0x21 && u <= 0x2f) ||
      (u >= 0x3a && u <= 0x40) ||
      (u >= 0x5b && u <= 0x60) ||
      (u >= 0x7b && u <= 0x7e) ||
      (u >= 0x3000 && u <= 0x303f) ||
      (u >= 0xff00 && u <= 0xffef)
    ) {
      punct += 1
    } else if (/\s/.test(ch)) {
      space += 1
    }
  }
  const ascii = Math.max(0, total - cjk)
  const effAscii = Math.max(0, ascii - Math.floor(space / 2))
  return Math.max(1, Math.ceil((cjk * 15) / 10) + Math.ceil((effAscii * 10) / 37) + Math.ceil((punct * 2) / 10))
}

/** 快照 → 本轮指标（面板的 `ChatRunMetrics`）。 */
function metricsFromSnapshot(snap: AgentMetricsSnapshot): ChatRunMetrics {
  return {
    tps: snap.avg_tps ?? (snap.live_tps > 0 ? snap.live_tps : undefined),
    promptTokens: snap.prompt_tokens,
    completionTokens: snap.completion_tokens,
    cachedTokens: snap.cached_tokens,
    reasoningTokens: snap.reasoning_tokens,
    totalTokens: snap.total_tokens,
    durationMs: snap.wall_duration_ms ?? snap.duration_ms
  }
}

export interface PendingQuestion {
  questionId: string
  taskId: string
  questions: Array<{
    question: string
    header?: string
    multi_select?: boolean
    multiSelect?: boolean
    options: Array<{ label: string; description?: string }>
  }>
}

export interface StartRunParams {
  runId: string
  prototypeId: string
  engine?: AgentEngine
  prompt: string
  code: string
  history?: Array<{ role: string; content: string | null }>
  inspectTarget?: unknown
  markupTargets?: unknown[]
  attachments?: Array<{ name: string; mimeType: string; data: string }>
}

export interface RunOutcome {
  ok: boolean
  error?: string
  finishReason?: string
  finalContent?: string | null
  /** 失败/中断前已经流出的正文，供调用方在报错时一并展示。 */
  partialContent?: string
  code?: string
  techStack?: string
}

interface UseAgentChatStreamOptions {
  /** 模型上下文窗口，用于占用百分比。 */
  contextWindowLimit?: number
  /** 主进程推送 agent:code-updated 时回调（实时刷新预览）。 */
  onCodeUpdated?: (
    code: string,
    techStack?: string,
    previewUrl?: string,
    entryFile?: string,
    /** 这次 run 所属的原型（run 期间用户可能已切到别的项目）。 */
    prototypeId?: string
  ) => void
}

/** 把 delta 追加到尾部同类切片，或开一个新切片。 */
function appendDelta(segments: LiveSegment[], kind: 'reasoning' | 'text', delta: string): void {
  const last = segments[segments.length - 1]
  if (last && last.kind === kind) {
    last.text += delta
    return
  }
  segments.push({ kind, text: delta })
}

/** 把工具加进尾部工具切片，或开一个新切片。 */
function appendTool(segments: LiveSegment[], tool: ActiveToolInfo): void {
  const last = segments[segments.length - 1]
  if (last && last.kind === 'tools') {
    last.tools.push(tool)
    return
  }
  segments.push({ kind: 'tools', tools: [tool] })
}

/** 把工具结果折回宣布它的那次调用。 */
function updateTool(
  segments: LiveSegment[],
  toolCallId: string,
  update: (tool: ActiveToolInfo) => ActiveToolInfo
): boolean {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.kind !== 'tools') continue
    const index = segment.tools.findIndex((t) => t.toolCallId === toolCallId)
    if (index !== -1) {
      segment.tools[index] = update(segment.tools[index])
      return true
    }
  }
  return false
}

/** 从一组切片里抽出正文。 */
export function liveTextOf(segments: LiveSegment[]): string {
  return segments
    .filter((s): s is Extract<LiveSegment, { kind: 'text' }> => s.kind === 'text')
    .map((s) => s.text)
    .join('')
}

/**
 * 整轮 run 的正文（按轮序拼接）。
 *
 * 分轮之后 `segmentsRef` 只指向**当前轮**，所以「中断前已生成的部分内容」
 * 必须从 turns 里取 —— 否则取消时只会带上最后那一轮的文字。
 */
function runTextOf(turns: LiveTurn[]): string {
  return turns.map((t) => liveTextOf(t.segments)).join('')
}

/** 非 done 的结束原因没有得到回答，要在转写里说明为什么。 */
function failureNoticeFor(reason: string, detail?: string): string | undefined {
  switch (reason) {
    case 'error':
      return `⚠️ **任务失败**：${detail?.trim() || '运行以错误结束（详见 daemon 日志）。'}`
    case 'maxturnsexceeded':
    case 'max_turns_exceeded':
      return '⚠️ **任务停止**：达到最大轮数仍未产出结果。'
    case 'budgetexceeded':
    case 'budget_exceeded':
      return '⚠️ **任务停止**：达到 token 预算上限。'
    default:
      return undefined
  }
}

export function useAgentChatStream(options: UseAgentChatStreamOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  /** 正在跑的 run 属于哪个原型；切换项目后据此判断流式状态该不该显示。 */
  const [runPrototypeId, setRunPrototypeId] = useState<string | null>(null)
  const runPrototypeIdRef = useRef<string | null>(null)
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([])
  /** 本次 run 的轮次（含已完成的）；只在内存里，下一次 run 开始时清空。 */
  const [turns, setTurns] = useState<LiveTurn[]>([])
  /** 上一次 run 属于哪个原型 —— 跑完后圆点条还留着，靠它判断该不该显示。 */
  const [lastRunPrototypeId, setLastRunPrototypeId] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  // 指标
  const [lastRunMetrics, setLastRunMetrics] = useState<ChatRunMetrics | null>(null)
  const [streamTokensCount, setStreamTokensCount] = useState(0)
  const [streamReasoningCount, setStreamReasoningCount] = useState(0)
  /** 权威实时速率（来自 `metrics_update`）；本地降级估算不写这里。 */
  const [snapshotLiveTps, setSnapshotLiveTps] = useState(0)
  const [sessionTotalTokens, setSessionTotalTokens] = useState(0)
  const [currentContextTokens, setCurrentContextTokens] = useState(0)

  // 交互
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingPermission, setPendingPermission] = useState<AcpPermissionRequestPayload | null>(null)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [agentStatus, setAgentStatus] = useState<ThunderAgentStatus | null>(null)

  /** 当前轮的切片数组（`liveSegments` 是它的快照）；换轮时整体换新。 */
  const segmentsRef = useRef<LiveSegment[]>([])
  const turnsRef = useRef<LiveTurn[]>([])
  const currentTurnRef = useRef<LiveTurn | null>(null)
  /** run 起点，给每轮算相对偏移（正在跑的那一轮的实时时长）。 */
  const runStartRef = useRef(0)
  const activeRunIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const errorDetailRef = useRef<Map<string, string>>(new Map())
  /** 同步镜像：await 边界后的闭包读不到新 state，只能读 ref。 */
  const lastRunMetricsRef = useRef<ChatRunMetrics | null>(null)
  /** 本轮是否收到过权威快照。收到后本地估算即停用，避免两边互相覆盖。 */
  const hasSnapshotRef = useRef(false)
  /** 降级路径的累计正文/思考文本（快照缺席时按文本估算 token）。 */
  const textBufRef = useRef('')
  const reasoningBufRef = useRef('')
  const onCodeUpdatedRef = useRef(options.onCodeUpdated)
  onCodeUpdatedRef.current = options.onCodeUpdated

  /** 状态 + ref 同步写入（doSend 在 await 之后要读到本轮指标）。 */
  const applyMetrics = useCallback((next: ChatRunMetrics | null) => {
    lastRunMetricsRef.current = next
    setLastRunMetrics(next)
  }, [])

  const publishSegments = useCallback(() => {
    setLiveSegments([...segmentsRef.current])
  }, [])

  /** 轮次数组浅拷贝一版推给 React（segments 数组本身是共享引用）。 */
  const publishTurns = useCallback(() => {
    setTurns(turnsRef.current.map((t) => ({ ...t })))
  }, [])

  /**
   * 把「当前轮」推进到事件里带的那个 turn 号。
   *
   * 事件流里 `turn_start` 一定会先到，但这里不依赖它：任何带 turn 的事件都会
   * 触发推进，所以即使中间漏了一帧，轮次边界也不会错位。
   */
  const ensureTurn = useCallback((turn: number): LiveTurn => {
    const current = currentTurnRef.current
    const no = Number.isFinite(turn) && turn > 0 ? turn : (current?.turn ?? 1)
    if (current && current.turn === no) return current
    if (current) current.status = 'done'
    const next: LiveTurn = {
      turn: no,
      segments: [],
      status: 'running',
      toolCount: 0,
      startedAtOffset: Math.max(0, Date.now() - runStartRef.current)
    }
    turnsRef.current.push(next)
    currentTurnRef.current = next
    // 关键：把实时写入目标切到新轮的数组上，上一轮就此冻住。
    segmentsRef.current = next.segments
    // 新轮立刻就露面：`turn_start` 万一缺席，圆点也不会漏。
    publishTurns()
    return next
  }, [publishTurns])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const resetStreamState = useCallback(() => {
    segmentsRef.current = []
    turnsRef.current = []
    currentTurnRef.current = null
    runStartRef.current = Date.now()
    setTurns([])
    setLiveSegments([])
    setStreamTokensCount(0)
    setStreamReasoningCount(0)
    setSnapshotLiveTps(0)
    setElapsedMs(0)
    setPendingQuestion(null)
    setQueuedMessages([])
    setAgentStatus(null)
    hasSnapshotRef.current = false
    textBufRef.current = ''
    reasoningBufRef.current = ''
    // 「本轮」的数字随新消息重算：不清掉的话，上一次 run 的总耗时/瞬时值会
    // 一直挂到新 run 的第一轮结束。快照会在第一帧把它填回来。
    applyMetrics(null)
    stopTimer()
  }, [applyMetrics, stopTimer])

  /** 单个 observation 事件 → segments / 指标。 */
  const applyEvent = useCallback(
    (ev: any, runId: string) => {
      if (!ev || typeof ev !== 'object') return
      switch (ev.type) {
        case 'turn_start': {
          // 立刻切空主体区：上一轮的 thinking/tool 当场折叠回圆点，
          // 而不是拖到新轮的第一个 delta 才换。
          ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
          publishSegments()
          break
        }
        case 'token_delta': {
          const delta = typeof ev.delta === 'string' ? ev.delta : ''
          ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
          appendDelta(segmentsRef.current, 'text', delta)
          textBufRef.current += delta
          // 快照在跑就交给它：权威值随后会覆盖同一位置。
          if (!hasSnapshotRef.current) {
            setStreamTokensCount(
              estimateTokens(textBufRef.current) + estimateTokens(reasoningBufRef.current)
            )
          }
          publishSegments()
          break
        }
        case 'reasoning_delta': {
          const delta = typeof ev.delta === 'string' ? ev.delta : ''
          ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
          appendDelta(segmentsRef.current, 'reasoning', delta)
          reasoningBufRef.current += delta
          if (!hasSnapshotRef.current) {
            setStreamReasoningCount(estimateTokens(reasoningBufRef.current))
            setStreamTokensCount(
              estimateTokens(textBufRef.current) + estimateTokens(reasoningBufRef.current)
            )
          }
          publishSegments()
          break
        }
        case 'tool_exec_start': {
          const toolCallId = String(ev.tool_call_id || `tool_${Date.now()}`)
          const tool: ActiveToolInfo = {
            toolCallId,
            name: ev.name || 'tool',
            arguments: ev.arguments || {},
            isRunning: true
          }
          const turn = ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
          if (!updateTool(segmentsRef.current, toolCallId, () => tool)) {
            appendTool(segmentsRef.current, tool)
            turn.toolCount += 1
          }
          publishTurns()
          publishSegments()
          break
        }
        case 'tool_exec_result': {
          const toolCallId = String(ev.tool_call_id || '')
          ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
          updateTool(segmentsRef.current, toolCallId, (t) => ({
            ...t,
            isRunning: false,
            result: ev.result?.output ?? ev.result,
            isError: Boolean(ev.result?.is_error)
          }))
          publishSegments()
          break
        }
        case 'custom': {
          if (ev.kind === 'agent_status' && ev.payload && typeof ev.payload === 'object') {
            const nextStatus = ev.payload as ThunderAgentStatus
            setAgentStatus((prev) => {
              if (prev && typeof nextStatus.seq === 'number' && typeof prev.seq === 'number' && nextStatus.seq <= prev.seq) {
                return prev
              }
              return nextStatus
            })
            break
          }
          // thunder 0.4+ 的权威遥测：token 数、速率、上下文占用全部以它为准。
          if (ev.kind !== 'metrics_update' || !ev.payload || typeof ev.payload !== 'object') break
          const snap = ev.payload as AgentMetricsSnapshot
          hasSnapshotRef.current = true
          if (typeof snap.live_tokens === 'number') setStreamTokensCount(snap.live_tokens)
          if (typeof snap.live_reasoning_tokens === 'number') {
            setStreamReasoningCount(snap.live_reasoning_tokens)
          }
          setSnapshotLiveTps(typeof snap.live_tps === 'number' ? snap.live_tps : 0)
          if (typeof snap.context_tokens === 'number' && snap.context_tokens > 0) {
            setCurrentContextTokens(snap.context_tokens)
          }
          // 总消耗 是计数器：以快照的绝对值为准，而不是只靠本地累加 ——
          // 本地那份只看得到自己收到的轮次，与 daemon 的累计值会漂移。
          if (typeof snap.session_total_tokens === 'number' && snap.session_total_tokens > 0) {
            setSessionTotalTokens(snap.session_total_tokens)
          }
          // 整 run 的数字（含实时 wall clock、本轮 token 明细）也一并落到「本轮」：
          // 它是权威值，会覆盖紧随其前的 `turn_end` / `loop_complete` 估算。
          // 第一帧（turn_start）就带 wall clock，所以总耗时从 run 一开始就能显示。
          applyMetrics(metricsFromSnapshot(snap))
          break
        }
        case 'turn_end': {
          // 轮结束：把这一轮冻住（圆点由此从 running 变 done），并记下它的账。
          {
            const turn = ensureTurn(typeof ev.turn === 'number' ? ev.turn : 0)
            turn.status = ev.finish_reason === 'error' ? 'error' : 'done'
            turn.finishReason = typeof ev.finish_reason === 'string' ? ev.finish_reason : undefined
            const dur = typeof ev.stats?.duration_ms === 'number' ? ev.stats.duration_ms : undefined
            if (dur !== undefined) turn.durationMs = dur
            if (typeof ev.stats?.prompt_tokens === 'number') turn.promptTokens = ev.stats.prompt_tokens
            if (typeof ev.stats?.completion_tokens === 'number') {
              turn.completionTokens = ev.stats.completion_tokens
            }
            currentTurnRef.current = null
            publishTurns()
          }
          const stats = ev.stats
          if (stats) {
            const pt = typeof stats.prompt_tokens === 'number' ? stats.prompt_tokens : undefined
            const ct = typeof stats.completion_tokens === 'number' ? stats.completion_tokens : undefined
            const dur = typeof stats.duration_ms === 'number' ? stats.duration_ms : 0
            const tps =
              typeof stats.tokens_per_second === 'number'
                ? stats.tokens_per_second
                : dur > 0 && ct !== undefined
                  ? ct / (dur / 1000)
                  : undefined
            applyMetrics({
              tps,
              promptTokens: pt,
              completionTokens: ct,
              cachedTokens: typeof stats.cached_tokens === 'number' ? stats.cached_tokens : 0,
              reasoningTokens:
                typeof stats.reasoning_tokens === 'number' ? stats.reasoning_tokens : undefined,
              totalTokens: pt !== undefined || ct !== undefined ? (pt || 0) + (ct || 0) : undefined,
              durationMs: dur
            })
            const turnTotal = (pt || 0) + (ct || 0)
            if (turnTotal > 0) {
              setSessionTotalTokens((prev) => prev + turnTotal)
              setCurrentContextTokens(turnTotal)
            }
          }
          break
        }
        case 'loop_complete': {
          const stats = ev.stats
          if (stats) {
            const pt = typeof stats.total_prompt_tokens === 'number' ? stats.total_prompt_tokens : undefined
            const ct = typeof stats.total_completion_tokens === 'number' ? stats.total_completion_tokens : undefined
            const dur = typeof stats.total_duration_ms === 'number' ? stats.total_duration_ms : 0
            const tps =
              typeof stats.avg_tokens_per_second === 'number'
                ? stats.avg_tokens_per_second
                : dur > 0 && ct !== undefined
                  ? ct / (dur / 1000)
                  : undefined
            applyMetrics({
              tps,
              promptTokens: pt,
              completionTokens: ct,
              cachedTokens: typeof stats.total_cached_tokens === 'number' ? stats.total_cached_tokens : 0,
              reasoningTokens:
                typeof stats.total_reasoning_tokens === 'number' ? stats.total_reasoning_tokens : undefined,
              totalTokens: pt !== undefined || ct !== undefined ? (pt || 0) + (ct || 0) : undefined,
              durationMs: dur
            })
          }
          break
        }
        case 'steer_accepted': {
          // 排队消息已并入运行：从本地队列移除。
          const text = String(ev.message || '')
          if (text) {
            setQueuedMessages((prev) => {
              const idx = prev.indexOf(text)
              return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev
            })
          }
          break
        }
        case 'error': {
          const message = String(ev.message || '').trim()
          if (message) errorDetailRef.current.set(runId, message)
          if (currentTurnRef.current) {
            currentTurnRef.current.status = 'error'
            publishTurns()
          }
          break
        }
        default:
          break
      }
    },
    [applyMetrics, ensureTurn, publishSegments, publishTurns]
  )

  /** 发起一轮 run，并在结束时归还结果。调用方负责追加聊天消息。 */
  const startRun = useCallback(
    async (params: StartRunParams): Promise<RunOutcome> => {
      if (!window.agent?.run) {
        return { ok: false, error: 'agent 桥接不可用' }
      }

      resetStreamState()
      errorDetailRef.current.delete(params.runId)
      setLastRunPrototypeId(params.prototypeId)
      setIsStreaming(true)
      setActiveRunId(params.runId)
      setRunPrototypeId(params.prototypeId)
      runPrototypeIdRef.current = params.prototypeId
      activeRunIdRef.current = params.runId

      const startWall = Date.now()
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startWall)
      }, 500)

      const offStream = window.agent.onStreamEvent((frame: any) => {
        if (frame?.run_id && frame.run_id !== params.runId) return
        if (frame?.type === 'observation' && frame.event) {
          applyEvent(frame.event, params.runId)
        }
      })

      const offQuestion = window.agent.onUserQuestion
        ? window.agent.onUserQuestion((q: any) => {
            if (q?.task_id && q.task_id !== params.runId) return
            setPendingQuestion({
              questionId: String(q.question_id || ''),
              taskId: String(q.task_id || params.runId),
              questions: Array.isArray(q.questions) ? q.questions : []
            })
          })
        : undefined
      const offPermission = window.agent.onAcpPermissionRequest
        ? window.agent.onAcpPermissionRequest((payload: any) => {
            if (payload?.runId && payload.runId !== params.runId) return
            setPendingPermission(payload as AcpPermissionRequestPayload)
          })
        : undefined

      const offPermissionResolved = window.agent.onAcpPermissionResolved
        ? window.agent.onAcpPermissionResolved((payload: any) => {
            setPendingPermission((current) => {
              if (current?.requestId === payload?.requestId) return null
              return current
            })
          })
        : undefined


      const offCode = window.agent.onCodeUpdated
        ? window.agent.onCodeUpdated((data: any) => {
            onCodeUpdatedRef.current?.(
              data.code,
              data.techStack,
              data.previewUrl,
              data.entryFile,
              runPrototypeIdRef.current ?? undefined
            )
          })
        : undefined

      try {
        const res = await window.agent.run({
          runId: params.runId,
          prototypeId: params.prototypeId,
          engine: params.engine,
          prompt: params.prompt,
          code: params.code,
          history: params.history,
          inspectTarget: params.inspectTarget as any,
          markupTargets: params.markupTargets as any,
          attachments: params.attachments
        })

        if (!res?.ok) {
          return {
            ok: false,
            error: res?.error ?? '未知错误',
            partialContent: runTextOf(turnsRef.current).trim() || undefined
          }
        }

        // 结束原因带 failure notice 时，把它作为正文呈现给调用方。
        const reason = String(res.finishReason || 'done')
        const notice = failureNoticeFor(reason, errorDetailRef.current.get(params.runId))
        const streamed = runTextOf(turnsRef.current)
        let finalContent: string | null = res.finalContent ?? null
        if (notice) {
          finalContent = `${notice}${streamed ? `\n\n${streamed}` : ''}`
        } else if (reason === 'cancelled') {
          finalContent = streamed
            ? `已停止。本次修改已部分生成：\n${streamed}`
            : '已停止，未生成修改。'
        }

        return {
          ok: true,
          finishReason: reason,
          finalContent,
          code: res.code,
          techStack: res.techStack
        }
      } catch (err: any) {
        return {
          ok: false,
          error: err?.message ?? String(err),
          partialContent: runTextOf(turnsRef.current).trim() || undefined
        }
      } finally {
        // 收口：最后一轮若没等到 turn_end（取消/异常），也把圆点落成终态。
        const pendingTurn = currentTurnRef.current
        if (pendingTurn) {
          pendingTurn.status = pendingTurn.status === 'error' ? 'error' : 'done'
          pendingTurn.durationMs =
            pendingTurn.durationMs ?? Math.max(0, Date.now() - runStartRef.current - pendingTurn.startedAtOffset)
          currentTurnRef.current = null
          publishTurns()
        }
        offStream?.()
        offQuestion?.()
        offCode?.()
        offPermission?.()
        offPermissionResolved?.()
        setPendingPermission(null)
        setIsStreaming(false)
        setActiveRunId(null)
        setRunPrototypeId(null)
        runPrototypeIdRef.current = null
        activeRunIdRef.current = null
        setPendingQuestion(null)
        stopTimer()
      }
    },
    [applyEvent, publishTurns, resetStreamState, stopTimer]
  )

  const cancelRun = useCallback(async () => {
    const runId = activeRunIdRef.current
    if (runId) {
      try {
        await window.agent?.cancel(runId)
      } catch {
        // ignore
      }
    }
  }, [])

  /** 运行中插话：steer 下一个工具边界进入；follow_up 本轮结束后进入。 */
  const queueIntoRunning = useCallback(
    async (message: string, behavior: 'steer' | 'follow_up'): Promise<boolean> => {
      const runId = activeRunIdRef.current
      const text = message.trim()
      if (!runId || !text) return false
      if (!window.agent?.steerTask) return false
      try {
        const res = await window.agent.steerTask({ taskId: runId, message: text, behavior })
        if (res?.ok) {
          setQueuedMessages((prev) => [...prev, text])
          return true
        }
        return false
      } catch {
        return false
      }
    },
    []
  )

  const steer = useCallback((message: string) => queueIntoRunning(message, 'steer'), [queueIntoRunning])
  const followUp = useCallback((message: string) => queueIntoRunning(message, 'follow_up'), [queueIntoRunning])

  const answerQuestion = useCallback(
    async (answers: Record<string, string> | undefined, cancelled = false) => {
      const pending = pendingQuestion
      if (!pending) return
      setPendingQuestion(null)
      try {
        await window.agent?.answerQuestion({
          questionId: pending.questionId,
          answers,
          cancelled
        })
      } catch (err) {
        console.warn('[chat] failed to answer question:', err)
      }
    },
    [pendingQuestion]
  )

  const dismissQuestion = useCallback(async () => {
    await answerQuestion(undefined, true)
  }, [answerQuestion])

  const addSessionTokens = useCallback((n: number) => {
    if (n > 0) setSessionTotalTokens((prev) => prev + n)
  }, [])

  const getLastRunMetrics = useCallback(() => lastRunMetricsRef.current, [])

  const resetSessionCounters = useCallback(() => {
    setSessionTotalTokens(0)
    setCurrentContextTokens(0)
    applyMetrics(null)
  }, [applyMetrics])

  const respondPermission = useCallback(
    async (optionId?: string, cancelled = false) => {
      if (!pendingPermission) return
      if (window.agent?.acpRespondPermission) {
        await window.agent.acpRespondPermission({
          requestId: pendingPermission.requestId,
          optionId,
          cancelled
        })
      }
      setPendingPermission(null)
    },
    [pendingPermission]
  )

  const dismissPermission = useCallback(() => {
    void respondPermission(undefined, true)
  }, [respondPermission])

  // 组件卸载时清计时器
  useEffect(() => stopTimer, [stopTimer])

  const liveTps = useMemo(() => {
    if (!isStreaming) return 0
    // 权威速率优先；没有快照（旧版 daemon）才退回本地估算。
    if (snapshotLiveTps > 0) return snapshotLiveTps
    if (elapsedMs <= 200 || streamTokensCount === 0) return 0
    return streamTokensCount / (elapsedMs / 1000)
  }, [isStreaming, snapshotLiveTps, elapsedMs, streamTokensCount])

  return {
    isStreaming,
    activeRunId,
    runPrototypeId,
    liveSegments,
    /** 本次 run 的分轮结果（圆点条的输入）。 */
    turns,
    /** 上一次 run 归属的原型；圆点条在跑完后仍要显示，靠它判断。 */
    lastRunPrototypeId,
    elapsedMs,
    lastRunMetrics,
    streamingMetrics: {
      tokensCount: streamTokensCount,
      tps: liveTps,
      reasoningCount: streamReasoningCount
    },
    agentStatus,
    sessionTotalTokens,
    currentContextTokens,
    contextWindowLimit: options.contextWindowLimit,
    pendingQuestion,
    answerQuestion,
    dismissQuestion,
    pendingPermission,
    respondPermission,
    dismissPermission,
    queuedCount: queuedMessages.length,
    steer,
    followUp,
    startRun,
    cancelRun,
    addSessionTokens,
    resetSessionCounters,
    getLastRunMetrics
  }
}
