import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { message, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  Zap,
  Settings,
  Trash2,
  Paperclip,
  X,
  Target,
  Edit3,
  FileText,
  AlertCircle,
  Sparkles,
  ArrowUp,
  CornerDownLeft,
  Bot,
  ChevronRight
} from 'lucide-react'
import { Tag } from '@lobehub/ui'
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
  useCurrentPrototype
} from '../../stores/usePrototypeStore'
import {
  useAgentModelConfigStore,
  useGroupedModels,
  useSelectedModel
} from '../../stores/useAgentModelConfigStore'
import { useAgentChatStream } from './useAgentChatStream'
import { ChatMessageItem } from './ChatMessageItem'
import { ChatQuestionBubble } from './ChatQuestionBubble'
import { ChatEmptyState } from './ChatEmptyState'
import './chat.css'

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

function formatCompactTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${Math.round(num / 1_000)}k`
  return String(num)
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) {
    const rem = Math.round(totalSec % 60)
    return rem === 60 ? `${totalMin + 1}m` : `${totalMin}m ${String(rem).padStart(2, '0')}s`
  }
  const hours = Math.floor(totalMin / 60)
  const remMin = Math.round((totalMin % 60))
  return remMin === 60 ? `${hours + 1}h` : `${hours}h ${String(remMin).padStart(2, '0')}m`
}

/** 取光标处的 `#路径` token（含起始偏移），没有则返回 null。 */
function hashTokenAtCursor(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const match = /#([a-zA-Z0-9_\-./]*)$/.exec(before)
  if (!match) return null
  return { start: match.index, query: match[1] || '' }
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
  const { addChatMessage, resetChat, updateTechStack, truncateChat } = usePrototypeStore()

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
  const [cursorPos, setCursorPos] = useState(0)
  const [fileSuggestActive, setFileSuggestActive] = useState(0)
  const [fileSuggestDismissed, setFileSuggestDismissed] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollEl = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** 为 true 时跟随最新内容；用户上滚后停止。 */
  const stickToBottom = useRef(true)
  const lastInstructionLabel = useRef('')

  // Attachments
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])

  const scrollToBottom = useCallback((force = false) => {
    const node = chatScrollEl.current
    if (!node) return
    if (!force && !stickToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [])

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    if (node.clientHeight <= 0) return
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
  }

  // ============ 流式运行（LiveSegment 时序模型 + 指标 + 问题卡 + steer） ============
  const stream = useAgentChatStream({
    contextWindowLimit: selectedModel?.contextWindow,
    onCodeUpdated: (code, techStack, previewUrl, entryFile) => {
      onCodeUpdated(code, lastInstructionLabel.current, techStack, previewUrl, entryFile)
      if (techStack && currentPrototype && techStack !== currentPrototype.techStack) {
        updateTechStack(currentPrototype.id, techStack as any, entryFile)
      }
    }
  })

  useEffect(() => {
    scrollToBottom()
  }, [currentPrototype?.chatMessages?.length, stream.liveSegments, stream.pendingQuestion, scrollToBottom])

  // 切换项目重置累计指标
  useEffect(() => {
    stream.resetSessionCounters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrototype?.id])

  // ============ 附件处理 ============
  const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const MAX_ATTACHMENTS = 10
  const MAX_TEXT_BYTES = 64 * 1024

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
      reader.readAsDataURL(file)
    })

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
    if (e.target.files?.length) await addFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/'))
    if (!items.length) return
    e.preventDefault()
    await addFiles(items.map((i) => i.getAsFile()).filter((f): f is File => !!f))
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

  // ============ # 文件路径补全 ============
  const hashToken = useMemo(
    () => hashTokenAtCursor(promptInput, cursorPos),
    [promptInput, cursorPos]
  )

  const fileSuggestions = useMemo(() => {
    if (!hashToken) return []
    const q = hashToken.query.toLowerCase()
    const files = currentPrototype?.files || []
    return files
      .filter((f) => !q || f.toLowerCase().includes(q))
      .slice(0, 12)
  }, [hashToken, currentPrototype?.files])

  const fileSuggestOpen =
    Boolean(hashToken) && !fileSuggestDismissed && fileSuggestions.length > 0 && !stream.isStreaming

  useEffect(() => {
    setFileSuggestActive(0)
    setFileSuggestDismissed(false)
  }, [hashToken?.start, hashToken?.query])

  const acceptFileSuggestion = (filePath: string) => {
    if (!hashToken) return
    const inserted = `#${filePath} `
    const next = `${promptInput.slice(0, hashToken.start)}${inserted}${promptInput.slice(cursorPos)}`
    const nextCursor = hashToken.start + inserted.length
    setPromptInput(next)
    setFileSuggestDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(nextCursor, nextCursor)
      }
      setCursorPos(nextCursor)
    })
  }

  // ============ 提示词组装 ============
  const componentLabel = (t: any): string => {
    const comp = String(t?.componentName || '')
    const tag = String(t?.tagName || '')
    return comp && comp.toLowerCase() !== tag.toLowerCase() ? comp : ''
  }

  const targetLabel = (t: any): string => componentLabel(t) || String(t?.selector || t?.tagName || '')

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

  /** 读取 #引用 的项目文件，编译成 [Referenced File] 上下文块。 */
  const compileReferencedFiles = async (rawText: string): Promise<string[]> => {
    if (!currentPrototype || !window.prototypeApi?.readFile) return []
    const paths = new Set<string>()
    for (const m of rawText.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g)) {
      if (m[1]) paths.add(m[1])
    }
    const blocks: string[] = []
    for (const filePath of paths) {
      try {
        const res = await window.prototypeApi.readFile({
          id: currentPrototype.id,
          filePath
        })
        if (res?.ok && typeof res.content === 'string' && res.content.trim()) {
          const body = res.content.slice(0, MAX_TEXT_BYTES).trim()
          const fence = body.includes('```') ? '````' : '```'
          blocks.push(
            `[Referenced File: ${filePath}${res.content.length > MAX_TEXT_BYTES ? ' (truncated)' : ''}]\n${fence}\n${body}\n${fence}\n[End Referenced File]`
          )
        }
      } catch {
        // 文件可能不存在；静默跳过
      }
    }
    return blocks
  }

  // ============ 发送 ============
  const doSend = async (rawText?: string, directPrompt?: string) => {
    if (stream.isStreaming || !currentPrototype) return

    const text = (directPrompt ?? rawText ?? promptInput).trim()
    const staged = pendingAttachments
    if ((!text && staged.length === 0) || !currentPrototype) return

    const target = inspectTarget
    const markups = markupAnnotations
    const textFiles = staged.filter((a) => a.kind === 'text')
    const images = staged.filter((a) => a.kind === 'image')

    const blocks: string[] = []
    if (directPrompt) {
      blocks.push(directPrompt)
    } else {
      if (target) blocks.push(buildInspectInstruction(target))
      if (markups.length) blocks.push(buildMarkupInstruction(markups))
      const notes = new Set(markups.map((m) => (m.note || '').trim()))
      const mainText = text && !notes.has(text) ? text : ''
      const textFileBlocks = textFiles.map((f) => {
        const body = (f.text ?? '').trim()
        const fence = body.includes('```') ? '````' : '```'
        return `[Referenced File: ${f.name}${f.truncated ? ' (truncated)' : ''}]\n${fence}\n${body}\n${fence}\n[End Referenced File]`
      })
      const b = [...textFileBlocks, ...(await compileReferencedFiles(text)), mainText].filter(Boolean)
      blocks.push(...b)
    }

    let instruction = blocks.filter(Boolean).join('\n')
    if (!instruction && images.length) instruction = '请分析这张图片。'

    const stackHeader =
      currentPrototype.techStack && currentPrototype.techStack !== 'vue3-element'
        ? `【当前技术栈】: ${currentPrototype.techStack}（请保持该栈）\n`
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
    lastInstructionLabel.current = instruction.slice(0, 40)
    stickToBottom.current = true

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const res = await stream.startRun({
      runId,
      prototypeId: currentPrototype.id,
      prompt: instruction,
      code: currentPrototype.vueCode,
      history,
      inspectTarget: target ? (target as any) : undefined,
      markupTargets: markups.length ? (markups as any) : undefined,
      attachments: outgoingImages.length ? outgoingImages : undefined
    })

    if (!res.ok) {
      const errText = (res.error || '未知错误').trim()
      const partial = res.partialContent?.trim()
      addChatMessage(currentPrototype.id, {
        role: 'assistant',
        content:
          `⚠️ **本次生成中断**\n\n${errText}` +
          (partial ? `\n\n---\n\n**中断前已生成的部分内容：**\n\n${partial}` : ''),
        timestamp: Date.now()
      })
      return
    }

    if (res.code && res.code !== currentPrototype.vueCode) {
      onCodeUpdated(res.code, lastInstructionLabel.current, res.techStack)
      if (res.techStack && res.techStack !== currentPrototype.techStack) {
        updateTechStack(currentPrototype.id, res.techStack as any)
      }
    }

    const metrics = stream.getLastRunMetrics()
    const stats = metrics
      ? {
          totalTurns: 0,
          promptTokens: metrics.promptTokens ?? 0,
          completionTokens: metrics.completionTokens ?? 0,
          durationMs: metrics.durationMs ?? 0,
          toolExecutions: 0,
          tokensPerSecond: metrics.tps
        }
      : undefined

    addChatMessage(currentPrototype.id, {
      role: 'assistant',
      content: res.finalContent?.trim() || '已完成本次原型修改。',
      timestamp: Date.now(),
      stats
    })
  }

  const handleSendClick = () => {
    if (stream.isStreaming) {
      void stream.cancelRun()
    } else if (promptInput.trim() || pendingAttachments.length > 0) {
      void doSend()
    }
  }

  /** 运行中：Enter=steer，⌥Enter=follow_up；都不打断正在执行的工具。 */
  const handleSteer = async (altKey: boolean) => {
    const text = promptInput.trim()
    if (!text) return
    const ok = await (altKey ? stream.followUp(text) : stream.steer(text))
    if (ok) setPromptInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (fileSuggestOpen && fileSuggestions.length > 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setFileSuggestDismissed(true)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFileSuggestActive((prev) => (prev + 1) % fileSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFileSuggestActive((prev) => (prev - 1 + fileSuggestions.length) % fileSuggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        const pick = fileSuggestions[fileSuggestActive] ?? fileSuggestions[0]
        if (pick) acceptFileSuggestion(pick)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (stream.isStreaming) {
        void handleSteer(e.altKey)
        return
      }
      if (promptInput.trim() || pendingAttachments.length > 0) {
        void doSend()
      }
    }
  }

  /** 引用用户消息到输入框编辑。 */
  const handleEditQuote = (text: string) => {
    setPromptInput(text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
        setCursorPos(el.value.length)
      }
    })
  }

  /** 重发某条用户消息：截断其后会话（新 thunder 会话）再原样发送。 */
  const handleResend = async (index: number) => {
    if (!currentPrototype || stream.isStreaming) return
    const target = currentPrototype.chatMessages[index]
    if (!target || target.role !== 'user') return
    const content = target.content
    truncateChat(currentPrototype.id, index)
    await new Promise((r) => setTimeout(r, 150))
    await doSend(undefined, content)
  }

  /** 重新生成：回退到上一条用户消息并重发（新会话）。 */
  const handleRegenerate = async (assistantIndex: number) => {
    if (!currentPrototype || stream.isStreaming) return
    let userIndex = -1
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (currentPrototype.chatMessages[i]?.role === 'user') {
        userIndex = i
        break
      }
    }
    if (userIndex === -1) return
    const content = currentPrototype.chatMessages[userIndex].content
    truncateChat(currentPrototype.id, userIndex)
    await new Promise((r) => setTimeout(r, 150))
    await doSend(undefined, content)
  }

  // ============ 模型 / 思考档位菜单 ============
  const modelMenuItems: MenuProps['items'] = groupedModels.flatMap((group) => [
    {
      type: 'group' as const,
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

  // ============ 指标条数值 ============
  const { lastRunMetrics: m, streamingMetrics: sm } = stream
  const contextLimit = selectedModel?.contextWindow || 0
  const draftTokens = promptInput.trim() ? Math.max(1, Math.ceil(promptInput.trim().length / 3)) : 0
  const ctxWithDraft = stream.currentContextTokens + draftTokens
  const ctxPercent =
    contextLimit > 0 ? Math.min(100, Math.round((ctxWithDraft / contextLimit) * 100)) : null
  const cacheCount = m?.cachedTokens ?? 0
  const cacheHit = cacheCount > 0 && (m?.promptTokens ?? 0) > 0
  const cachePct = cacheHit ? ((cacheCount / (m!.promptTokens as number)) * 100).toFixed(0) : null

  const chatMessages = currentPrototype?.chatMessages || []
  const isEmptyConversation =
    chatMessages.length === 0 ||
    (chatMessages.length === 1 && chatMessages[0].role === 'assistant')
  const hasQuestion = Boolean(stream.pendingQuestion && stream.pendingQuestion.questions.length > 0)

  // textarea 自适应高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 38), 180)}px`
  }, [promptInput])

  return (
    <section className="pc-chat-root w-96 flex flex-col border-r border-slate-800 bg-slate-900/90 z-10 flex-shrink-0 select-none">
      {/* 顶部 Header */}
      <header className="app-drag h-14 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900 flex-shrink-0">
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
            <span className="truncate">
              {configured ? selectedModel?.name || selectionId : '未配置模型'}
            </span>
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
        <div className="bg-amber-950/70 border-b border-amber-800/70 px-3 py-2 flex items-center justify-between text-[11px] text-amber-200 flex-shrink-0">
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
        <div className="bg-sky-950/80 border-b border-sky-800/80 p-3 flex items-start justify-between text-xs animate-fadeIn flex-shrink-0">
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
        <div className="bg-amber-950/80 border-b border-amber-800/80 p-3 text-xs animate-fadeIn flex-shrink-0">
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

      {/* 消息流 / 空状态 */}
      <div className="pc-feed" ref={chatScrollEl} onScroll={handleScroll}>
        {isEmptyConversation && !stream.isStreaming ? (
          <ChatEmptyState
            scenario={currentPrototype?.scenario}
            projectName={currentPrototype?.name}
            onSelectPrompt={(prompt) => void doSend(undefined, prompt)}
          />
        ) : (
          <div className="pc-messages">
            {chatMessages.map((msg, idx) => (
              <ChatMessageItem
                key={idx}
                message={msg}
                index={idx}
                onEdit={handleEditQuote}
                onResend={handleResend}
                onRegenerate={handleRegenerate}
              />
            ))}

            {/* 实时流式回合（时序 segments） */}
            {stream.isStreaming && (
              <ChatMessageItem
                message={{ role: 'assistant', content: '', timestamp: Date.now() }}
                index={chatMessages.length}
                isStreaming
                segments={stream.liveSegments}
              />
            )}

          </div>
        )}
      </div>

      {/* 底部输入区：问题卡停靠 + 队列徽章 + Composer */}
      <div className="pc-composer-zone">
        {hasQuestion && stream.pendingQuestion && (
          <ChatQuestionBubble
            question={stream.pendingQuestion}
            onAnswer={(answers, cancelled) => void stream.answerQuestion(answers, cancelled)}
            onDismiss={() => void stream.dismissQuestion()}
          />
        )}

        {stream.isStreaming && stream.queuedCount > 0 && (
          <div className="pc-queued">
            <strong>📥 已排队 {stream.queuedCount} 条</strong>
            <span>Enter 插话 · ⌥Enter 追问</span>
          </div>
        )}

        <div className="pc-composer" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
          {/* 附件 chips */}
          {pendingAttachments.length > 0 && (
            <div className="pc-attachments">
              {pendingAttachments.map((att) => (
                <div key={att.id} className="pc-attachment-chip">
                  {att.kind === 'image' ? (
                    <img src={att.previewUrl} alt={att.name} />
                  ) : (
                    <FileText size={12} className="text-slate-400" />
                  )}
                  <span className="pc-attachment-name">{att.name}</span>
                  <button
                    type="button"
                    className="pc-attachment-remove"
                    onClick={() => removeAttachment(att.id)}
                    title="移除"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 输入框 */}
          <textarea
            ref={textareaRef}
            className="pc-composer-textarea"
            value={promptInput}
            disabled={false}
            onChange={(e) => {
              setPromptInput(e.target.value)
              setCursorPos(e.currentTarget.selectionStart || e.target.value.length)
              setFileSuggestDismissed(false)
            }}
            onSelect={(e) => setCursorPos(e.currentTarget.selectionStart || 0)}
            onClick={(e) => setCursorPos(e.currentTarget.selectionStart || 0)}
            onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart || 0)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={
              stream.isStreaming
                ? '运行中：Enter 插话引导（⌥Enter 待本轮结束后追问）...'
                : inspectTarget
                  ? '针对圈选区域输入修改意见（输入 # 可引用项目文件）...'
                  : '描述你的产品需求（输入 # 可引用项目文件）...'
            }
            rows={2}
          />

          {/* # 文件补全 */}
          {fileSuggestOpen && (
            <ul className="pc-file-suggest" role="listbox" aria-label="项目文件">
              {fileSuggestions.map((filePath, index) => (
                <li
                  key={filePath}
                  role="option"
                  aria-selected={index === fileSuggestActive}
                  className={index === fileSuggestActive ? 'is-active' : ''}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => acceptFileSuggestion(filePath)}
                >
                  <FileText size={12} className="text-sky-400 shrink-0" />
                  <span className="pc-file-suggest-path">{filePath}</span>
                  <span className="pc-file-suggest-kbd">Tab</span>
                </li>
              ))}
            </ul>
          )}

          {/* 指标条 */}
          <div className="pc-metrics">
            <div className="pc-metrics-group">
              {stream.isStreaming ? (
                <>
                  <span className="pc-metrics-pulse" />
                  <span className="pc-metrics-speed">
                    ⚡ {sm.tps > 0 ? sm.tps.toFixed(1) : '0.0'} tok/s
                  </span>
                  <span className="pc-metrics-divider" />
                  <span>
                    {sm.tokensCount} tokens
                    {sm.reasoningCount > 0 ? `（含思考 ${sm.reasoningCount}）` : ''}
                  </span>
                </>
              ) : m && (m.totalTokens || m.tps) ? (
                <>
                  {m.tps && m.tps > 0 ? (
                    <>
                      <span className="pc-metrics-speed">⚡ {m.tps.toFixed(1)} tok/s</span>
                      <span className="pc-metrics-divider" />
                    </>
                  ) : null}
                  <span>
                    本轮: {m.totalTokens?.toLocaleString() ?? '—'}
                    {m.promptTokens !== undefined && m.completionTokens !== undefined ? (
                      <span style={{ color: 'var(--pc-text-3)' }}>
                        {' '}
                        (In {m.promptTokens.toLocaleString()} · Out {m.completionTokens.toLocaleString()}
                        {m.reasoningTokens ? ` · 思考 ${m.reasoningTokens.toLocaleString()}` : ''})
                      </span>
                    ) : null}
                  </span>
                </>
              ) : (
                <span className="pc-metrics-speed">⚡ 就绪</span>
              )}

              {m ? (
                <>
                  <span className="pc-metrics-divider" />
                  <span
                    className={`pc-metrics-cache${cacheCount === 0 ? ' is-zero' : ''}`}
                    title={
                      cacheHit
                        ? `Prompt Cache 命中 ${cacheCount.toLocaleString()} tokens`
                        : 'Prompt Cache 未命中'
                    }
                  >
                    Cache {cacheCount.toLocaleString()}
                    {cachePct ? ` (${cachePct}%)` : ''}
                  </span>
                </>
              ) : null}
            </div>

            <div className="pc-metrics-group">
              <span title={`当前上下文占用 / 模型窗口：${ctxWithDraft.toLocaleString()}${contextLimit ? ` / ${contextLimit.toLocaleString()}` : ''}`}>
                上下文{' '}
                <span className="pc-metrics-value">
                  {ctxWithDraft.toLocaleString()}
                  {contextLimit ? ` / ${formatCompactTokens(contextLimit)}` : ''}
                </span>
                {ctxPercent !== null && (
                  <span className={`pc-metrics-percent${ctxPercent >= 80 ? ' is-warning' : ''}`}>
                    {' '}
                    ({ctxPercent}%)
                  </span>
                )}
              </span>
              <span className="pc-metrics-divider" />
              <span title="当前会话累计消耗">
                总消耗 <span className="pc-metrics-value">{stream.sessionTotalTokens.toLocaleString()}</span>
              </span>
              {m?.durationMs ? (
                <>
                  <span className="pc-metrics-divider" />
                  <span title="本轮总耗时">
                    总耗时 <span className="pc-metrics-value">{formatDuration(m.durationMs)}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {/* 工具栏 */}
          <div className="pc-toolbar">
            <div className="pc-toolbar-left">
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
                className="pc-action-btn has-label"
                disabled={stream.isStreaming}
                onClick={() => fileInputRef.current?.click()}
                title="添加图片或文本附件"
              >
                <Paperclip size={12} />
              </button>

              {/* 模型选择 */}
              <Dropdown menu={{ items: modelMenuItems }} trigger={['click']} disabled={envLocked || stream.isStreaming}>
                <button
                  type="button"
                  className="pc-action-btn has-label"
                  title="选择模型"
                >
                  {selectedModel && getProviderIcon(selectedModel.provider, 11)}
                  <span className="max-w-[90px] truncate">{selectedModel?.name || selectionId || '选择模型'}</span>
                </button>
              </Dropdown>

              {/* 思考档位 */}
              <Dropdown menu={{ items: thinkingMenuItems }} trigger={['click']} disabled={envLocked || stream.isStreaming}>
                <button type="button" className="pc-action-btn has-label" title="思考档位">
                  <Sparkles size={11} className="text-amber-400" />
                  <span>{thinkingLevel ? thinkingLevel.toUpperCase() : 'OFF'}</span>
                </button>
              </Dropdown>
            </div>

            {stream.isStreaming ? (
              <button
                type="button"
                className="pc-send-btn is-stop"
                onClick={() => void stream.cancelRun()}
                title="停止任务"
              >
                <span className="pc-stop-icon" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                className="pc-send-btn"
                onClick={handleSendClick}
                disabled={!promptInput.trim() && pendingAttachments.length === 0}
                title={stream.isStreaming ? '停止' : '发送 (Enter)'}
              >
                <ArrowUp size={12} />
                <span>发送</span>
              </button>
            )}
          </div>
        </div>

        {/* 运行提示行 */}
        {stream.isStreaming && (
          <div className="flex items-center gap-2 mt-1.5 text-[10.5px] text-slate-400 font-mono px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>Agent 运行中 {(stream.elapsedMs / 1000).toFixed(1)}s</span>
            <span className="text-slate-600">·</span>
            <CornerDownLeft size={10} />
            <span>Enter 插话</span>
            <ChevronRight size={9} className="text-slate-600" />
            <span>⌥Enter 追问</span>
          </div>
        )}
      </div>
    </section>
  )
}
