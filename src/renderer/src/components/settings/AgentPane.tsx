import React, { useState, useEffect } from 'react'
import { Button, Input, InputNumber, message } from 'antd'
import { Activity, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react'
import {
  useAgentModelConfigStore,
  type AgentTuningPatch
} from '../../stores/useAgentModelConfigStore'

export const AgentPane: React.FC = () => {
  const { envLocked, libraryPath, saveTuning } = useAgentModelConfigStore()

  const [tuning, setTuning] = useState<AgentTuningPatch>({
    maxTurns: 10,
    temperature: 0.2,
    requestTimeoutMs: 120000,
    systemPrompt: ''
  })

  const [savingTuning, setSavingTuning] = useState(false)
  const [checking, setChecking] = useState(false)
  const [runtimeOk, setRuntimeOk] = useState<boolean | null>(null)
  const [runtimePingMessage, setRuntimePingMessage] = useState<string>('')

  useEffect(() => {
    async function loadConfig() {
      if (window.agent?.getConfig) {
        try {
          const res = await window.agent.getConfig()
          if (res?.config) {
            setTuning({
              maxTurns: res.config.maxTurns ?? 10,
              temperature: res.config.temperature ?? 0.2,
              requestTimeoutMs: res.config.requestTimeoutMs ?? 120000,
              systemPrompt: res.config.systemPrompt ?? ''
            })
          }
        } catch (e) {
          console.error(e)
        }
      }
    }
    loadConfig()
    handleCheckRuntime()
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

  const handleSaveTuning = async () => {
    setSavingTuning(true)
    try {
      const res = await saveTuning(tuning)
      if (res.ok) {
        message.success('已保存工作区 Agent 参数配置')
      } else {
        message.error(`保存失败: ${res.error}`)
      }
    } catch (e: any) {
      message.error(`保存失败: ${e.message}`)
    } finally {
      setSavingTuning(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-5 space-y-6">
      <header className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-100">通用与 Agent 运行时</h2>
          <p className="text-xs text-slate-400">检测本机 Thunder-Runtime 内核状态与调优 Agent 运行参数</p>
        </div>
        <Button size="small" type="primary" loading={savingTuning} onClick={handleSaveTuning}>
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

      {/* Agent 调优参数 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-indigo-400" />
          <span>Agent 行为与限制调优</span>
        </span>

        {envLocked && (
          <div className="p-2 rounded bg-amber-950/50 border border-amber-800/60 text-[11px] text-amber-300">
            环境变量 PROTOTYPE_AGENT_MODEL 正在生效，部分参数可能被环境覆盖。
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 mb-1">单次最大轮数 (maxTurns)</label>
            <InputNumber
              min={1}
              max={30}
              value={tuning.maxTurns}
              onChange={(val) => setTuning({ ...tuning, maxTurns: val || 10 })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">采样温度 (temperature)</label>
            <InputNumber
              min={0}
              max={1}
              step={0.1}
              value={tuning.temperature}
              onChange={(val) => setTuning({ ...tuning, temperature: val ?? 0.2 })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">超时毫秒数 (requestTimeoutMs)</label>
            <InputNumber
              min={10000}
              step={10000}
              value={tuning.requestTimeoutMs}
              onChange={(val) => setTuning({ ...tuning, requestTimeoutMs: val || 120000 })}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div className="text-xs">
          <label className="block text-slate-300 mb-1">自定义 System Prompt 提示词覆盖 (可选)</label>
          <Input.TextArea
            rows={4}
            value={tuning.systemPrompt}
            onChange={(e) => setTuning({ ...tuning, systemPrompt: e.target.value })}
            placeholder="默认留空将使用仓库内置的最佳前端架构师 Prompt..."
          />
        </div>
      </div>
    </div>
  )
}
