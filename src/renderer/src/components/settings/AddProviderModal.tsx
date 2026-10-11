import React, { useState } from 'react'
import { Modal, Input, Select, Checkbox, message } from 'antd'
import { CloudDownload, Sparkles } from 'lucide-react'
import {
  useAgentModelConfigStore
} from '../../stores/useAgentModelConfigStore'
import { presetsFor, type ProviderPreset } from './provider-presets'
import {
  fetchRemoteModelsHelper,
  inferModelCapabilities,
  probeThinkingLevelsHelper,
  sortThinkingLevels,
  type RemoteModelItem
} from '../../utils/fetchModels'

interface AddProviderModalProps {
  open: boolean
  onClose: () => void
}

export const AddProviderModal: React.FC<AddProviderModalProps> = ({ open, onClose }) => {
  const { vocabularies, envLocked, selectModel } = useAgentModelConfigStore()
  const presets = presetsFor(vocabularies.apiOptions)

  const [presetKey, setPresetKey] = useState<string>('deepseek')
  const [provider, setProvider] = useState<string>('deepseek')
  const [api, setApi] = useState<string>('openai-completions')
  const [baseUrl, setBaseUrl] = useState<string>('https://api.deepseek.com/v1')
  const [apiKey, setApiKey] = useState<string>('')
  const [modelId, setModelId] = useState<string>('deepseek-chat')
  const [modelName, setModelName] = useState<string>('')
  const [selectAsCurrent, setSelectAsCurrent] = useState<boolean>(true)
  const [saving, setSaving] = useState(false)

  // Remote models fetch state
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [selectedRemoteModel, setSelectedRemoteModel] = useState<RemoteModelItem | null>(null)
  const [probingThinking, setProbingThinking] = useState(false)

  const handleApplyPreset = (item: ProviderPreset) => {
    setPresetKey(item.key)
    setProvider(item.providerId)
    setApi(item.api || vocabularies.apiOptions[0] || 'openai-completions')
    setBaseUrl(item.baseUrl)
    if (item.modelHint) {
      setModelId(item.modelHint.split(' ')[0])
    }
    setRemoteModels([])
    setSelectedRemoteModel(null)
  }

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      message.warning('请先填写 Base URL')
      return
    }

    setFetchingModels(true)
    try {
      const res = await fetchRemoteModelsHelper({
        provider: provider.trim(),
        api,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined
      })

      if (res?.ok && Array.isArray(res.models) && res.models.length > 0) {
        setRemoteModels(res.models)
        message.success(`成功从服务商获取到 ${res.models.length} 个模型！`)

        // If current modelId is empty or not in list, auto pick the first or matching one
        const match = res.models.find((m) => m.id === modelId) || res.models[0]
        if (match) {
          handleSelectRemoteModel(match)
        }
      } else {
        message.warning(res?.error || '未获取到可用模型，请检查 Base URL 与 API Key 是否正确')
      }
    } catch (err: any) {
      message.error(`获取失败：${err.message || '网络异常'}`)
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSelectRemoteModel = async (model: RemoteModelItem) => {
    setSelectedRemoteModel(model)
    setModelId(model.id)
    setModelName(model.name || '')

    if (!baseUrl.trim() || !model.id.trim()) return
    setProbingThinking(true)
    try {
      const res = await probeThinkingLevelsHelper({
        provider: provider.trim(),
        api,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        modelId: model.id.trim()
      })
      if (res?.ok && Array.isArray(res.thinkingLevels) && res.thinkingLevels.length > 0) {
        const levels = sortThinkingLevels(res.thinkingLevels)
        const reasoning =
          typeof res.reasoning === 'boolean'
            ? res.reasoning
            : levels.some((lv) => lv !== 'off' && lv !== 'none')
        const defaultThinkingLevel =
          res.defaultThinkingLevel && levels.includes(res.defaultThinkingLevel)
            ? res.defaultThinkingLevel
            : reasoning
              ? levels.includes('medium')
                ? 'medium'
                : levels[levels.length - 1]
              : 'off'
        setSelectedRemoteModel((prev) =>
          prev && prev.id === model.id
            ? {
                ...prev,
                reasoning,
                thinkingLevels: levels,
                defaultThinkingLevel
              }
            : prev
        )
      }
    } catch {
      // ignore probe errors
    } finally {
      setProbingThinking(false)
    }
  }

  const handleSave = async () => {
    if (!provider.trim() || !api || !baseUrl.trim() || !modelId.trim()) {
      message.error('请填写完整必填字段')
      return
    }

    if (!window.agent?.saveModel) {
      message.error('agent 桥接不可用')
      return
    }

    setSaving(true)
    try {
      const targetModelId = modelId.trim()
      let resolvedSpec =
        selectedRemoteModel && selectedRemoteModel.id === targetModelId
          ? selectedRemoteModel
          : inferModelCapabilities(targetModelId)

      // Try probing thinking levels on save if not already selected/probed
      if (!selectedRemoteModel || selectedRemoteModel.id !== targetModelId) {
        try {
          const probeRes = await probeThinkingLevelsHelper({
            provider: provider.trim(),
            api,
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim() || undefined,
            modelId: targetModelId
          })
          if (probeRes?.ok && probeRes.thinkingLevels?.length) {
            resolvedSpec = {
              ...resolvedSpec,
              reasoning: probeRes.reasoning ?? resolvedSpec.reasoning,
              thinkingLevels: probeRes.thinkingLevels,
              defaultThinkingLevel: probeRes.defaultThinkingLevel ?? resolvedSpec.defaultThinkingLevel
            }
          }
        } catch {
          // keep inferred fallback
        }
      }

      const payload = {
        provider: provider.trim(),
        id: targetModelId,
        name: modelName.trim() || targetModelId,
        api,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        reasoning: resolvedSpec.reasoning ?? false,
        input: resolvedSpec.supportsImages ? ['text', 'image'] : undefined,
        contextWindow: resolvedSpec.contextWindow,
        maxTokens: resolvedSpec.maxTokens,
        thinkingLevels: resolvedSpec.thinkingLevels || ['off'],
        defaultThinkingLevel: resolvedSpec.defaultThinkingLevel || 'off'
      }

      const res = await window.agent.saveModel(payload)
      if (!res?.ok) {
        message.error(`添加失败：${res?.error ?? '未知错误'}`)
        return
      }

      message.success(`已成功添加服务商 ${provider} 与模型 ${modelId}`)
      await useAgentModelConfigStore.getState().refresh()

      if (selectAsCurrent && !envLocked) {
        const selectionId = `${provider.trim()}/${targetModelId}`
        await selectModel(selectionId)
      }

      onClose()
    } catch (e: any) {
      message.error(`添加失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="添加模型服务商"
      width={520}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
    >
      <div className="py-2 space-y-3.5 text-xs">
        {/* 预设标签 */}
        <div>
          <label className="block text-slate-400 font-medium mb-1.5">常用服务商预设</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition cursor-pointer ${
                  presetKey === item.key
                    ? 'bg-sky-600 text-white border-sky-500 shadow'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
                onClick={() => handleApplyPreset(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              服务商标识 provider <span className="text-rose-500">*</span>
            </label>
            <Input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="如 openai / deepseek"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              API 协议方言 <span className="text-rose-500">*</span>
            </label>
            <Select
              value={api}
              onChange={setApi}
              style={{ width: '100%' }}
              options={vocabularies.apiOptions.map((opt) => ({ label: opt, value: opt }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Base URL <span className="text-rose-500">*</span>
          </label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="如 https://api.deepseek.com/v1"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">API Key 密钥</label>
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴密钥（留空则从环境变量 PROTOTYPE_AGENT_API_KEY 读取）"
          />
        </div>

        {/* 自动获取模型列表栏目 */}
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-400" />
              <span>智能获取模型列表</span>
            </span>
            <button
              type="button"
              disabled={fetchingModels}
              onClick={handleFetchModels}
              className="h-7 px-2.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <CloudDownload size={13} className={fetchingModels ? 'animate-bounce' : ''} />
              <span>{fetchingModels ? '拉取中...' : '拉取模型列表'}</span>
            </button>
          </div>

          {remoteModels.length > 0 && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">从获取到的列表中选择模型：</label>
              <Select
                showSearch
                style={{ width: '100%' }}
                placeholder="搜索并选择模型..."
                value={modelId}
                onChange={(val) => {
                  const m = remoteModels.find((item) => item.id === val)
                  if (m) handleSelectRemoteModel(m)
                  else setModelId(val)
                }}
                options={remoteModels.map((m) => ({
                  label: (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{m.id}</span>
                      <span className="text-[10px] text-slate-400">
                        {m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : ''}
                        {m.reasoning ? ' · 思考' : ''}
                        {m.supportsImages ? ' · 视觉' : ''}
                      </span>
                    </div>
                  ),
                  value: m.id
                }))}
              />
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-slate-800 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              首个模型 ID <span className="text-rose-500">*</span>
            </label>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="如 deepseek-chat"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">显示名称</label>
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="留空默认显示模型 ID"
            />
          </div>
        </div>

        {selectedRemoteModel && (
          <div className="p-2 rounded bg-sky-950/40 border border-sky-800/40 text-[11px] text-sky-300 font-mono flex items-center justify-between">
            <span>窗口: {selectedRemoteModel.contextWindow || '128000'} tok</span>
            <span>输出: {selectedRemoteModel.maxTokens || '4096'} tok</span>
            <span>
              {probingThinking
                ? '思考等级探测中...'
                : selectedRemoteModel.reasoning
                  ? `✓ 思考 (${(selectedRemoteModel.thinkingLevels || ['off', 'low', 'medium', 'high']).map((l) => l.toUpperCase()).join('/')})`
                  : '无思考 (OFF)'}
            </span>
            <span>{selectedRemoteModel.supportsImages ? '✓ 支持图片' : '无图片'}</span>
          </div>
        )}

        <div>
          <Checkbox
            checked={selectAsCurrent}
            onChange={(e) => setSelectAsCurrent(e.target.checked)}
            disabled={envLocked}
          >
            <span className="text-xs text-slate-300">同时设为当前默认模型</span>
          </Checkbox>
        </div>
      </div>
    </Modal>
  )
}
