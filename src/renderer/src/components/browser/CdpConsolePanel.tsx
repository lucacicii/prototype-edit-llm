import React, { useState, useMemo } from 'react'
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Bug,
  Search,
  Wrench,
  Sparkles
} from 'lucide-react'
import { useSelfDebugStore } from '../../utils/self-debug-loop'

interface CdpConsolePanelProps {
  logs: Array<any>
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClearLogs: () => void
  onFixError: (log: any) => void
  onRunSelfDebug: () => void
}

export const CdpConsolePanel: React.FC<CdpConsolePanelProps> = ({
  logs,
  isCollapsed,
  onToggleCollapse,
  onClearLogs,
  onFixError,
  onRunSelfDebug
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'errors' | 'warnings' | 'network' | 'audit'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const { status, currentRound, maxRounds, auditHistory, autoHealEnabled, setAutoHealEnabled } =
    useSelfDebugStore()

  const tabs = useMemo(() => {
    const errCount = logs.filter((l) => l.level === 'error').length
    const warnCount = logs.filter((l) => l.level === 'warn').length
    return [
      { id: 'all' as const, label: '全部日志', count: logs.length },
      { id: 'errors' as const, label: '❌ 报错', count: errCount },
      { id: 'warnings' as const, label: '⚠️ 警告', count: warnCount },
      { id: 'network' as const, label: '🌐 网络' },
      { id: 'audit' as const, label: '🐞 自闭环审计' }
    ]
  }, [logs])

  const filteredLogs = useMemo(() => {
    let list = logs
    if (activeTab === 'errors') {
      list = list.filter((l) => l.level === 'error')
    } else if (activeTab === 'warnings') {
      list = list.filter((l) => l.level === 'warn')
    } else if (activeTab === 'network') {
      list = list.filter((l) => l.category === 'network')
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((l) => l.text?.toLowerCase().includes(q))
    }
    return list
  }, [logs, activeTab, searchQuery])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0')
  }

  const isProbeLog = (log: any) => log?.origin === 'probe'

  const getLevelBadgeClass = (log: any) => {
    if (log.level === 'error') return 'bg-red-500/20 text-red-400 border border-red-500/30'
    if (log.level === 'warn') return 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
    if (log.category === 'network') return 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
    return 'bg-slate-800 text-slate-400 border border-slate-700'
  }

  const getStatusBadgeClass = (s: string) => {
    if (s === 'passed') return 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
    if (s === 'verifying') return 'bg-sky-600/30 text-sky-300 border border-sky-500/40 animate-pulse'
    if (s === 'healing') return 'bg-amber-600/30 text-amber-300 border border-amber-500/40 animate-pulse'
    if (s === 'failed') return 'bg-red-600/30 text-red-300 border border-red-500/40'
    return 'bg-slate-800 text-slate-400'
  }

  const getStatusLabel = (s: string) => {
    if (s === 'passed') return '自测通过'
    if (s === 'verifying') return '验证中'
    if (s === 'healing') return '自愈中'
    if (s === 'failed') return '自检失败'
    return '待命'
  }

  return (
    <div className="cdp-console-dock flex flex-col bg-slate-950 border-t border-slate-800 text-slate-200 transition-all duration-200 font-mono text-xs select-none">
      {/* 控制台顶栏 */}
      <div className="h-8 bg-slate-900 px-3 flex items-center justify-between border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-slate-800 text-sky-400 font-bold border border-slate-700/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      tab.id === 'errors' && tab.count > 0
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {activeTab !== 'audit' && (
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5">
              <Search size={11} className="text-slate-500 mr-1" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                type="text"
                placeholder="过滤日志..."
                className="bg-transparent text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none w-28"
              />
            </div>
          )}

          <button
            onClick={onClearLogs}
            className="text-slate-400 hover:text-slate-200 text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition flex items-center gap-1 cursor-pointer"
            title="清空日志"
          >
            <Trash2 size={12} />
            <span>清空</span>
          </button>

          <button
            onClick={onToggleCollapse}
            className="text-slate-400 hover:text-slate-200 text-[11px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition cursor-pointer"
            title={isCollapsed ? '展开控制台' : '折叠控制台'}
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* 控制台主体内容 */}
      {!isCollapsed && (
        <div className="h-44 overflow-y-auto p-2 space-y-1 bg-slate-950 select-text">
          {activeTab !== 'audit' ? (
            filteredLogs.length === 0 ? (
              <div className="text-slate-600 text-center py-6 text-xs italic">
                暂无相关日志 (CDP 监听已就绪)
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-1.5 rounded flex flex-col gap-1 border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/70 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 flex-shrink-0">
                        {formatTime(log.timestamp)}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold flex-shrink-0 ${getLevelBadgeClass(log)}`}
                      >
                        {isProbeLog(log) ? 'probe' : log.category}:{log.level}
                      </span>
                      <span className="break-all whitespace-pre-wrap leading-tight text-[11px] font-mono flex-1">
                        {isProbeLog(log) && (
                          <span className="text-sky-400/80">[工具探针·非原型代码] </span>
                        )}
                        {log.text}
                      </span>
                    </div>

                    {log.level === 'error' && !isProbeLog(log) && (
                      <button
                        onClick={() => onFixError(log)}
                        className="px-2 py-0.5 bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/40 rounded text-[10px] flex-shrink-0 transition flex items-center gap-1 cursor-pointer"
                      >
                        <Wrench size={10} />
                        <span>AI 修复</span>
                      </button>
                    )}
                  </div>

                  {log.stack && (
                    <div className="mt-1 p-1.5 bg-black/40 rounded text-[10px] text-slate-400 overflow-x-auto whitespace-pre border border-slate-800">
                      {log.stack}
                    </div>
                  )}
                </div>
              ))
            )
          ) : (
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <Bug size={13} />
                    <span>自闭环自愈状态机:</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadgeClass(status)}`}>
                    {getStatusLabel(status)}
                  </span>
                  {currentRound > 0 && (
                    <span className="text-slate-400 text-[10px]">
                      (第 {currentRound} / {maxRounds} 轮)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 cursor-pointer text-slate-400 text-[11px]">
                    <input
                      type="checkbox"
                      checked={autoHealEnabled}
                      onChange={(e) => setAutoHealEnabled(e.target.checked)}
                      className="rounded text-sky-600"
                    />
                    <span>开启自动自愈</span>
                  </label>
                  <button
                    onClick={onRunSelfDebug}
                    className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-medium transition flex items-center gap-1 cursor-pointer shadow"
                  >
                    <Sparkles size={11} />
                    <span>立即执行自测自愈</span>
                  </button>
                </div>
              </div>

              {auditHistory.length === 0 ? (
                <div className="text-slate-600 text-center py-6 text-xs italic">
                  暂无自闭环审计记录。当生成或更新原型代码时，系统将自动监控并记录。
                </div>
              ) : (
                auditHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded border border-slate-800/80 bg-slate-900/40 mb-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-[10px]">{formatTime(item.timestamp)}</span>
                        <span className="font-bold text-[11px]">{item.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">轮次 {item.round}</span>
                    </div>
                    {item.details && (
                      <div className="text-slate-300 whitespace-pre-wrap text-[11px] font-mono bg-black/30 p-1.5 rounded mt-1">
                        {item.details}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
