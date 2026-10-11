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

export interface ChatRunMetrics {
  tps?: number
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  durationMs?: number
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

/** 从流式 segments 里抽出正文（给取消时补一条“部分生成”的消息用）。 */
export function liveTextOf(segments: LiveSegment[]): string {
  return segments
    .filter((s): s is Extract<LiveSegment, { kind: 'text' }> => s.kind === 'text')
    .map((s) => s.text)
    .join('')
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
  const [elapsedMs, setElapsedMs] = useState(0)

  // 指标
  const [lastRunMetrics, setLastRunMetrics] = useState<ChatRunMetrics | null>(null)
  const [streamTokensCount, setStreamTokensCount] = useState(0)
  const [streamReasoningCount, setStreamReasoningCount] = useState(0)
  const [sessionTotalTokens, setSessionTotalTokens] = useState(0)
  const [currentContextTokens, setCurrentContextTokens] = useState(0)

  // 交互
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])

  const segmentsRef = useRef<LiveSegment[]>([])
  const activeRunIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const errorDetailRef = useRef<Map<string, string>>(new Map())
  /** 同步镜像：await 边界后的闭包读不到新 state，只能读 ref。 */
  const lastRunMetricsRef = useRef<ChatRunMetrics | null>(null)
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

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const resetStreamState = useCallback(() => {
    segmentsRef.current = []
    setLiveSegments([])
    setStreamTokensCount(0)
    setStreamReasoningCount(0)
    setElapsedMs(0)
    setPendingQuestion(null)
    setQueuedMessages([])
    stopTimer()
  }, [stopTimer])

  /** 单个 observation 事件 → segments / 指标。 */
  const applyEvent = useCallback(
    (ev: any, runId: string) => {
      if (!ev || typeof ev !== 'object') return
      switch (ev.type) {
        case 'token_delta': {
          appendDelta(segmentsRef.current, 'text', ev.delta || '')
          setStreamTokensCount((prev) => prev + 1)
          publishSegments()
          break
        }
        case 'reasoning_delta': {
          appendDelta(segmentsRef.current, 'reasoning', ev.delta || '')
          setStreamTokensCount((prev) => prev + 1)
          setStreamReasoningCount((prev) => prev + 1)
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
          if (!updateTool(segmentsRef.current, toolCallId, () => tool)) {
            appendTool(segmentsRef.current, tool)
          }
          publishSegments()
          break
        }
        case 'tool_exec_result': {
          const toolCallId = String(ev.tool_call_id || '')
          updateTool(segmentsRef.current, toolCallId, (t) => ({
            ...t,
            isRunning: false,
            result: ev.result?.output ?? ev.result,
            isError: Boolean(ev.result?.is_error)
          }))
          publishSegments()
          break
        }
        case 'turn_end': {
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
          break
        }
        default:
          break
      }
    },
    [publishSegments]
  )

  /** 发起一轮 run，并在结束时归还结果。调用方负责追加聊天消息。 */
  const startRun = useCallback(
    async (params: StartRunParams): Promise<RunOutcome> => {
      if (!window.agent?.run) {
        return { ok: false, error: 'agent 桥接不可用' }
      }

      resetStreamState()
      errorDetailRef.current.delete(params.runId)
      segmentsRef.current = []
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
            partialContent: liveTextOf(segmentsRef.current).trim() || undefined
          }
        }

        // 结束原因带 failure notice 时，把它作为正文呈现给调用方。
        const reason = String(res.finishReason || 'done')
        const notice = failureNoticeFor(reason, errorDetailRef.current.get(params.runId))
        const streamed = liveTextOf(segmentsRef.current)
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
          partialContent: liveTextOf(segmentsRef.current).trim() || undefined
        }
      } finally {
        offStream?.()
        offQuestion?.()
        offCode?.()
        setIsStreaming(false)
        setActiveRunId(null)
        setRunPrototypeId(null)
        runPrototypeIdRef.current = null
        activeRunIdRef.current = null
        setPendingQuestion(null)
        stopTimer()
      }
    },
    [applyEvent, resetStreamState, stopTimer]
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

  // 组件卸载时清计时器
  useEffect(() => stopTimer, [stopTimer])

  const liveTps = useMemo(() => {
    if (!isStreaming || elapsedMs <= 200 || streamTokensCount === 0) return 0
    return streamTokensCount / (elapsedMs / 1000)
  }, [isStreaming, elapsedMs, streamTokensCount])

  return {
    isStreaming,
    activeRunId,
    runPrototypeId,
    liveSegments,
    elapsedMs,
    lastRunMetrics,
    streamingMetrics: {
      tokensCount: streamTokensCount,
      tps: liveTps,
      reasoningCount: streamReasoningCount
    },
    sessionTotalTokens,
    currentContextTokens,
    contextWindowLimit: options.contextWindowLimit,
    pendingQuestion,
    answerQuestion,
    dismissQuestion,
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
