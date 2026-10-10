import React, { useState } from 'react'
import { Modal, Input, Select, Checkbox, message } from 'antd'
import {
  useAgentModelConfigStore
} from '../../stores/useAgentModelConfigStore'
import { presetsFor, type ProviderPreset } from './provider-presets'

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

  const handleApplyPreset = (item: ProviderPreset) => {
    setPresetKey(item.key)
    setProvider(item.providerId)
    setApi(item.api || vocabularies.apiOptions[0] || 'openai-completions')
    setBaseUrl(item.baseUrl)
    if (item.modelHint) {
      setModelId(item.modelHint.split(' ')[0])
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
      const payload = {
        provider: provider.trim(),
        id: modelId.trim(),
        name: modelName.trim() || modelId.trim(),
        api,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        reasoning: false,
        supportsImages: false,
        thinkingLevels: ['off'],
        defaultThinkingLevel: 'off'
      }

      const res = await window.agent.saveModel(payload)
      if (!res?.ok) {
        message.error(`添加失败：${res?.error ?? '未知错误'}`)
        return
      }

      message.success(`已成功添加服务商 ${provider}`)
      await useAgentModelConfigStore.getState().refresh()

      if (selectAsCurrent && !envLocked) {
        const selectionId = `${provider.trim()}:${modelId.trim()}`
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
      width={500}
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
