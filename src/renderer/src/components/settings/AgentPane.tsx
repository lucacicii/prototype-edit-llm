import React, { useState, useEffect } from 'react'
import { Button, Input, Radio, message } from 'antd'
import { Activity, ShieldCheck, CheckCircle2, XCircle, Bot } from 'lucide-react'
import { useAgentModelConfigStore, type AcpPermissionPolicy } from '../../stores/useAgentModelConfigStore'

export const AgentPane: React.FC = () => {
  const {
    libraryPath,
    acpPermissionPolicy,
    acpAgents,
    selectAcpPermissionPolicy,
    saveAcpAgents
  } = useAgentModelConfigStore()

  const [policy, setPolicy] = useState<AcpPermissionPolicy>('allowAll')
  const [claudeCommand, setClaudeCommand] = useState('')
  const [claudeArgs, setClaudeArgs] = useState('')
  const [codexCommand, setCodexCommand] = useState('')
  const [codexArgs, setCodexArgs] = useState('')

  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [runtimeOk, setRuntimeOk] = useState<boolean | null>(null)
  const [runtimePingMessage, setRuntimePingMessage] = useState<string>('')

  const [checkingAcp, setCheckingAcp] = useState(false)
  const [acpHealth, setAcpHealth] = useState<{
    claude?: { ok: boolean; resolvedPath?: string | null; error?: string }
    codex?: { ok: boolean; resolvedPath?: string | null; error?: string }
  }>({})

  useEffect(() => {
    if (acpPermissionPolicy) setPolicy(acpPermissionPolicy)
    if (acpAgents?.claude) {
      setClaudeCommand(acpAgents.claude.command || '')
      setClaudeArgs(acpAgents.claude.args?.join(' ') || '')
    }
    if (acpAgents?.codex) {
      setCodexCommand(acpAgents.codex.command || '')
      setCodexArgs(acpAgents.codex.args?.join(' ') || '')
    }
    handleCheckRuntime()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCheckRuntime = async () => {
    setChecking(true)
    if (window.agent?.ping) {
      try {
        const res = await window.agent.ping()
        setRuntimeOk(Boolean(res?.ok))
        setRuntimePingMessage(res?.ok ? 'Thunder-Runtime 内核连接正常' : res?.error || '连接失败')
      } catch (err: any) {
        setRuntimeOk(false)
        setRuntimePingMessage(err.message || '连接异常')
      }
    } else {
      setRuntimeOk(false)
      setRuntimePingMessage('agent 桥接不可用')
    }
    setChecking(false)
  }

  const handleCheckAcp = async () => {
    setCheckingAcp(true)
    try {
      if (window.agent?.acpCheckHealth) {
        const [resClaude, resCodex] = await Promise.all([
          window.agent.acpCheckHealth('claude'),
          window.agent.acpCheckHealth('codex')
        ])
        setAcpHealth({
          claude: {
            ok: Boolean(resClaude?.isResolved),
            resolvedPath: resClaude?.resolvedPath,
            error: resClaude?.error
          },
          codex: {
            ok: Boolean(resCodex?.isResolved),
            resolvedPath: resCodex?.resolvedPath,
            error: resCodex?.error
          }
        })
      }
    } catch (e: any) {
      message.error(`检测 ACP 失败: ${e.message}`)
    } finally {
      setCheckingAcp(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updatedAgents: any = {}
      if (claudeCommand.trim() || claudeArgs.trim()) {
        updatedAgents.claude = {
          command: claudeCommand.trim() || undefined,
          args: claudeArgs.trim() ? claudeArgs.trim().split(/\s+/) : undefined
        }
      }
      if (codexCommand.trim() || codexArgs.trim()) {
        updatedAgents.codex = {
          command: codexCommand.trim() || undefined,
          args: codexArgs.trim() ? codexArgs.trim().split(/\s+/) : undefined
        }
      }
      await saveAcpAgents(updatedAgents)
      await selectAcpPermissionPolicy(policy)
      message.success('已保存配置')
    } catch (e: any) {
      message.error(`保存失败: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-5 space-y-6">
      <header className="flex items-center justify-between pb-3 pr-14 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-100">通用与 Agent 运行时</h2>
          <p className="text-xs text-slate-400">检测本机 Thunder-Runtime 内核状态与 ACP 引擎配置</p>
        </div>
        <Button size="small" type="primary" loading={saving} onClick={handleSave}>
          保存配置
        </Button>
      </header>

      {/* 运行时健康状态 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Activity size={14} className="text-sky-400" />
            <span>内核运行时就绪状态</span>
          </span>
          <Button size="small" loading={checking} onClick={handleCheckRuntime}>
            检测运行时
          </Button>
        </div>

        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
          {runtimeOk ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <XCircle size={16} className="text-rose-400" />
          )}
          <div className="flex-1">
            <div className={`font-semibold ${runtimeOk ? 'text-emerald-300' : 'text-rose-300'}`}>
              {runtimePingMessage || '检测中...'}
            </div>
            {libraryPath && (
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                模型库路径: {libraryPath}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Claude Code & Codex (ACP 模式) 配置。
          thunder 引擎没有运行参数可调（轮数/预算等由 daemon 侧 AgentLoopConfig 决定），
          这里只剩 ACP 两个引擎的启动与授权配置。 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Bot size={14} className="text-purple-400" />
            <span>Claude Code 与 Codex (ACP 模式) 配置</span>
          </span>
          <Button size="small" loading={checkingAcp} onClick={handleCheckAcp}>
            检测 ACP 环境
          </Button>
        </div>

        {/* 环境诊断卡片 */}
        {(acpHealth.claude || acpHealth.codex) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center gap-2.5">
              {acpHealth.claude?.ok ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={16} className="text-rose-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-200">Claude Code ACP 启动环境</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {acpHealth.claude?.resolvedPath || '未解析到启动可执行程序'}
                </div>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center gap-2.5">
              {acpHealth.codex?.ok ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={16} className="text-rose-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-200">Codex ACP 启动环境</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {acpHealth.codex?.resolvedPath || '未解析到启动可执行程序'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 默认权限策略 */}
        <div className="text-xs space-y-2">
          <label className="block text-slate-300 font-semibold">默认工作区权限策略</label>
          <Radio.Group value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <Radio value="allowAll">
              <span className="text-slate-200">自动批准工作区操作 (allowAll)</span>
              <span className="text-[10px] text-slate-400 ml-1">推荐原型开发使用，文件读写与命令静默执行</span>
            </Radio>
            <Radio value="ask">
              <span className="text-slate-200">每次操作手动审批 (ask)</span>
              <span className="text-[10px] text-slate-400 ml-1">在聊天面板弹出内联卡片逐项授权</span>
            </Radio>
          </Radio.Group>
        </div>

        {/* 自定义命令覆盖 */}
        <div className="border-t border-slate-800 pt-3 space-y-3 text-xs">
          <div className="font-semibold text-slate-300">自定义启动命令与参数 (留空使用默认 npx 适配器)</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg">
              <div className="font-medium text-purple-300">Claude Code ACP</div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">执行命令 (Command)</label>
                <Input
                  placeholder="默认: npx"
                  value={claudeCommand}
                  onChange={(e) => setClaudeCommand(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">启动参数 (Args 空格分隔)</label>
                <Input
                  placeholder="默认: -y @agentclientprotocol/claude-agent-acp@latest"
                  value={claudeArgs}
                  onChange={(e) => setClaudeArgs(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2 p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg">
              <div className="font-medium text-emerald-300">Codex ACP</div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">执行命令 (Command)</label>
                <Input
                  placeholder="默认: npx"
                  value={codexCommand}
                  onChange={(e) => setCodexCommand(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">启动参数 (Args 空格分隔)</label>
                <Input
                  placeholder="默认: -y @agentclientprotocol/codex-acp@latest"
                  value={codexArgs}
                  onChange={(e) => setCodexArgs(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <ShieldCheck size={12} />
          <span>thunder 引擎的运行预算（轮数/时长/token 上限）由 daemon 侧配置决定，应用内不提供覆盖。</span>
        </div>
      </div>
    </div>
  )
}
