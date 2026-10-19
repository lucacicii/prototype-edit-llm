import React, { useState, useEffect, useRef } from 'react'
import { message, Modal } from 'antd'
import {
  Globe,
  Code2,
  Clock,
  PanelLeftOpen,
  PanelLeftClose,
  Share2
} from 'lucide-react'
import { PrototypeSidebar } from './components/PrototypeSidebar'
import { LeftActivityBar, type PrimaryMenuKey } from './components/LeftActivityBar'
import { MaterialLibraryView } from './components/materials/MaterialLibraryView'
import { ChatPanel, type PointedTarget, type MarkupAnnotation } from './components/chat/ChatPanel'
import { EmbeddedBrowserViewer, type EmbeddedBrowserViewerRef } from './components/browser/EmbeddedBrowserViewer'
import { CodeEditorPane } from './components/editor/CodeEditorPane'
import { TopologyPanel } from './components/topology/TopologyPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { VersionHistoryModal } from './components/modals/VersionHistoryModal'
import {
  usePrototypeStore,
  useCurrentPrototype,
  type PrototypeItem,
  type ProductScenario,
  type PreferredStack
} from './stores/usePrototypeStore'
import { useAgentModelConfigStore } from './stores/useAgentModelConfigStore'
import { useMaterialStore } from './stores/useMaterialStore'
import { locateCodeSnippet } from './utils/inspector'

function loadWidth(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(`layout.width.${key}`))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export const App: React.FC = () => {
  const prototypeStore = usePrototypeStore()
  const currentPrototype = useCurrentPrototype()
  const { refresh: refreshModelConfig } = useAgentModelConfigStore()
  const { materials, loadMaterials } = useMaterialStore()

  const [activePrimaryMenu, setActivePrimaryMenu] = useState<PrimaryMenuKey>('prototype')
  const [sidebarWidth, setSidebarWidth] = useState(() => loadWidth('sidebar', 256))
  const [chatWidth, setChatWidth] = useState(() => loadWidth('chat', 384))
  const [isResizing, setIsResizing] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'topology'>('preview')
  // 原型 run 是否在跑：拓扑图生成与它共用同一个 daemon 会话目录，不能同时开工。
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [currentWorkspace, setCurrentWorkspace] = useState<any>(null)
  const currentWorkspaceRef = useRef<any>(null)
  currentWorkspaceRef.current = currentWorkspace
  const [currentVersionNo, setCurrentVersionNo] = useState<number | null>(null)

  // Dialog toggles
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  // Suspension of native browser view when modals are open or when in Material Library menu
  const browserSuspended =
    activePrimaryMenu !== 'prototype' ||
    isSettingsOpen ||
    isHistoryOpen ||
    isResizing

  // Selection states
  const [inspectTarget, setInspectTarget] = useState<PointedTarget | null>(null)
  const [markupAnnotations, setMarkupAnnotations] = useState<MarkupAnnotation[]>([])

  const embeddedBrowserRef = useRef<EmbeddedBrowserViewerRef>(null)
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    async function init() {
      if (window.project?.getCurrentWorkspace) {
        try {
          const curWs = await window.project.getCurrentWorkspace()
          if (curWs) {
            setCurrentWorkspace(curWs)
            currentWorkspaceRef.current = curWs
          }
        } catch {
          // ignore
        }
      }
      await prototypeStore.loadFromDisk()
      await loadMaterials()
      await refreshModelConfig()
      await refreshVersionNo()
      await syncActivePrototypeToFile()
    }
    init()
  }, [])

  // Sync version number on activeId change
  useEffect(() => {
    setSelectedFile('')
    setSelectedFileContent(null)
    refreshVersionNo()
    syncActivePrototypeToFile()
  }, [prototypeStore.activeId])

  // 工作区切换：切回默认工作区（我的原型）时，浏览器要回到当前原型的预览。
  // 外部工作区的跳转由 EmbeddedBrowserViewer 按 workspace.url 处理。
  const prevWorkspaceIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const id: string | undefined = currentWorkspace?.id
    const prev = prevWorkspaceIdRef.current
    prevWorkspaceIdRef.current = id
    if (prev === undefined || prev === id) return
    setSelectedFile('')
    setSelectedFileContent(null)
    if (!id || id === 'default-host') {
      void syncActivePrototypeToFile()
    }
  }, [currentWorkspace?.id])

  const refreshVersionNo = async () => {
    if (!currentPrototype || !window.historyApi) {
      setCurrentVersionNo(null)
      return
    }
    try {
      const res = await window.historyApi.list({ prototypeId: currentPrototype.id })
      setCurrentVersionNo(res?.ok ? res.latestVersion ?? null : null)
    } catch {
      setCurrentVersionNo(null)
    }
  }

  const syncActivePrototypeToFile = async (overrideCode?: string, overrideStack?: string) => {
    const p = usePrototypeStore.getState().prototypes.find(
      (item) => item.id === usePrototypeStore.getState().activeId
    ) || currentPrototype
    if (!p) return
    if (window.hostApi?.savePrototypeFile) {
      try {
        const res = await window.hostApi.savePrototypeFile({
          prototypeId: p.id,
          code: overrideCode ?? p.vueCode,
          techStack: (overrideStack ?? p.techStack) as any
        })
        const ws = currentWorkspaceRef.current
        if (res?.previewUrl && (!ws || ws.id === 'default-host')) {
          embeddedBrowserRef.current?.navigateToUrl(res.previewUrl)
        }
      } catch (e) {
        console.warn('syncActivePrototypeToFile error:', e)
      }
    }
  }

  const applyCodeChange = (id: string, newCode: string, label: string, runId?: string) => {
    const target = usePrototypeStore.getState().prototypes.find((p) => p.id === id)
    const prev = target?.vueCode
    prototypeStore.updateCode(id, newCode)
    if (!target || prev === undefined || prev === newCode || !window.historyApi) return
    window.historyApi
      .record({
        prototypeId: id,
        code: newCode,
        label,
        kind: 'auto',
        seedCode: prev,
        runId
      })
      .then((res) => {
        if (res?.ok && typeof res.version === 'number') {
          setCurrentVersionNo(res.version)
        }
      })
      .catch(() => {})
  }

  /** 从拓扑图节点跳到源码：切到源码页签，并把那个文件读出来。 */
  const handleOpenTopologySource = (file: string) => {
    if (!currentPrototype) return
    setActiveTab('code')
    if (file === currentPrototype.entryFile) {
      setSelectedFile('')
      setSelectedFileContent(null)
      return
    }
    setSelectedFile(file)
    window.prototypeApi
      ?.readFile({ id: currentPrototype.id, filePath: file })
      .then((res) => {
        if (res?.ok && typeof res.content === 'string') setSelectedFileContent(res.content)
      })
      .catch(() => {})
  }

  // Inspect Target Handler
  const handleInspectElementSelected = async (target: any) => {
    let sourceCode = currentPrototype?.vueCode || ''
    const lineNumber = target.sourceLine

    if (window.project?.findSourceFile && (target.sourceFile || target.componentName)) {
      try {
        const match = await window.project.findSourceFile(
          target.sourceFile || target.componentName,
          prototypeStore.activeId || undefined
        )
        if (match) {
          sourceCode = match.content
          target.resolvedLocalPath = match.filePath
        }
      } catch {
        // ignore
      }
    }

    let snippet = ''
    let calculatedLine: number | undefined
    if (target.sourceLocated === true && lineNumber) {
      const start = Math.max(0, lineNumber - 3)
      const end = Math.min(sourceCode.split('\n').length, lineNumber + 4)
      snippet = sourceCode.split('\n').slice(start, end).join('\n')
    } else {
      const located = locateCodeSnippet(sourceCode, {
        tagName: target.tagName,
        className: target.className || '',
        textSnippet: target.text || ''
      })
      snippet = located.snippet
      calculatedLine = located.lineNumber
      target.sourceLocated = false
      if (target.locateMode !== 'text') target.locateMode = 'text'
    }

    setInspectTarget({
      ...target,
      sourceLine: lineNumber || calculatedLine,
      codeSnippet: snippet,
      lineNumber: lineNumber || calculatedLine
    })

    const name = target.componentName || target.tagName
    message.success(`已圈选 <${name}>，支持输入针对该组件的诉求`)
  }

  // Markup Handler
  const handleMarkupSaved = (data: MarkupAnnotation) => {
    setMarkupAnnotations((prev) => {
      const at = data.id ? prev.findIndex((m) => m.id === data.id) : -1
      if (at >= 0) {
        const next = [...prev]
        next[at] = data
        return next
      }
      return [...prev, data]
    })
    const name = data.target?.componentName || data.target?.tagName || '元素'
    message.success(`已捕获圈改批注: "${data.note}" · 定位到 <${name}>`)
  }

  const handleRemoveMarkupAnnotation = (index: number) => {
    setMarkupAnnotations((prev) => {
      const removed = prev[index]
      if (removed?.id) window.browser?.clearMarkups(removed.id)
      return prev.filter((_, i) => i !== index)
    })
  }

  const clearSelectionState = () => {
    setMarkupAnnotations([])
    setInspectTarget(null)
    embeddedBrowserRef.current?.exitInspectMode()
  }

  /** 导入 HTML 后：加载列表 → 选中新项目 → 回到默认工作区 → 预览落到新项目。 */
  const handleHtmlImported = async ({ id }: { id: string; name: string }) => {
    // 主进程已经写好 active-project.txt，重新加载后 activeId 就是新项目。
    await prototypeStore.loadFromDisk()
    prototypeStore.setActive(id)

    if (currentWorkspaceRef.current && currentWorkspaceRef.current.id !== 'default-host') {
      const ws = await window.project?.switchWorkspace?.('default-host')
      if (ws) {
        currentWorkspaceRef.current = ws
        setCurrentWorkspace(ws)
      }
    }

    // 给导入的项目种一个 v1，版本号立刻可见（内容没变时 record 会去重）。
    const imported = usePrototypeStore.getState().prototypes.find((item) => item.id === id)
    if (imported && window.historyApi) {
      const recorded = await window.historyApi
        .record({
          prototypeId: id,
          code: imported.vueCode,
          label: '导入的 HTML 初始版本',
          kind: 'seed'
        })
        .catch(() => null)
      if (recorded?.ok && typeof recorded.version === 'number') {
        setCurrentVersionNo(recorded.version)
      }
    }

    clearSelectionState()
    await syncActivePrototypeToFile()
  }

  // Rollback
  const handleRollback = async (payload: { version: number; code: string; label: string }) => {
    if (!currentPrototype) return
    const id = currentPrototype.id
    if (payload.code === currentPrototype.vueCode) {
      message.info(`当前代码已经是 v${payload.version}`)
      return
    }

    Modal.confirm({
      title: '回滚确认',
      content: `回滚到 v${payload.version}（${payload.label}）？当前代码会自动存为一个新版本。`,
      okText: '确认回滚',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (window.historyApi) {
          await window.historyApi.record({
            prototypeId: id,
            code: currentPrototype.vueCode,
            label: '回滚前自动保存',
            kind: 'rollback-safety'
          })
        }
        prototypeStore.updateCode(id, payload.code)
        await syncActivePrototypeToFile()
        prototypeStore.addChatMessage(id, {
          role: 'assistant',
          content: `⏪ 已回滚到 v${payload.version}（${payload.label}）。之前的版本仍可在版本列表里查阅。`,
          timestamp: Date.now()
        })
        await refreshVersionNo()
        message.success(`已回滚到 v${payload.version}`)
      }
    })
  }

  const handleCreatePrototype = async (data: {
    name: string
    description: string
    scenario: ProductScenario
    preferredStack: PreferredStack
  }) => {
    const item = await prototypeStore.createPrototype(
      data.name,
      data.description,
      data.scenario,
      data.preferredStack
    )
    await syncActivePrototypeToFile(item.vueCode, item.techStack)
    message.success(`已创建独立原型项目【${item.name}】`)
  }

  const handleClonePrototype = async (item: PrototypeItem) => {
    const cloned = await prototypeStore.clonePrototype(item.id)
    if (cloned) {
      await syncActivePrototypeToFile(cloned.vueCode, cloned.techStack)
      message.success(`已复制出【${cloned.name}】`)
    }
  }

  const handleDeletePrototype = async (id: string) => {
    await prototypeStore.deletePrototype(id)
    await syncActivePrototypeToFile()
    refreshVersionNo()
    message.info('已移除原型项目')
  }

  const enabledMaterialCount = materials.filter((m) => m.enabled !== false).length

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 最左侧：固定宽度主菜单栏（原型 / 物料库，设置位于菜单栏右下角） */}
      <LeftActivityBar
        activeMenu={activePrimaryMenu}
        onSelectMenu={(menu) => {
          setActivePrimaryMenu(menu)
          if (menu === 'prototype') {
            requestAnimationFrame(() => {
              embeddedBrowserRef.current?.syncBounds()
            })
          }
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        materialCount={materials.length}
        enabledMaterialCount={enabledMaterialCount}
      />

      {/* 物料库主视图 */}
      {activePrimaryMenu === 'materials' && <MaterialLibraryView />}

      {/* 原型开发工作台（保持挂载，切换菜单时不丢失流式对话与 BrowserView 状态） */}
      <div
        className={`flex-1 min-w-0 h-full ${
          activePrimaryMenu === 'prototype' ? 'flex' : 'hidden'
        } overflow-hidden`}
      >
        {/* 栏目 1：左侧工作区与方案侧边栏 */}
        <PrototypeSidebar
          prototypes={prototypeStore.prototypes}
          activeId={prototypeStore.activeId}
          onSelect={(id) => {
            prototypeStore.setActive(id)
            clearSelectionState()
          }}
          onCreate={handleCreatePrototype}
          onClone={handleClonePrototype}
          onDelete={handleDeletePrototype}
          onWorkspaceChanged={(ws) => {
            setCurrentWorkspace(ws)
            clearSelectionState()
          }}
          onHtmlImported={handleHtmlImported}
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          onWidthChange={(w) => {
            setSidebarWidth(w)
            localStorage.setItem('layout.width.sidebar', String(w))
          }}
          onResizeDragChange={setIsResizing}
        />

        {/* 栏目 2：AI 原型对话迭代区 */}
        <ChatPanel
          currentWorkspace={currentWorkspace}
          onOpenSettings={() => setIsSettingsOpen(true)}
          collapsed={chatCollapsed}
          width={chatWidth}
          onWidthChange={(w) => {
            setChatWidth(w)
            localStorage.setItem('layout.width.chat', String(w))
          }}
          onResizeDragChange={setIsResizing}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          inspectTarget={inspectTarget}
          onClearInspectTarget={() => setInspectTarget(null)}
          markupAnnotations={markupAnnotations}
          onRemoveMarkupAnnotation={handleRemoveMarkupAnnotation}
          onClearSelectionState={clearSelectionState}
          onStreamingChange={setIsChatStreaming}
          onCodeUpdated={(newCode, label, techStack, previewUrl, _entryFile, ownerId) => {
            // run 期间用户可能已切到别的项目：代码要写回发起 run 的那个原型，
            // 预览也只在它仍是当前项目时才跳转。
            const targetId = ownerId || currentPrototype?.id
            if (targetId) {
              const prevActive = usePrototypeStore.getState().activeId
              const stillActive = targetId === prevActive
              applyCodeChange(targetId, newCode, label)
              if (!stillActive) return
              if (previewUrl && (!currentWorkspace || currentWorkspace.id === 'default-host')) {
                embeddedBrowserRef.current?.navigateToUrl(previewUrl)
              } else {
                syncActivePrototypeToFile(newCode, techStack)
              }
            }
          }}
        />

        {/* 栏目 3：核心工作区（内置工程浏览器 / Monaco 代码编辑器） */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden relative">
          {/* 顶部主工作区 Header */}
          <header className="workspace-header app-drag h-14 gap-3 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900 select-none z-10 flex-shrink-0">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <button
                onClick={() => setChatCollapsed((v) => !v)}
                className="text-slate-400 hover:text-slate-200 transition p-1 rounded hover:bg-slate-800 cursor-pointer flex-shrink-0"
                title={chatCollapsed ? '展开 AI 原型对话' : '折叠 AI 原型对话'}
              >
                {chatCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
              </button>
              <span className="text-sm font-semibold text-slate-200 truncate min-w-0">
                {currentWorkspace && currentWorkspace.id !== 'default-host'
                  ? currentWorkspace.name
                  : currentPrototype?.name || '空白原型'}
              </span>
              <span className="wh-id text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 truncate min-w-0 max-w-[220px]">
                {currentWorkspace && currentWorkspace.id !== 'default-host'
                  ? currentWorkspace.url
                  : `ID: ${currentPrototype?.id || ''}`}
              </span>
            </div>

            <div className="flex items-center space-x-3 flex-shrink-0">
              {/* 标签切换 */}
              <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-medium">
                <button
                  title="内置浏览器 (CDP)"
                  className={`wh-tab px-3 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'preview' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setActiveTab('preview')}
                >
                  <Globe size={13} />
                  <span className="wh-tab-label whitespace-nowrap">内置浏览器 (CDP)</span>
                </button>
                <button
                  title="源码视图"
                  className={`wh-tab px-3 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'code' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setActiveTab('code')}
                >
                  <Code2 size={13} />
                  <span className="wh-tab-label whitespace-nowrap">源码视图</span>
                </button>
                <button
                  title="页面拓扑图"
                  className={`wh-tab px-3 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'topology' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setActiveTab('topology')}
                >
                  <Share2 size={13} />
                  <span className="wh-tab-label whitespace-nowrap">拓扑图</span>
                </button>
              </div>

              {/* 版本历史按钮 */}
              <button
                onClick={() => setIsHistoryOpen(true)}
                className="wh-action px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium rounded-lg shadow transition flex items-center gap-1.5 cursor-pointer border border-slate-700"
                title="查看历史版本与快照回滚"
              >
                <Clock size={13} />
                <span className="wh-action-label whitespace-nowrap">版本{currentVersionNo ? ` v${currentVersionNo}` : ''}</span>
              </button>
            </div>
          </header>

          {/* 视口展示区 */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <EmbeddedBrowserViewer
              ref={embeddedBrowserRef}
              activePrototypeId={prototypeStore.activeId}
              currentCode={currentPrototype?.vueCode || ''}
              currentWorkspace={currentWorkspace}
              isVisible={activeTab === 'preview' && activePrimaryMenu === 'prototype'}
              suspended={browserSuspended}
              markupCount={markupAnnotations.length}
              onInspectSelected={handleInspectElementSelected}
              onMarkupSaved={handleMarkupSaved}
              onSelectionCleared={clearSelectionState}
              onCodeUpdated={(newCode) => {
                if (currentPrototype) {
                  applyCodeChange(currentPrototype.id, newCode, '自闭环自测自愈')
                  syncActivePrototypeToFile()
                }
              }}
              onTriggerChatFix={(_prompt) => {
                message.info('已将修复诉求推送到输入区')
              }}
            />

            {activeTab === 'code' && (
              <div className="absolute inset-0 z-20">
                <CodeEditorPane
                  code={selectedFileContent !== null ? selectedFileContent : currentPrototype?.vueCode || ''}
                  techStack={currentPrototype?.techStack}
                  entryFile={currentPrototype?.entryFile}
                  files={currentPrototype?.files}
                  selectedFile={selectedFile || currentPrototype?.entryFile}
                  onSelectFile={async (filePath) => {
                    setSelectedFile(filePath)
                    if (!currentPrototype || filePath === currentPrototype.entryFile) {
                      setSelectedFileContent(null)
                      return
                    }
                    const res = await window.prototypeApi?.readFile({
                      id: currentPrototype.id,
                      filePath
                    })
                    if (res?.ok && typeof res.content === 'string') {
                      setSelectedFileContent(res.content)
                    }
                  }}
                  onChange={(newCode) => {
                    if (currentPrototype) {
                      const targetFile = selectedFile || currentPrototype.entryFile
                      if (selectedFileContent !== null && targetFile !== currentPrototype.entryFile) {
                        setSelectedFileContent(newCode)
                        prototypeStore.updateCode(currentPrototype.id, newCode, targetFile)
                      } else {
                        prototypeStore.updateCode(currentPrototype.id, newCode)
                        syncActivePrototypeToFile(newCode, currentPrototype.techStack)
                      }
                    }
                  }}
                />
              </div>
            )}

            {activeTab === 'topology' && (
              <div className="absolute inset-0 z-20">
                <TopologyPanel
                  prototype={currentPrototype}
                  chatStreaming={isChatStreaming}
                  onOpenSource={handleOpenTopologySource}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 弹窗系统 */}
      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      <VersionHistoryModal
        open={isHistoryOpen}
        activePrototypeId={prototypeStore.activeId}
        prototypeName={currentPrototype?.name}
        currentCode={currentPrototype?.vueCode || ''}
        onClose={() => setIsHistoryOpen(false)}
        onRollback={handleRollback}
      />
    </div>
  )
}

export default App
