import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { message } from 'antd'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Target,
  Edit3,
  Wrench,
  Bug,
  Terminal,
  Lock
} from 'lucide-react'
import { CdpConsolePanel } from './CdpConsolePanel'
import { selfDebugEngine, useSelfDebugStore } from '../../utils/self-debug-loop'

export interface EmbeddedBrowserViewerRef {
  syncBounds: () => void
  exitInspectMode: () => void
  runSelfDebug: () => void
  navigateToUrl: (url: string) => void
}

interface EmbeddedBrowserViewerProps {
  activePrototypeId: string
  currentCode: string
  isVisible: boolean
  currentWorkspace?: any
  suspended?: boolean
  markupCount?: number
  onInspectSelected: (target: any) => void
  onMarkupSaved: (data: any) => void
  onSelectionCleared: () => void
  onCodeUpdated: (code: string) => void
  onTriggerChatFix: (prompt: string) => void
}

export const EmbeddedBrowserViewer = forwardRef<EmbeddedBrowserViewerRef, EmbeddedBrowserViewerProps>(
  (
    {
      activePrototypeId: _activePrototypeId,
      currentCode,
      isVisible,
      currentWorkspace,
      suspended,
      markupCount = 0,
      onInspectSelected,
      onMarkupSaved,
      onSelectionCleared,
      onCodeUpdated,
      onTriggerChatFix
    },
    ref
  ) => {
    const viewportContainerRef = useRef<HTMLDivElement>(null)
    const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(true)
    const [inputUrl, setInputUrl] = useState('')
    const [inspectMode, setInspectMode] = useState<'inspect' | 'markup' | 'off'>('off')
    const [viewportMode, setViewportMode] = useState<'responsive' | 'desktop-1080' | 'desktop-900' | 'mobile-iphone'>('responsive')
    const [zoomLevel, setZoomLevel] = useState('1.0')
    const [domModalOpen, setDomModalOpen] = useState(false)

    const effectiveSuspended = Boolean(suspended || domModalOpen)

    const [navState, setNavState] = useState({
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      url: '',
      title: ''
    })

    const [cdpLogs, setCdpLogs] = useState<any[]>([])
    const { status: debugStatus, currentRound: debugRound } = useSelfDebugStore()

    const syncBounds = () => {
      if (!isVisible || effectiveSuspended || !viewportContainerRef.current || !window.browser) return
      const rect = viewportContainerRef.current.getBoundingClientRect()
      window.browser.setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }

    const exitInspectMode = () => {
      setInspectMode('off')
      window.browser?.setInspectMode('off')
    }

    const handleNavigate = () => {
      if (inputUrl && window.browser) {
        window.browser.loadUrl(inputUrl)
      }
    }

    useImperativeHandle(ref, () => ({
      syncBounds,
      exitInspectMode,
      runSelfDebug,
      navigateToUrl: (url: string) => {
        setInputUrl(url)
        if (window.browser) window.browser.loadUrl(url)
      }
    }))

    // Auto-detect any open Ant Design modal (.ant-modal-wrap / .ant-modal-mask)
    // and automatically hide the native BrowserView so it never covers any popup!
    useEffect(() => {
      const checkModals = () => {
        const wraps = document.querySelectorAll('.ant-modal-wrap, .ant-image-preview-wrap')
        let anyVisible = false
        wraps.forEach((el) => {
          const htmlEl = el as HTMLElement
          const style = window.getComputedStyle(htmlEl)
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            anyVisible = true
          }
        })
        setDomModalOpen(anyVisible)
      }

      checkModals()
      const mo = new MutationObserver(checkModals)
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      })
      return () => mo.disconnect()
    }, [])

    // Register Browser events
    useEffect(() => {
      if (!window.browser) return

      const unsubs: Array<() => void> = [
        window.browser.onCdpLog((log) => {
          setCdpLogs((prev) => {
            const updated = [log, ...prev]
            if (updated.length > 300) updated.pop()
            return updated
          })
        }),
        window.browser.onLogsCleared(() => {
          setCdpLogs([])
        }),
        window.browser.onNavState((state) => {
          setNavState(state)
          if (state.url) setInputUrl(state.url)
        }),
        window.browser.onInspectSelected((target) => {
          setInspectMode('off')
          onInspectSelected(target)
        }),
        window.browser.onMarkupSaved((data) => {
          onMarkupSaved(data)
        }),
        window.browser.onInspectCancelled(() => {
          setInspectMode('off')
          onSelectionCleared()
        })
      ]

      window.browser.setInspectMode('off')
      if (inputUrl) {
        window.browser.loadUrl(inputUrl)
      }

      if (isVisible && !effectiveSuspended) {
        window.browser.show()
      }

      return () => {
        unsubs.forEach((u) => u())
        window.browser?.hide()
      }
    }, [])

    // Bounds sync via ResizeObserver
    useEffect(() => {
      if (!viewportContainerRef.current) return
      const observer = new ResizeObserver(() => syncBounds())
      observer.observe(viewportContainerRef.current)
      window.addEventListener('resize', syncBounds)
      syncBounds()

      return () => {
        observer.disconnect()
        window.removeEventListener('resize', syncBounds)
      }
    }, [isVisible, effectiveSuspended, viewportMode, isConsoleCollapsed])

    // Visibility & Suspended tracking
    useEffect(() => {
      if (!window.browser) return
      if (isVisible && !effectiveSuspended) {
        window.browser.show()
        setTimeout(syncBounds, 50)
      } else {
        window.browser.hide()
      }
    }, [isVisible, effectiveSuspended])

    // Prototype or workspace URL sync
    useEffect(() => {
      if (currentWorkspace && currentWorkspace.id !== 'default-host' && currentWorkspace.url) {
        setInputUrl(currentWorkspace.url)
        if (window.browser) window.browser.loadUrl(currentWorkspace.url)
      }
    }, [currentWorkspace])

    const handleGoBack = () => window.browser?.goBack()
    const handleGoForward = () => window.browser?.goForward()
    const handleReload = () => window.browser?.reload()

    const handleZoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const z = e.target.value
      setZoomLevel(z)
      window.browser?.setZoom(parseFloat(z))
    }

    const toggleInspect = () => {
      if (inspectMode === 'inspect') {
        setInspectMode('off')
        window.browser?.setInspectMode('off')
      } else {
        setInspectMode('inspect')
        window.browser?.setInspectMode('inspect')
      }
    }

    const toggleMarkup = () => {
      if (inspectMode === 'markup') {
        setInspectMode('off')
        window.browser?.setInspectMode('off')
        onSelectionCleared()
      } else {
        setInspectMode('markup')
        window.browser?.setInspectMode('markup')
      }
    }

    const toggleDevTools = () => window.browser?.toggleDevTools()

    const handleClearLogs = async () => {
      await window.browser?.clearDiagnostics()
      setCdpLogs([])
    }

    const handleFixError = (log: any) => {
      const prompt = `
【修复指定运行时报错】
错误内容: ${log.text}
${log.stack ? `调用栈:\n${log.stack}` : ''}
请分析当前代码并修复此报错，保持原有结构完好。
`
      onTriggerChatFix(prompt)
    }

    const runSelfDebug = async () => {
      if (debugStatus === 'verifying' || debugStatus === 'healing') {
        message.info('自闭环正在运行中...')
        return
      }

      setIsConsoleCollapsed(false)
      message.info('启动自闭环 Debug 自测与自愈...')

      await selfDebugEngine.executeLoop({
        prototypeId: activePrototypeId,
        getCurrentCode: () => currentCode,
        updateCode: async (newCode: string) => {
          onCodeUpdated(newCode)
        },
        maxRounds: 3,
        onLog: (msg: string) => {
          message.success(msg)
        }
      })
    }

    const getSelfDebugBtnClass = () => {
      if (debugStatus === 'passed') return 'bg-emerald-600 text-white shadow'
      if (debugStatus === 'verifying') return 'bg-sky-600 text-white animate-pulse'
      if (debugStatus === 'healing') return 'bg-amber-600 text-white animate-pulse'
      if (debugStatus === 'failed') return 'bg-red-600 text-white'
      return 'bg-slate-700 hover:bg-slate-600 text-slate-200'
    }

    const getSelfDebugBtnLabel = () => {
      if (debugStatus === 'passed') return '自测通过'
      if (debugStatus === 'verifying') return '正在验证'
      if (debugStatus === 'healing') return `自愈中(R${debugRound})`
      if (debugStatus === 'failed') return '自检失败'
      return '自测自愈'
    }

    const errorCount = cdpLogs.filter((l) => l.level === 'error').length

    const viewportBoxStyle: React.CSSProperties =
      viewportMode === 'desktop-1080'
        ? { width: '1920px', height: '1080px', maxWidth: '100%', maxHeight: '100%' }
        : viewportMode === 'desktop-900'
        ? { width: '1440px', height: '900px', maxWidth: '100%', maxHeight: '100%' }
        : viewportMode === 'mobile-iphone'
        ? { width: '375px', height: '812px', border: '12px solid #1e293b', borderRadius: '36px' }
        : { width: '100%', height: '100%' }

    return (
      <div className="embedded-browser h-full w-full flex flex-col bg-slate-900 overflow-hidden relative">
        {/* 顶部工具栏 */}
        <header className="h-11 bg-slate-800 border-b border-slate-700/80 px-3 flex items-center justify-between flex-shrink-0 text-xs gap-2 select-none z-20">
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleGoBack}
              disabled={!navState.canGoBack}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300 transition cursor-pointer"
              title="后退"
            >
              <ArrowLeft size={13} />
            </button>
            <button
              onClick={handleGoForward}
              disabled={!navState.canGoForward}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-300 transition cursor-pointer"
              title="前进"
            >
              <ArrowRight size={13} />
            </button>
            <button
              onClick={handleReload}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              title="刷新"
            >
              <RotateCw size={13} className={navState.isLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 地址栏输入框 */}
          <div className="flex-1 max-w-xl flex items-center bg-slate-900/90 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 gap-1.5 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/30 transition">
            <Lock size={12} className="text-slate-400" />
            <input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
              type="text"
              className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none font-mono"
              placeholder="输入网址 (如 http://localhost:3000 或 http://127.0.0.1:4321/...)"
            />
            {inputUrl !== navState.url && (
              <button
                onClick={handleNavigate}
                className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-medium transition cursor-pointer"
              >
                前往
              </button>
            )}
          </div>

          {/* 功能操作区 */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select
              value={viewportMode}
              onChange={(e) => setViewportMode(e.target.value as any)}
              className="h-7 px-2 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-300 outline-none hover:border-slate-600 cursor-pointer"
            >
              <option value="responsive">🖥️ 自适应 100%</option>
              <option value="desktop-1080">💻 1920×1080</option>
              <option value="desktop-900">💻 1440×900</option>
              <option value="mobile-iphone">📱 375×812</option>
            </select>

            <select
              value={zoomLevel}
              onChange={handleZoomChange}
              className="h-7 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-300 outline-none hover:border-slate-600 cursor-pointer"
            >
              <option value="0.8">80%</option>
              <option value="1.0">100%</option>
              <option value="1.25">125%</option>
            </select>

            <div className="h-4 w-px bg-slate-700 mx-0.5"></div>

            {/* 🎯 圈选 */}
            <button
              onClick={toggleInspect}
              className={`h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1 cursor-pointer ${
                inspectMode === 'inspect'
                  ? 'bg-sky-500 text-white shadow-lg ring-2 ring-sky-400/50'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
              title="点击页面元素提取组件与代码行号"
            >
              <Target size={12} />
              <span>{inspectMode === 'inspect' ? '圈选中(ESC退出)' : '圈选'}</span>
            </button>

            {/* ✏️ 圈改 */}
            <button
              onClick={toggleMarkup}
              className={`h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1 cursor-pointer ${
                inspectMode === 'markup'
                  ? 'bg-amber-500 text-white shadow-lg ring-2 ring-amber-400/50'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
              title="在页面上框选区域并输入批注需求"
            >
              <Edit3 size={12} />
              <span>{inspectMode === 'markup' ? `标注中(${markupCount})(ESC退出)` : '圈改'}</span>
            </button>

            {/* 🛠️ DevTools */}
            <button
              onClick={toggleDevTools}
              className="h-7 px-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition flex items-center gap-1 cursor-pointer"
              title="呼出/隐藏 Chromium 原生开发者工具 (F12)"
            >
              <Wrench size={12} />
              <span>DevTools</span>
            </button>

            {/* 🐞 自测自愈状态胶囊 */}
            <button
              onClick={runSelfDebug}
              className={`h-7 px-2.5 rounded text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${getSelfDebugBtnClass()}`}
              title="点击执行自测自愈循环"
            >
              <Bug size={12} />
              <span>{getSelfDebugBtnLabel()}</span>
            </button>

            {/* 📟 展开控制台 */}
            <button
              onClick={() => setIsConsoleCollapsed(!isConsoleCollapsed)}
              className={`h-7 px-2 rounded text-xs transition flex items-center gap-1 cursor-pointer ${
                isConsoleCollapsed && errorCount > 0
                  ? 'bg-red-600 text-white animate-bounce'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
              title="切换底部控制台"
            >
              <Terminal size={12} />
              {errorCount > 0 && <span className="text-[10px] font-bold">({errorCount})</span>}
            </button>
          </div>
        </header>

        {/* 视口容器区 */}
        <div className="flex-1 w-full min-h-0 relative flex items-center justify-center bg-slate-950 overflow-hidden">
          <div
            ref={viewportContainerRef}
            className="relative transition-all duration-150 bg-white shadow-2xl overflow-hidden"
            style={viewportBoxStyle}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-900 pointer-events-none z-0">
              <span className="text-2xl mb-2 animate-pulse">⚡</span>
              <p className="text-xs font-mono">企业级内置浏览器正在初始化...</p>
              <p className="text-[11px] text-slate-500 mt-1">{inputUrl}</p>
            </div>
          </div>
        </div>

        {/* 底部控制台 */}
        <CdpConsolePanel
          logs={cdpLogs}
          isCollapsed={isConsoleCollapsed}
          onToggleCollapse={() => setIsConsoleCollapsed(!isConsoleCollapsed)}
          onClearLogs={handleClearLogs}
          onFixError={handleFixError}
          onRunSelfDebug={runSelfDebug}
        />
      </div>
    )
  }
)
