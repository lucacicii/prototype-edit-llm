import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ResizeHandle } from '../ResizeHandle'
import {
  useWorkspaceChatStore,
  workspaceSessionKey
} from '../../stores/useWorkspaceChatStore'
import {
  usePrototypeStore,
  useCurrentPrototype,
  type PrototypeChatMessage
} from '../../stores/usePrototypeStore'
import {
  useAgentModelConfigStore,
  useGroupedModels,
  useSelectedModel
} from '../../stores/useAgentModelConfigStore'
import { useMaterialStore } from '../../stores/useMaterialStore'
import { useAgentChatStream } from './useAgentChatStream'
import { ChatHeader } from './ChatHeader'
import { ChatContextBanners } from './ChatContextBanners'
import { ChatFeed } from './ChatFeed'
import { ChatComposer } from './ChatComposer'
import { ChatQuestionBubble } from './ChatQuestionBubble'
import { useChatAttachments } from './useChatAttachments'
import { useFileSuggestions } from './useFileSuggestions'
import { TurnDots, TurnDetailOverlay } from './TurnDots'
import { getProviderIcon } from './providerIcon'
import {
  buildInspectInstruction,
  buildMarkupInstruction,
  compileReferencedFiles,
  fencedBlock
} from './chatPrompt'
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

interface ChatPanelProps {
  /** 当前工作区；非默认工作区时对话与 agent 会话独立于原型项目。 */
  currentWorkspace?: { id: string; name: string } | null
  onOpenSettings: () => void
  collapsed: boolean
  width: number
  onWidthChange: (w: number) => void
  onResizeDragChange: (dragging: boolean) => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
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
    entryFile?: string,
    /** 产生这次代码更新的原型（run 期间用户可能已切走）。 */
    prototypeId?: string
  ) => void
  /** 本轮原型 run 是否在跑；工作区那边靠它禁用「生成拓扑图」。 */
  onStreamingChange?: (streaming: boolean) => void
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  currentWorkspace,
  onOpenSettings,
  inspectTarget,
  onClearInspectTarget,
  markupAnnotations,
  onRemoveMarkupAnnotation,
  onClearSelectionState,
  onCodeUpdated,
  collapsed,
  width,
  onWidthChange,
  onResizeDragChange,
  sidebarCollapsed,
  onToggleSidebar,
  onStreamingChange
}) => {
  const currentPrototype = useCurrentPrototype()
  const {
    addChatMessage: addPrototypeChatMessage,
    updateTechStack,
    truncateChat: truncatePrototypeChat
  } = usePrototypeStore()
  const wsChats = useWorkspaceChatStore((s) => s.chats)
  const addWorkspaceMessage = useWorkspaceChatStore((s) => s.addMessage)
  const truncateWorkspaceChat = useWorkspaceChatStore((s) => s.truncate)

  // 会话归属：外部工作区用工作区自己的对话，否则跟当前原型走。
  const externalWs =
    currentWorkspace && currentWorkspace.id !== 'default-host' ? currentWorkspace : null
  const wsChat = externalWs ? wsChats[externalWs.id] : undefined
  /** 对话的稳定 id（草稿、消息存取用）。 */
  const convId = externalWs ? externalWs.id : currentPrototype?.id
  /** 发给 agent 的会话键；run 归属也以它为准。 */
  const runKey = externalWs
    ? workspaceSessionKey(externalWs.id, wsChat?.epoch ?? 0)
    : currentPrototype?.id
  const convMessages = externalWs ? wsChat?.messages ?? [] : currentPrototype?.chatMessages ?? []

  const addChatMessage = (_id: string, message: PrototypeChatMessage) => {
    if (externalWs) addWorkspaceMessage(externalWs.id, message)
    else addPrototypeChatMessage(_id, message)
  }
  const truncateChat = (_id: string, keepCount: number) =>
    externalWs ? truncateWorkspaceChat(externalWs.id, keepCount) : truncatePrototypeChat(_id, keepCount)

  const {
    selectionId,
    thinkingLevel,
    configured,
    selectModel,
    selectThinkingLevel
  } = useAgentModelConfigStore()

  const groupedModels = useGroupedModels()
  const selectedModel = useSelectedModel()
  const materials = useMaterialStore((s) => s.materials)

  const [promptInput, setPromptInput] = useState('')
  /** 打开的是第几轮（`stream.turns` 的下标）；null = 抽屉关着。 */
  const [openTurnIndex, setOpenTurnIndex] = useState<number | null>(null)
  const [cursorPos, setCursorPos] = useState(0)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollEl = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** 为 true 时跟随最新内容；用户上滚后停止。 */
  const stickToBottom = useRef(true)
  const lastInstructionLabel = useRef('')

  /**
   * 用户正在消息流里按住拖选正文。
   *
   * 流式期间每个 token 都会触发一次 scrollToBottom()，若拖选过程中视口被拽到底部，
   * 拖出来的选区会随锚点一起漂走 —— 正文可选中了却选不住，等于没修。所以拖选期间
   * 挂起自动跟随（只挂起，不改 stickToBottom：松手后用户若本来就在底部，继续跟随）。
   */
  const selectingInFeed = useRef(false)

  const scrollToBottom = useCallback((force = false) => {
    const node = chatScrollEl.current
    if (!node) return
    if (selectingInFeed.current) return
    if (!force && !stickToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [])

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    if (node.clientHeight <= 0) return
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
  }

  // 拖选挂起/恢复：mouseup 挂在 window 上 —— 拖到面板外松手（选区越出滚动区很常见）
  // 也必须能恢复，只监听元素自己会漏。
  const handleFeedMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // 只认左键，且只认真正的正文区；点在按钮/卡片上不是拖选
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea, [role="button"]')) return
    selectingInFeed.current = true
  }

  useEffect(() => {
    const release = () => {
      selectingInFeed.current = false
    }
    window.addEventListener('mouseup', release)
    // 兜底：拖到窗口外松手（或窗口失焦）时 mouseup 可能永远不来，
    // 挂起状态不清就会让自动跟随从此失效。
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  // ============ 流式运行（LiveSegment 时序模型 + 指标 + 问题卡 + steer） ============
  const stream = useAgentChatStream({
    contextWindowLimit: selectedModel?.contextWindow,
    onCodeUpdated: (code, techStack, previewUrl, entryFile, runPrototypeId) => {
      // 归属以发起 run 的原型为准，而不是「此刻正在看的」那个。
      const owner = usePrototypeStore.getState().prototypes.find((p) => p.id === runPrototypeId)
      // 外部工作区的 run 不属于任何原型：代码不写回原型，由主进程直接刷新预览。
      if (!owner) return
      onCodeUpdated(code, lastInstructionLabel.current, techStack, previewUrl, entryFile, owner.id)
      if (techStack && techStack !== owner.techStack) {
        updateTechStack(owner.id, techStack as any, entryFile)
      }
    }
  })

  /** 正在跑的 run 属于当前项目才展示流式内容；别的项目在跑时只当作「忙」。 */
  const streamHere = stream.isStreaming && stream.runPrototypeId === runKey
  const runElsewhere = stream.isStreaming && !streamHere

  /**
   * 轮次圆点覆盖**跑完仍在看**的那一次 run：跑完不立刻消失，切走项目才隐藏。
   * 换原型时 `lastRunPrototypeId` 与新 run 的归属一起变，所以不会串台。
   */
  const turnsHere = stream.turns.length > 0 && stream.lastRunPrototypeId === runKey

  /**
   * 切项目、或新 run 开始时把抽屉收起来，避免它指向另一批轮次。
   * 注意**不**在 run 结束时关：那时轮刚冻结，用户往往正开着抽屉看它收尾。
   */
  const lastActiveRunIdRef = useRef<string | null>(null)
  useEffect(() => {
    const nextRunId = stream.activeRunId
    if (nextRunId && nextRunId !== lastActiveRunIdRef.current) setOpenTurnIndex(null)
    lastActiveRunIdRef.current = nextRunId
  }, [stream.activeRunId])

  useEffect(() => {
    setOpenTurnIndex(null)
  }, [convId])

  // 主进程那边的串行守卫才是硬保证，这里只是让「生成拓扑图」在 run 期间看着就是不可点的。
  useEffect(() => {
    onStreamingChange?.(stream.isStreaming)
  }, [stream.isStreaming, onStreamingChange])

  useEffect(() => {
    scrollToBottom()
  }, [convMessages.length, stream.liveSegments, stream.pendingQuestion, scrollToBottom])

  // 切换项目：重置累计指标、按项目保存/恢复草稿、清空附件与补全状态、滚到底
  const draftsRef = useRef<Map<string, string>>(new Map())
  const prevProtoIdRef = useRef<string | undefined>(convId)
  useEffect(() => {
    const prevId = prevProtoIdRef.current
    const nextId = convId
    if (prevId === nextId) return
    if (prevId) draftsRef.current.set(prevId, promptInput)
    prevProtoIdRef.current = nextId
    setPromptInput(nextId ? draftsRef.current.get(nextId) ?? '' : '')
    setCursorPos(0)
    setPendingAttachments([])
    // 别的项目正在跑时，当前这个项目的指标不该被清掉后又被它的事件污染，
    // 但也没有可展示的指标，重置即可。
    if (!stream.isStreaming) stream.resetSessionCounters()
    stickToBottom.current = true
    requestAnimationFrame(() => scrollToBottom(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  // ============ 附件处理 ============
  const {
    pendingAttachments,
    setPendingAttachments,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    removeAttachment
  } = useChatAttachments()

  // ============ # 文件路径补全 ============
  const fileSuggest = useFileSuggestions({
    promptInput,
    cursorPos,
    projectFiles: externalWs ? [] : currentPrototype?.files || [],
    materialFiles: materials.map((m) => `materials/${m.fileName}`),
    enabled: !stream.isStreaming,
    onAccept: (nextValue, nextCursor) => {
      setPromptInput(nextValue)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(nextCursor, nextCursor)
        }
        setCursorPos(nextCursor)
      })
    }
  })

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
      const textFileBlocks = textFiles.map((f) =>
        fencedBlock(`Referenced File: ${f.name}`, f.text ?? '', { truncated: f.truncated })
      )
      const referenced = await compileReferencedFiles(text, {
        externalWorkspace: Boolean(externalWs),
        prototypeId: currentPrototype.id
      })
      blocks.push(...[...textFileBlocks, ...referenced, mainText].filter(Boolean))
    }

    let instruction = blocks.filter(Boolean).join('\n')
    if (!instruction && images.length) instruction = '请分析这张图片。'

    const stackHeader =
      !externalWs && currentPrototype.techStack && currentPrototype.techStack !== 'vue3-element'
        ? `【当前技术栈】: ${currentPrototype.techStack}（请保持该栈）\n`
        : ''
    instruction = stackHeader + instruction

    const history = convMessages
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
      prototypeId: runKey ?? currentPrototype.id,
      prompt: instruction,
      code: externalWs ? '' : currentPrototype.vueCode,
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

    if (!externalWs && res.code && res.code !== currentPrototype.vueCode) {
      onCodeUpdated(
        res.code,
        lastInstructionLabel.current,
        res.techStack,
        undefined,
        undefined,
        currentPrototype.id
      )
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
    if (runElsewhere) return
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
    // 补全打开时方向键/Tab/Enter 属于补全，不是发送。
    if (fileSuggest.handleKeyDown(e)) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // 别的项目的 run 不能被这里的输入插话
      if (runElsewhere) return
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
    const target = convMessages[index]
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
      if (convMessages[i]?.role === 'user') {
        userIndex = i
        break
      }
    }
    if (userIndex === -1) return
    const content = convMessages[userIndex].content
    truncateChat(currentPrototype.id, userIndex)
    await new Promise((r) => setTimeout(r, 150))
    await doSend(undefined, content)
  }

  // ============ 指标条数值 ============
  const { lastRunMetrics: metrics, streamingMetrics } = stream
  const contextLimit = selectedModel?.contextWindow || 0
  const draftTokens = promptInput.trim() ? Math.max(1, Math.ceil(promptInput.trim().length / 3)) : 0
  const contextTokensWithDraft = stream.currentContextTokens + draftTokens
  const contextPercent =
    contextLimit > 0 ? Math.min(100, Math.round((contextTokensWithDraft / contextLimit) * 100)) : null
  const cacheCount = metrics?.cachedTokens ?? 0
  const cacheHit = cacheCount > 0 && (metrics?.promptTokens ?? 0) > 0
  const cachePct = cacheHit ? ((cacheCount / (metrics!.promptTokens as number)) * 100).toFixed(0) : null

  const thinkingLevels = selectedModel?.thinkingLevels?.length
    ? selectedModel.thinkingLevels
    : ['off', 'low', 'medium', 'high']

  const isEmptyConversation =
    convMessages.length === 0 || (convMessages.length === 1 && convMessages[0].role === 'assistant')
  const hasQuestion = Boolean(stream.pendingQuestion && stream.pendingQuestion.questions.length > 0)

  /**
   * 本次 run 的圆点条。跑着的时候挂在流式行上；跑完后落到该 run 最后一条回答上 ——
   * 一轮的过程属于 Agent 的回复，不属于面板。
   */
  const turnDots = turnsHere ? (
    <TurnDots
      turns={stream.turns}
      openIndex={openTurnIndex}
      onOpen={setOpenTurnIndex}
      onClose={() => setOpenTurnIndex(null)}
    />
  ) : undefined

  const lastAssistantIndex = useMemo(() => {
    for (let i = convMessages.length - 1; i >= 0; i--) {
      if (convMessages[i].role === 'assistant') return i
    }
    return -1
  }, [convMessages])

  const turnDotsOf = (index: number) =>
    !streamHere && turnDots && index === lastAssistantIndex ? turnDots : undefined

  // textarea 自适应高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 38), 180)}px`
  }, [promptInput])

  return (
    <section
      style={{ width }}
      className={`pc-chat-root${collapsed ? ' is-collapsed' : ''}`}
    >
      <ResizeHandle
        width={width}
        min={320}
        max={720}
        onChange={onWidthChange}
        onDragChange={onResizeDragChange}
      />

      <ChatHeader
        modelLabel={selectedModel?.name || selectionId || ''}
        providerIcon={selectedModel ? getProviderIcon(selectedModel.provider, 11) : undefined}
        configured={configured}
        agentStatus={stream.isStreaming ? stream.agentStatus : null}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onOpenSettings={onOpenSettings}
      />

      <ChatContextBanners
        configured={configured}
        inspectTarget={inspectTarget}
        markupAnnotations={markupAnnotations}
        onOpenSettings={onOpenSettings}
        onClearInspectTarget={onClearInspectTarget}
        onRemoveMarkupAnnotation={onRemoveMarkupAnnotation}
      />

      <ChatFeed
        feedRef={chatScrollEl}
        messages={convMessages}
        isStreaming={streamHere}
        liveSegments={stream.liveSegments}
        isEmpty={isEmptyConversation && !streamHere}
        scenario={externalWs ? undefined : currentPrototype?.scenario}
        projectName={externalWs ? externalWs.name : currentPrototype?.name}
        onScroll={handleScroll}
        onMouseDown={handleFeedMouseDown}
        onSelectPrompt={(prompt) => void doSend(undefined, prompt)}
        onEdit={handleEditQuote}
        onResend={(index) => void handleResend(index)}
        onRegenerate={(index) => void handleRegenerate(index)}
        liveTurnDots={streamHere ? turnDots : undefined}
        turnDotsOf={turnDotsOf}
      />

      <ChatComposer
        docked={
          streamHere && hasQuestion && stream.pendingQuestion ? (
            <ChatQuestionBubble
              question={stream.pendingQuestion}
              onAnswer={(answers, cancelled) => void stream.answerQuestion(answers, cancelled)}
              onDismiss={() => void stream.dismissQuestion()}
            />
          ) : null
        }
        queuedCount={streamHere ? stream.queuedCount : 0}
        promptInput={promptInput}
        pendingAttachments={pendingAttachments}
        fileSuggestOpen={fileSuggest.isOpen}
        fileSuggestions={fileSuggest.suggestions}
        fileSuggestActive={fileSuggest.activeIndex}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        runElsewhere={runElsewhere}
        isStreaming={stream.isStreaming}
        elapsedMs={stream.elapsedMs}
        groupedModels={groupedModels}
        selectionId={selectionId}
        selectedModel={selectedModel}
        thinkingLevel={thinkingLevel}
        thinkingLevels={thinkingLevels}
        metrics={metrics}
        streamingMetrics={streamingMetrics}
        contextTokensWithDraft={contextTokensWithDraft}
        contextLimit={contextLimit}
        contextPercent={contextPercent}
        cacheCount={cacheCount}
        cachePct={cachePct}
        sessionTotalTokens={stream.sessionTotalTokens}
        onPromptChange={(value, cursor) => {
          setPromptInput(value)
          setCursorPos(cursor)
        }}
        onCursorChange={setCursorPos}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onAcceptFileSuggestion={fileSuggest.accept}
        onRemoveAttachment={removeAttachment}
        onFileInputChange={handleFileInputChange}
        onSendClick={handleSendClick}
        onCancel={() => void stream.cancelRun()}
        onSelectModel={selectModel}
        onSelectThinkingLevel={selectThinkingLevel}
      />

      {/* 单轮详情抽屉：浮在面板之上，不挤压消息流 */}
      {turnsHere &&
        openTurnIndex !== null &&
        stream.turns[openTurnIndex] &&
        (() => {
          const turn = stream.turns[openTurnIndex]
          // 正在跑的那一轮给实时切片（`liveSegments` 就是它），已完成的轮给冻结的那份。
          // run 的 finally 会把未收口的轮落成 done，所以 running 一定意味着还在跑。
          const isCurrentTurn = turn.status === 'running'
          return (
            <TurnDetailOverlay
              turn={turn}
              segments={isCurrentTurn ? stream.liveSegments : turn.segments}
              isStreaming={isCurrentTurn}
              index={openTurnIndex}
              total={stream.turns.length}
              onPrev={() => setOpenTurnIndex((prev) => (prev === null ? prev : Math.max(0, prev - 1)))}
              onNext={() =>
                setOpenTurnIndex((prev) =>
                  prev === null ? prev : Math.min(stream.turns.length - 1, prev + 1)
                )
              }
              onClose={() => setOpenTurnIndex(null)}
              liveElapsedMs={stream.elapsedMs}
            />
          )
        })()}
    </section>
  )
}
