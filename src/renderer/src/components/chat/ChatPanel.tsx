import React, { useState, useRef, useEffect } from 'react'
import { message, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  Zap,
  Settings,
  Trash2,
  Paperclip,
  Send,
  Square,
  X,
  Target,
  Edit3,
  Copy,
  Check,
  Bot,
  Sparkles,
  FileText,
  AlertCircle
} from 'lucide-react'
import { Markdown, Tag } from '@lobehub/ui'
import {
  OpenAI,
  Anthropic,
  DeepSeek,
  Google,
  Ollama,
  Groq,
  Mistral,
  Meta,
  Minimax,
  Moonshot,
  Zhipu,
  Qwen
} from '@lobehub/icons'
import {
  usePrototypeStore,
  useCurrentPrototype,
  type RunStats
} from '../../stores/usePrototypeStore'
import {
  useAgentModelConfigStore,
  useGroupedModels,
  useSelectedModel
} from '../../stores/useAgentModelConfigStore'

export interface PointedTarget {
  tagName: string
  text?: string
  className?: string
  selector?: string
  componentName?: string
  sourceFile?: string
  sourceLine?: number | null
  sourceLocated?: boolean
  locateMode?: 'compiler' | 'fiber' | 'text' | 'none'
  framework?: string
  codeSnippet?: string
  outerHTMLSnippet?: string
  stack?: string[]
}

export interface MarkupAnnotation {
  id?: string
  note: string
  rect: { left: number; top: number; width: number; height: number }
  target?: PointedTarget
}

interface PendingAttachment {
  id: string
  kind: 'image' | 'text'
  name: string
  mimeType: string
  bytes: number
  previewUrl?: string
  data?: string
  text?: string
  truncated?: boolean
}

interface ChatPanelProps {
  onOpenSettings: () => void
  inspectTarget: PointedTarget | null
  onClearInspectTarget: () => void
  markupAnnotations: MarkupAnnotation[]
  onRemoveMarkupAnnotation: (index: number) => void
  onClearSelectionState: () => void
  onCodeUpdated: (
    code: string,
    label: string,
    techStack?: string,
    previewUrl?: string,
    entryFile?: string
  ) => void
}

interface PendingUserQuestion {
  taskId: string
  questionId: string
  questions: Array<{
    question: string
    header?: string
    multi_select?: boolean
    options: Array<{ label: string; description?: string }>
  }>
}

function getProviderIcon(provider: string, size = 14) {
  const p = provider.toLowerCase()
  if (p.includes('openai')) return <OpenAI size={size} />
  if (p.includes('claude') || p.includes('anthropic')) return <Anthropic size={size} />
  if (p.includes('deepseek')) return <DeepSeek size={size} />
  if (p.includes('google') || p.includes('gemini')) return <Google size={size} />
  if (p.includes('ollama')) return <Ollama size={size} />
  if (p.includes('groq')) return <Groq size={size} />
  if (p.includes('mistral')) return <Mistral size={size} />
  if (p.includes('meta') || p.includes('llama')) return <Meta size={size} />
  if (p.includes('minimax')) return <Minimax size={size} />
  if (p.includes('moonshot') || p.includes('kimi')) return <Moonshot size={size} />
  if (p.includes('zhipu') || p.includes('glm')) return <Zhipu size={size} />
  if (p.includes('qwen') || p.includes('aliyun')) return <Qwen size={size} />
  return <Bot size={size} />
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  onOpenSettings,
  inspectTarget,
  onClearInspectTarget,
  markupAnnotations,
  onRemoveMarkupAnnotation,
  onClearSelectionState,
  onCodeUpdated
}) => {
  const currentPrototype = useCurrentPrototype()
  const { addChatMessage, resetChat, updateTechStack } = usePrototypeStore()

  const {
    selectionId,
    thinkingLevel,
    envLocked,
    configured,
    selectModel,
    selectThinkingLevel
  } = useAgentModelConfigStore()

  const groupedModels = useGroupedModels()
  const selectedModel = useSelectedModel()

  const [promptInput, setPromptInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  // Run progress state
  const [runPhase, setRunPhase] = useState<'idle' | 'running' | 'verifying' | 'error' | 'cancelled'>('idle')
  const [gateRound, setGateRound] = useState(0)
  const [runTurn, setRunTurn] = useState(0)
  const [runElapsedMs, setRunElapsedMs] = useState(0)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [toolCount, setToolCount] = useState(0)
  const [toolFailed, setToolFailed] = useState(false)
  const [runStreamed, setRunStreamed] = useState('')
  const [runReasoning, setRunReasoning] = useState(false)
  const [runNotice, setRunNotice] = useState('')
  const [runStats, setRunStats] = useState<RunStats | null>(null)

  // Metrics
  const [liveTurnTps, setLiveTurnTps] = useState<number | null>(null)
  const [lastRunTps, setLastRunTps] = useState<number | null>(null)
  const [contextUsedTokens, setContextUsedTokens] = useState<number | null>(null)

  // Attachments
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatScrollEl = useRef<HTMLDivElement>(null)
  const runTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Interactive PM Question Card (`ask_user_question` from thunder-daemon)
  const [pendingQuestion, setPendingQuestion] = useState<PendingUserQuestion | null>(null)
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({})
  const [questionCustomText, setQuestionCustomText] = useState<Record<number, string>>({})
  const [submittingAnswer, setSubmittingAnswer] = useState(false)

  const scrollToBottom = () => {
    setTimeout(() => {
      if (chatScrollEl.current) {
        chatScrollEl.current.scrollTop = chatScrollEl.current.scrollHeight
      }
    }, 50)
  }

  useEffect(() => {
    scrollToBottom()
  }, [currentPrototype?.chatMessages?.length, runStreamed, pendingQuestion])

  const handleToggleOption = (qIdx: number, label: string, multi?: boolean) => {
    setQuestionSelections((prev) => {
      const current = prev[qIdx] || []
      if (multi) {
        const next = current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label]
        return { ...prev, [qIdx]: next }
      }
      return { ...prev, [qIdx]: [label] }
    })
  }

  const handleSubmitQuestionAnswers = async (cancelled = false) => {
    if (!pendingQuestion || !window.agent?.answerQuestion) return
    setSubmittingAnswer(true)
    try {
      const answers: Record<string, string> = {}
      pendingQuestion.questions.forEach((q, idx) => {
        const picked = questionSelections[idx] || []
        const custom = (questionCustomText[idx] || '').trim()
        const combined = [...picked, ...(custom ? [custom] : [])].join('；')
        answers[q.question] = combined || (q.options?.[0]?.label ?? '由 AI 自行决定')
      })

      await window.agent.answerQuestion({
        questionId: pendingQuestion.questionId,
        answers,
        cancelled
      })
      setPendingQuestion(null)
      setQuestionSelections({})
      setQuestionCustomText({})
    } catch (e: any) {
      message.error(`提交回答失败: ${e.message}`)
    } finally {
      setSubmittingAnswer(false)
    }
  }

  const copyMessage = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(idx)
      setTimeout(() => setCopiedIndex(null), 1500)
    } catch {
      message.warning('复制失败，请手动选中文本')
    }
  }

  // File Handling
  const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const MAX_ATTACHMENTS = 10
  const MAX_TEXT_BYTES = 64 * 1024

  const readAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
      reader.readAsDataURL(file)
    })
  }

  const addFiles = async (files: File[]) => {
    const accepted: PendingAttachment[] = []
    let skipped = 0
    for (const file of files) {
      if (pendingAttachments.length + accepted.length >= MAX_ATTACHMENTS) {
        skipped++
        continue
      }
      const mime = (file.type || '').toLowerCase()
      if (mime.startsWith('image/')) {
        if (file.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_MIME.has(mime)) {
          skipped++
          continue
        }
        const dataUrl = await readAsDataUrl(file)
        accepted.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: 'image',
          name: file.name || '图片',
          mimeType: mime,
          bytes: file.size,
          previewUrl: dataUrl,
          data: dataUrl.split(',')[1] ?? ''
        })
      } else {
        const text = await file.slice(0, MAX_TEXT_BYTES).text()
        accepted.push({
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: 'text',
          name: file.name,
          mimeType: file.type || 'text/plain',
          bytes: file.size,
          text,
          truncated: file.size > MAX_TEXT_BYTES
        })
      }
    }
    if (accepted.length) setPendingAttachments((prev) => [...prev, ...accepted])
    if (skipped) message.warning(`已忽略 ${skipped} 个不支持或超出大小的文件`)
  }

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      await addFiles(Array.from(e.target.files))
    }
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/'))
    if (!items.length) return
    e.preventDefault()
    const files = items.map((i) => i.getAsFile()).filter((f): f is File => !!f)
    await addFiles(files)
  }

  const handleDrop = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    await addFiles(files)
  }

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // Instructions builders
  const componentLabel = (t: any): string => {
    const comp = String(t?.componentName || '')
    const tag = String(t?.tagName || '')
    return comp && comp.toLowerCase() !== tag.toLowerCase() ? comp : ''
  }

  const targetLabel = (t: any): string => {
    return componentLabel(t) || String(t?.selector || t?.tagName || '')
  }

  const buildInspectInstruction = (target: PointedTarget): string => {
    const lines = [
      '【圈选位置】: 用户在预览里点选了一个具体元素，请只改这个元素及其子元素，不要动整页/全局样式。'
    ]
    const firstClass = String(target.className || '').split(' ').filter(Boolean)[0]
    let desc = `- 目标元素: <${target.tagName}`
    if (firstClass) desc += ` class="${firstClass}"`
    desc += '>'
    const comp = componentLabel(target)
    if (comp) desc += `（所在组件 <${comp}>）`
    lines.push(desc)
    if (target.selector) lines.push(`- 选择器: ${target.selector}`)
    if (target.text) lines.push(`- 该元素文本: "${target.text}"`)
    if (target.sourceFile) {
      const qualifier = target.sourceLocated === false ? '（文本匹配推断，非精确行号）' : ''
      lines.push(`- 源码位置${qualifier}: ${target.sourceFile}${target.sourceLine ? ':' + target.sourceLine : ''}`)
    }
    if (target.outerHTMLSnippet) lines.push(`- 元素 HTML: ${target.outerHTMLSnippet}`)
    return lines.join('\n')
  }

  const buildMarkupInstruction = (markups: MarkupAnnotation[]): string => {
    if (markups.length === 1) {
      const m = markups[0]
      const lines = [`【圈改批注诉求】: ${m.note}`]
      lines.push(
        m.target
          ? '【圈改位置】: 用户在预览里框选了一块区域后写的批注，请只改这一块，不要动整页/全局样式。'
          : '【圈改位置】: 这次没能在框内定位到具体元素，请先按批注判断改哪一块；判断不了就不要动全局样式。'
      )
      if (m.target) {
        lines.push(`- 目标元素: <${m.target.tagName}>`)
        if (m.target.sourceFile) lines.push(`- 源码位置: ${m.target.sourceFile}:${m.target.sourceLine || ''}`)
      }
      return lines.join('\n')
    }

    const lines = [
      `【圈改批注诉求】用户在预览里框选了 ${markups.length} 处区域并分别写了批注，请逐处修改：每一处只改它自己那一块。`
    ]
    markups.forEach((m, i) => {
      lines.push(`【圈改位置 ${i + 1}】`)
      lines.push(`- 批注: ${m.note}`)
      if (m.target) {
        lines.push(`- 目标元素: <${m.target.tagName}>`)
        if (m.target.sourceFile) lines.push(`- 源码位置: ${m.target.sourceFile}:${m.target.sourceLine || ''}`)
      }
    })
    return lines.join('\n')
  }

  // Cancel Run
  const handleCancelRun = async () => {
    if (!activeRunId) return
    try {
      await window.agent?.cancel(activeRunId)
    } catch {
      // ignore
    }
  }

  // Stream Event Frame Handler
  const handleStreamFrame = (frame: any) => {
    if (!frame) return
    if (frame.type === 'run_finished') {
      if (frame.stats) {
        setRunStats({
          totalTurns: frame.stats?.total_turns ?? 0,
          promptTokens: frame.stats?.total_prompt_tokens ?? 0,
          completionTokens: frame.stats?.total_completion_tokens ?? 0,
          durationMs: frame.stats?.total_duration_ms ?? 0,
          toolExecutions: frame.stats?.total_tool_executions ?? 0,
          tokensPerSecond: frame.stats?.avg_tokens_per_second
        })
      }
      if (typeof frame.stats?.avg_tokens_per_second === 'number') {
        setLastRunTps(frame.stats.avg_tokens_per_second)
      }
      if (frame.finish_reason === 'cancelled') setRunPhase('cancelled')
      return
    }
    if (frame.type === 'error') {
      setRunPhase('error')
      setRunNotice(frame.message ?? '')
      return
    }
    if (frame.type === 'gate_request') {
      setRunPhase('verifying')
      setGateRound(frame.round ?? 1)
      return
    }
    if (frame.type !== 'observation' || !frame.event) return
    const ev = frame.event
    switch (ev.type) {
      case 'turn_start':
        setRunTurn(ev.turn)
        break
      case 'token_delta':
        setRunStreamed((prev) => prev + (ev.delta ?? ''))
        setRunReasoning(false)
        scrollToBottom()
        break
      case 'reasoning_delta':
        setRunReasoning(true)
        break
      case 'tool_exec_start':
        setActiveTool(ev.name)
        break
      case 'tool_exec_result':
        setActiveTool(null)
        setToolCount((prev) => prev + 1)
        if (ev.result?.is_error) {
          setToolFailed(true)
          setRunNotice((prev) => (prev ? `${prev}\n${ev.name} 失败` : `${ev.name} 失败`))
        }
        break
      case 'turn_end':
        setRunTurn(ev.turn)
        if (typeof ev.stats?.tokens_per_second === 'number') {
          setLiveTurnTps(ev.stats.tokens_per_second)
        }
        if (typeof ev.stats?.prompt_tokens === 'number') {
          setContextUsedTokens((ev.stats.prompt_tokens ?? 0) + (ev.stats.completion_tokens ?? 0))
        }
        break
      case 'gate_result':
        if (ev.verdict === 'fail') {
          setRunPhase('error')
          setRunNotice(ev.detail ?? '验证未通过')
        } else if (ev.verdict === 'retry') {
          setRunPhase('running')
          setRunNotice(ev.detail ?? '')
        } else {
          setRunPhase('running')
        }
        break
      case 'error':
        setRunNotice(ev.message ?? '')
        break
    }
  }

  // Send request
  const handleSend = async () => {
    const text = promptInput.trim()
    const staged = pendingAttachments
    if ((!text && staged.length === 0) || isGenerating || !currentPrototype) return

    const target = inspectTarget
    const markups = markupAnnotations
    const textFiles = staged.filter((a) => a.kind === 'text')
    const images = staged.filter((a) => a.kind === 'image')

    const blocks: string[] = []
    if (target) blocks.push(buildInspectInstruction(target))
    if (markups.length) blocks.push(buildMarkupInstruction(markups))
    const notes = new Set(markups.map((m) => (m.note || '').trim()))
    let instruction = [...blocks, text && !notes.has(text) ? text : ''].filter(Boolean).join('\n')

    if (textFiles.length) {
      const b = textFiles.map((f) => {
        const body = (f.text ?? '').trim()
        const fence = body.includes('```') ? '````' : '```'
        return `[Referenced File: ${f.name}${f.truncated ? ' (truncated)' : ''}]\n${fence}\n${body}\n${fence}\n[End Referenced File]`
      })
      instruction = [...b, instruction].filter(Boolean).join('\n\n')
    }
    if (!instruction && images.length) instruction = '请分析这张图片。'

    const stackHeader =
      currentPrototype.techStack && currentPrototype.techStack !== 'vue3-element'
        ? `【当前技术栈】: ${currentPrototype.techStack}（请保持该栈，首行写 // tech-stack: ${currentPrototype.techStack} 声明）\n`
        : ''
    instruction = stackHeader + instruction

    const history = (currentPrototype.chatMessages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    addChatMessage(currentPrototype.id, {
      role: 'user',
      content: instruction,
      timestamp: Date.now(),
      inspectContext: target ? { tagName: target.tagName, text: target.text } : undefined,
      attachments: staged.length
        ? staged.map((a) => ({
            kind: a.kind,
            name: a.name,
            mimeType: a.mimeType,
            bytes: a.bytes,
            truncated: a.truncated
          }))
        : undefined
    })

    const outgoingImages = selectedModel?.input?.includes('image')
      ? images.map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data ?? '' }))
      : []

    setPromptInput('')
    setPendingAttachments([])
    onClearSelectionState()

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setActiveRunId(runId)
    setRunPhase('running')
    setGateRound(0)
    setRunTurn(0)
    setRunElapsedMs(0)
    setActiveTool(null)
    setToolCount(0)
    setToolFailed(false)
    setRunStreamed('')
    setRunReasoning(false)
    setRunNotice('')
    setRunStats(null)
    setLiveTurnTps(null)
    setContextUsedTokens(null)

    const startWall = Date.now()
    if (runTimerRef.current) clearInterval(runTimerRef.current)
    runTimerRef.current = setInterval(() => {
      setRunElapsedMs(Date.now() - startWall)
    }, 500)

    setIsGenerating(true)
    scrollToBottom()

    try {
      if (!window.agent?.run) {
        addChatMessage(currentPrototype.id, {
          role: 'assistant',
          content: '原型 Agent 未接入（agent 桥接不可用），无法执行本次修改。',
          timestamp: Date.now()
        })
        return
      }

      const offStream = window.agent.onStreamEvent((frame: any) => {
        if (frame?.run_id && frame.run_id !== runId) return
        handleStreamFrame(frame)
      })

      const offQuestion = window.agent.onUserQuestion
        ? window.agent.onUserQuestion((qData) => {
            if (qData?.task_id && qData.task_id !== runId) return
            setPendingQuestion({
              taskId: qData.task_id,
              questionId: qData.question_id,
              questions: qData.questions || []
            })
            setQuestionSelections({})
            setQuestionCustomText({})
            scrollToBottom()
          })
        : undefined

      const offCode = window.agent.onCodeUpdated(
        (data: {
          code: string
          techStack?: string
          previewUrl?: string
          entryFile?: string
        }) => {
          onCodeUpdated(
            data.code,
            instruction.slice(0, 40),
            data.techStack,
            data.previewUrl,
            data.entryFile
          )
          if (data.techStack && data.techStack !== currentPrototype.techStack) {
            updateTechStack(currentPrototype.id, data.techStack as any, data.entryFile)
          }
        }
      )

      let res: any
      try {
        res = await window.agent.run({
          runId,
          prototypeId: currentPrototype.id,
          prompt: instruction,
          code: currentPrototype.vueCode,
          history,
          inspectTarget: target ? (target as any) : undefined,
          markupTargets: markups.length ? (markups as any) : undefined,
          attachments: outgoingImages.length ? outgoingImages : undefined
        })
      } finally {
        offStream?.()
        offQuestion?.()
        offCode?.()
        setPendingQuestion(null)
      }

      if (!res?.ok) {
        addChatMessage(currentPrototype.id, {
          role: 'assistant',
          content: `生成异常: ${res?.error ?? '未知错误'}`,
          timestamp: Date.now()
        })
        return
      }

      if (res.code && res.code !== currentPrototype.vueCode) {
        onCodeUpdated(res.code, instruction.slice(0, 40), res.techStack)
        if (res.techStack && res.techStack !== currentPrototype.techStack) {
          updateTechStack(currentPrototype.id, res.techStack)
        }
      }

      if (res.finishReason === 'cancelled') {
        addChatMessage(currentPrototype.id, {
          role: 'assistant',
          content: runStreamed.trim() ? `已停止。本次修改已部分生成：\n${runStreamed.trim()}` : '已停止，未生成修改。',
          timestamp: Date.now(),
          stats: runStats ?? undefined
        })
        return
      }

      addChatMessage(currentPrototype.id, {
        role: 'assistant',
        content: res.finalContent?.trim() || runStreamed.trim() || '已完成本次原型修改。',
        timestamp: Date.now(),
        stats: runStats ?? undefined
      })
    } catch (err: any) {
      addChatMessage(currentPrototype.id, {
        role: 'assistant',
        content: `生成异常: ${err?.message ?? '未知错误'}`,
        timestamp: Date.now()
      })
    } finally {
      setIsGenerating(false)
      setActiveRunId(null)
      setRunPhase('idle')
      if (runTimerRef.current) clearInterval(runTimerRef.current)
      scrollToBottom()
    }
  }

  // Model select menu items
  const modelMenuItems: MenuProps['items'] = groupedModels.flatMap((group) => [
    {
      type: 'group',
      label: (
        <span className="flex items-center gap-1.5 font-bold text-slate-300">
          {getProviderIcon(group.provider, 13)}
          <span>{group.provider}</span>
        </span>
      ),
      children: group.items.map((m) => ({
        key: m.selectionId,
        label: (
          <span className="flex items-center justify-between gap-2">
            <span className={m.selectionId === selectionId ? 'text-sky-400 font-semibold' : ''}>
              {m.name || m.id}
            </span>
            {!m.available && <span className="text-[10px] text-amber-500">不可用</span>}
          </span>
        ),
        disabled: !m.available,
        onClick: () => selectModel(m.selectionId)
      }))
    }
  ])

  // Thinking level menu
  const thinkingLevels = selectedModel?.thinkingLevels?.length
    ? selectedModel.thinkingLevels
    : ['off', 'low', 'medium', 'high']

  const thinkingMenuItems: MenuProps['items'] = thinkingLevels.map((lv) => ({
    key: lv,
    label: (
      <span className={lv === thinkingLevel ? 'text-amber-400 font-bold' : ''}>
        {lv.toUpperCase()}
      </span>
    ),
    onClick: () => selectThinkingLevel(lv)
  }))

  // Metrics string
  const metricsTps = isGenerating ? liveTurnTps : lastRunTps
  const contextWindowLimit = selectedModel?.contextWindow || 0
  const contextPercent =
    contextWindowLimit > 0 && contextUsedTokens
      ? Math.min(100, Math.round((contextUsedTokens / contextWindowLimit) * 100))
      : 0

  return (
    <section className="w-96 flex flex-col border-r border-slate-800 bg-slate-900/90 z-10 flex-shrink-0 select-none">
      {/* 顶部 Header */}
      <header className="app-drag h-14 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 font-bold flex items-center gap-1">
            <Zap size={15} />
            <span>AI 原型对话</span>
          </span>
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded border transition truncate max-w-[140px] cursor-pointer flex items-center gap-1 ${
              configured
                ? 'border-emerald-700 text-emerald-400 hover:text-emerald-300'
                : 'border-amber-700 text-amber-400 hover:text-amber-300'
            }`}
            onClick={onOpenSettings}
            title={configured ? `当前模型：${selectedModel?.name || selectionId}` : '尚未配置模型，点击设置'}
          >
            {configured && selectedModel && getProviderIcon(selectedModel.provider, 11)}
            <span className="truncate">{configured ? selectedModel?.name || selectionId : '未配置模型'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="text-xs text-slate-400 hover:text-slate-200 transition p-1 rounded hover:bg-slate-800 cursor-pointer"
            title="模型与 Agent 设置"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => currentPrototype && resetChat(currentPrototype.id)}
            className="text-xs text-slate-400 hover:text-slate-200 transition p-1 rounded hover:bg-slate-800 cursor-pointer"
            title="清空对话"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {/* 未配置模型提示 */}
      {!configured && (
        <div className="bg-amber-950/70 border-b border-amber-800/70 px-3 py-2 flex items-center justify-between text-[11px] text-amber-200">
          <span className="flex items-center gap-1">
            <AlertCircle size={13} className="text-amber-400" />
            <span>尚未配置可用模型，Agent 无法工作。</span>
          </span>
          <button className="text-amber-300 hover:text-white underline cursor-pointer" onClick={onOpenSettings}>
            立即设置
          </button>
        </div>
      )}

      {/* 圈选目标卡片 */}
      {inspectTarget && (
        <div className="bg-sky-950/80 border-b border-sky-800/80 p-3 flex items-start justify-between text-xs animate-fadeIn">
          <div className="flex-1 pr-2 min-w-0">
            <div className="font-semibold text-sky-300 flex items-center gap-1.5 mb-1">
              <Target size={13} className="text-sky-400" />
              <span>已圈选中</span>
              <span className="text-[10px] bg-sky-800 text-sky-200 px-1.5 py-0.2 rounded font-mono font-bold">
                &lt;{inspectTarget.componentName || inspectTarget.tagName}&gt;
              </span>
              {inspectTarget.framework && inspectTarget.framework !== 'native-dom' && (
                <Tag color="blue">{inspectTarget.framework}</Tag>
              )}
            </div>
            {inspectTarget.sourceFile && (
              <div
                className={`font-mono text-[10px] truncate mb-0.5 ${
                  inspectTarget.sourceLocated === false ? 'text-amber-400' : 'text-sky-300'
                }`}
              >
                📍 {inspectTarget.sourceFile.split('/').pop() || inspectTarget.sourceFile}
                {inspectTarget.sourceLine ? ` : ${inspectTarget.sourceLine}` : ''}
                {inspectTarget.sourceLocated === false && ' (推断)'}
              </div>
            )}
            <div className="text-sky-200/80 font-mono text-[11px] truncate mb-0.5">
              {inspectTarget.className || inspectTarget.selector || '无选择器'}
            </div>
            {inspectTarget.text && (
              <div className="text-sky-300/70 italic text-[11px] truncate">"{inspectTarget.text}"</div>
            )}
          </div>
          <button onClick={onClearInspectTarget} className="text-sky-400 hover:text-white text-xs p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}

      {/* 圈改标注卡片 */}
      {markupAnnotations.length > 0 && (
        <div className="bg-amber-950/80 border-b border-amber-800/80 p-3 text-xs animate-fadeIn">
          <div className="font-semibold text-amber-300 mb-1.5 flex items-center gap-1">
            <Edit3 size={13} />
            <span>圈改标注需求 ({markupAnnotations.length} 处)</span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {markupAnnotations.map((m, i) => (
              <div
                key={m.id || i}
                className={`flex items-start justify-between gap-2 py-1 ${i > 0 ? 'border-t border-amber-800/50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5 mb-0.5">
                    <span className="font-mono text-[10px] text-amber-400">#{i + 1}</span>
                    {m.target ? (
                      <span className="px-1.5 rounded bg-amber-900/70 text-amber-200 font-mono text-[10px]">
                        📍 &lt;{targetLabel(m.target)}&gt;
                      </span>
                    ) : (
                      <span className="px-1.5 rounded bg-red-900/60 text-red-200 text-[10px]">未定位到元素</span>
                    )}
                  </div>
                  <div className="text-amber-200/90 text-[11px] leading-relaxed">"{m.note}"</div>
                </div>
                <button
                  onClick={() => onRemoveMarkupAnnotation(i)}
                  className="text-amber-400 hover:text-white text-xs p-1 cursor-pointer"
                  title="删除该批注"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 对话消息列表 */}
      <div ref={chatScrollEl} className="flex-1 overflow-y-auto p-4 space-y-5 select-text">
        {(currentPrototype?.chatMessages || []).map((msg, idx) => {
          const isUser = msg.role === 'user'
          return (
            <div
              key={idx}
              className={`group flex gap-3 w-full ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* 头像 */}
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center text-[11px] font-bold ${
                  isUser
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}
              >
                {isUser ? '我' : <Zap size={14} />}
              </div>

              {/* 消息内容容器 */}
              <div className={`flex-1 min-w-0 flex flex-col gap-1.5 ${isUser ? 'items-end' : ''}`}>
                <div
                  className={`text-[13px] leading-relaxed break-words ${
                    isUser
                      ? 'bg-sky-600/20 text-slate-100 px-3 py-2 rounded-2xl rounded-tr-sm max-w-[85%] border border-sky-500/30'
                      : 'w-full text-slate-200'
                  }`}
                >
                  {msg.inspectContext && (
                    <div className="mb-1.5 pb-1 border-b border-sky-500/25 text-[11px] text-sky-300 font-mono flex items-center gap-1">
                      <Target size={11} />
                      <span>锚点: &lt;{msg.inspectContext.tagName}&gt;</span>
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {msg.attachments.map((att, ai) => (
                        <span
                          key={ai}
                          className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 flex items-center gap-1"
                        >
                          <FileText size={10} />
                          <span>{att.name}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {isUser ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <Markdown>{msg.content}</Markdown>
                  )}
                </div>

                {/* 操作与元信息页脚 */}
                <div
                  className={`flex items-center gap-2 text-[10px] text-slate-500 transition ${
                    isUser ? 'flex-row-reverse opacity-0 group-hover:opacity-100' : ''
                  }`}
                >
                  <button
                    onClick={() => copyMessage(msg.content, idx)}
                    className="hover:text-slate-200 transition flex items-center gap-1 cursor-pointer"
                  >
                    {copiedIndex === idx ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span>{copiedIndex === idx ? '已复制' : '复制'}</span>
                  </button>
                  {!isUser && (
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  )}
                  {!isUser && msg.stats && (
                    <span>
                      · {msg.stats.totalTurns} 轮 ·{' '}
                      {(msg.stats.promptTokens + msg.stats.completionTokens).toLocaleString()} tok ·{' '}
                      {(msg.stats.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* 生成中状态块 */}
        {isGenerating && (
          <div className="flex gap-3 w-full animate-fadeIn">
            <div className="flex-shrink-0 w-7 h-7 rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center justify-center text-[11px] font-bold">
              <Zap size={14} className="animate-pulse" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-slate-300">
                  {runPhase === 'verifying'
                    ? `门禁验证运行结果…（第 ${gateRound} 轮）`
                    : runReasoning
                    ? `正在思考…（第 ${runTurn} 轮）`
                    : activeTool
                    ? `正在执行 ${activeTool}…`
                    : `Thunder Agent 正在组织代码…（第 ${runTurn} 轮）`}
                </span>
                <span className="text-slate-500 text-[11px] tabular-nums">
                  {(runElapsedMs / 1000).toFixed(1)}s
                </span>
                <button
                  onClick={handleCancelRun}
                  className="ml-auto px-2 py-0.5 rounded text-[11px] text-rose-400 hover:text-white hover:bg-rose-500/20 border border-rose-500/40 transition cursor-pointer flex items-center gap-1"
                >
                  <Square size={10} />
                  <span>停止</span>
                </button>
              </div>

              {(activeTool || toolCount > 0) && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  {activeTool && <span className="text-amber-300">⚙ {activeTool}…</span>}
                  {toolCount > 0 && <span>✓ {toolCount} 次工具执行</span>}
                  {toolFailed && <span className="text-rose-400">· 有工具失败</span>}
                </div>
              )}

              {runNotice && <div className="text-[11px] text-slate-500 whitespace-pre-wrap">{runNotice}</div>}

              {runStreamed && (
                <div className="text-[13px] leading-relaxed break-words text-slate-200 mt-2 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800">
                  <Markdown>{runStreamed}</Markdown>
                  <span className="inline-block w-1.5 h-3.5 bg-amber-400/80 align-middle animate-pulse ml-0.5"></span>
                </div>
              )}

              {/* AI 产品顾问交互式澄清问题卡片 (`ask_user_question`) */}
              {pendingQuestion && (
                <div className="mt-2 p-3 rounded-xl bg-indigo-950/60 border border-indigo-500/50 space-y-3 text-xs shadow-lg">
                  <div className="flex items-center justify-between border-b border-indigo-800/60 pb-2">
                    <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                      <Sparkles size={13} className="text-amber-400" />
                      <span>AI 产品顾问需要与你确认几个细节</span>
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/80 text-indigo-300">
                      共 {pendingQuestion.questions.length} 项
                    </span>
                  </div>

                  <div className="space-y-3">
                    {pendingQuestion.questions.map((q, qIdx) => {
                      const picked = questionSelections[qIdx] || []
                      return (
                        <div key={qIdx} className="space-y-1.5">
                          <div className="font-medium text-slate-100 leading-snug">
                            <span className="text-indigo-400 font-mono mr-1">{qIdx + 1}.</span>
                            {q.header && (
                              <span className="text-[10px] px-1.5 py-0.2 mr-1.5 rounded bg-slate-800 text-sky-300">
                                {q.header}
                              </span>
                            )}
                            <span>{q.question}</span>
                            {q.multi_select && (
                              <span className="text-[10px] text-slate-400 ml-1">（可多选）</span>
                            )}
                          </div>

                          {q.options && q.options.length > 0 && (
                            <div className="grid grid-cols-1 gap-1.5 pt-0.5">
                              {q.options.map((opt, oIdx) => {
                                const isSelected = picked.includes(opt.label)
                                return (
                                  <button
                                    key={oIdx}
                                    type="button"
                                    onClick={() =>
                                      handleToggleOption(qIdx, opt.label, q.multi_select)
                                    }
                                    className={`p-2 rounded-lg border text-left transition cursor-pointer ${
                                      isSelected
                                        ? 'bg-indigo-600/35 border-indigo-400 text-white shadow-sm'
                                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-300'
                                    }`}
                                  >
                                    <div className="font-medium text-[11px] flex items-center justify-between">
                                      <span>{opt.label}</span>
                                      {isSelected && <Check size={12} className="text-indigo-300" />}
                                    </div>
                                    {opt.description && (
                                      <div className="text-[10px] text-slate-400 mt-0.5">
                                        {opt.description}
                                      </div>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}

                          <input
                            type="text"
                            value={questionCustomText[qIdx] || ''}
                            onChange={(e) =>
                              setQuestionCustomText((prev) => ({
                                ...prev,
                                [qIdx]: e.target.value
                              }))
                            }
                            placeholder="或输入你的补充要求 / 自定义说明（可选）..."
                            className="w-full mt-1 px-2.5 py-1.5 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                          />
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-indigo-800/50">
                    <button
                      type="button"
                      disabled={submittingAnswer}
                      onClick={() => handleSubmitQuestionAnswers(true)}
                      className="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
                    >
                      跳过，由 AI 直接决定
                    </button>
                    <button
                      type="button"
                      disabled={submittingAnswer}
                      onClick={() => handleSubmitQuestionAnswers(false)}
                      className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] shadow cursor-pointer"
                    >
                      {submittingAnswer ? '提交中...' : '确认回答并开始生成'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="p-3 border-t border-slate-800 bg-slate-900">
        {/* 附件 Chips */}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[11px]"
              >
                {att.kind === 'image' ? (
                  <img src={att.previewUrl} alt={att.name} className="h-7 w-7 rounded object-cover" />
                ) : (
                  <FileText size={13} className="text-slate-400" />
                )}
                <span className="max-w-[120px] truncate text-slate-300 font-mono text-[10px]">
                  {att.name}
                </span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="text-slate-500 hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 文本输入与外框 */}
        <div
          className="rounded-lg border border-slate-700 bg-slate-800 focus-within:ring-1 focus-within:ring-sky-500 transition"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <textarea
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            disabled={isGenerating}
            placeholder={
              inspectTarget
                ? '针对圈选区域输入修改意见 (如：把按钮改为深色、加一个导出操作)...'
                : '输入原型需求 (如：新增带有状态筛选的结算审核单表格)...'
            }
            className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs rounded-lg p-2.5 resize-none focus:outline-none disabled:opacity-50"
            rows={3}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />

          {/* 指标状态条 */}
          <div className="flex items-center gap-3 border-t border-slate-700/60 px-2.5 py-1 text-[10px] font-mono text-slate-400 tabular-nums">
            <span>⚡ {metricsTps !== null ? `${metricsTps.toFixed(1)} tok/s` : '— tok/s'}</span>
            <span>
              上下文 {contextUsedTokens ? contextUsedTokens.toLocaleString() : '0'} /{' '}
              {contextWindowLimit >= 1000 ? `${Math.round(contextWindowLimit / 1000)}k` : contextWindowLimit} (
              <span className={contextPercent >= 80 ? 'text-amber-400 font-bold' : ''}>{contextPercent}%</span>)
            </span>
          </div>

          {/* 底部动作条 */}
          <div className="flex items-center justify-between border-t border-slate-700/60 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.vue,.html,.css"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition cursor-pointer"
                disabled={isGenerating}
                title="添加图片或文本附件"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={13} />
              </button>

              {/* 模型选择器 */}
              <Dropdown menu={{ items: modelMenuItems }} trigger={['click']} disabled={envLocked || isGenerating}>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200 hover:border-slate-600 transition cursor-pointer"
                  title="选择模型"
                >
                  {selectedModel && getProviderIcon(selectedModel.provider, 12)}
                  <span className="max-w-[100px] truncate">{selectedModel?.name || selectionId || '选择模型'}</span>
                </button>
              </Dropdown>

              {/* 思考档位 */}
              <Dropdown menu={{ items: thinkingMenuItems }} trigger={['click']} disabled={envLocked || isGenerating}>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200 hover:border-slate-600 transition cursor-pointer"
                  title="思考档位"
                >
                  <Sparkles size={11} className="text-amber-400" />
                  <span>{thinkingLevel ? thinkingLevel.toUpperCase() : 'OFF'}</span>
                </button>
              </Dropdown>
            </div>

            {/* 发送 / 停止按钮 */}
            {isGenerating ? (
              <button
                onClick={handleCancelRun}
                className="flex h-7 px-2.5 items-center justify-center rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium gap-1 shadow transition cursor-pointer"
              >
                <Square size={11} />
                <span>停止</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!promptInput.trim() && pendingAttachments.length === 0}
                className="flex h-7 px-2.5 items-center justify-center rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white text-xs font-medium gap-1 shadow transition cursor-pointer"
              >
                <Send size={11} />
                <span>发送</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
