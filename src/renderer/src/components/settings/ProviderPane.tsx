import React, { useState } from 'react'
import { Modal, Input, Button, Switch, Select, message } from 'antd'
import { Plus, Trash2, Globe, Cpu, RefreshCw } from 'lucide-react'
import {
  useAgentModelConfigStore,
  useProviderGroups,
  type ProviderGroup,
  type AgentModelView
} from '../../stores/useAgentModelConfigStore'
import {
  saveProviderGroup,
  deleteProviderGroup,
  saveModelItem,
  deleteModelItem,
  emptyDraft,
  draftFrom,
  type ModelDraft
} from '../../stores/useModelLibraryStore'

interface ProviderPaneProps {
  onOpenAddProvider: () => void
}

export const ProviderPane: React.FC<ProviderPaneProps> = ({ onOpenAddProvider }) => {
  const { refresh, vocabularies } = useAgentModelConfigStore()
  const providers = useProviderGroups()

  const [activeProviderName, setActiveProviderName] = useState<string>(
    providers[0]?.provider || ''
  )

  const activeGroup =
    providers.find((p) => p.provider === activeProviderName) || providers[0]

  // Provider editing
  const [providerApi, setProviderApi] = useState(activeGroup?.api || '')
  const [providerBaseUrl, setProviderBaseUrl] = useState(activeGroup?.baseUrl || '')
  const [providerApiKey, setProviderApiKey] = useState('')
  const [savingProvider, setSavingProvider] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Model modal
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  const [savingModel, setSavingModel] = useState(false)

  // Keep form in sync when activeGroup changes
  React.useEffect(() => {
    if (activeGroup) {
      setProviderApi(activeGroup.api)
      setProviderBaseUrl(activeGroup.baseUrl)
      setProviderApiKey('')
    }
  }, [activeGroup?.provider])

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const handleSaveProvider = async () => {
    if (!activeGroup) return
    setSavingProvider(true)
    await saveProviderGroup(activeGroup, {
      api: providerApi,
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey || undefined
    })
    setSavingProvider(false)
  }

  const handleDeleteProvider = async (group: ProviderGroup) => {
    Modal.confirm({
      title: `确认移除服务商 ${group.provider}？`,
      content: '该操作将同时移除其名下的所有模型及密钥配置。',
      okText: '确认移除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteProviderGroup(group.provider)
      }
    })
  }

  const handleOpenAddModel = () => {
    if (!activeGroup) return
    setModelDraft(emptyDraft(activeGroup.api, activeGroup.baseUrl, vocabularies.defaults))
    setModelModalOpen(true)
  }

  const handleOpenEditModel = (model: AgentModelView) => {
    setModelDraft(draftFrom(model))
    setModelModalOpen(true)
  }

  const handleSaveModel = async () => {
    if (!activeGroup || !modelDraft) return
    if (!modelDraft.id.trim()) {
      message.error('请填写模型 ID')
      return
    }
    setSavingModel(true)
    const res = await saveModelItem(activeGroup.provider, modelDraft)
    setSavingModel(false)
    if (res?.ok) {
      setModelModalOpen(false)
    }
  }

  const handleDeleteModel = async (model: AgentModelView) => {
    Modal.confirm({
      title: `确认删除模型 ${model.name || model.id}？`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteModelItem(model.provider, model.id)
      }
    })
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* 头部标题与操作 */}
      <header className="p-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold text-slate-100">模型服务商管理</h2>
          <p className="text-xs text-slate-400">配置各家 LLM 服务的网关端点、密钥与模型清单</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            icon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={handleRefresh}
          >
            刷新
          </Button>
          <Button size="small" type="primary" icon={<Plus size={12} />} onClick={onOpenAddProvider}>
            添加服务商
          </Button>
        </div>
      </header>

      {/* 主体两栏 */}
      {providers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
          <Globe size={32} className="mb-2 text-slate-600" />
          <p className="text-sm font-medium text-slate-400">还没有配置任何服务商</p>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            添加一个网关与模型，开启自然语言驱动的原型设计。
          </p>
          <Button type="primary" onClick={onOpenAddProvider}>
            立即添加
          </Button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* 左侧服务商列表 */}
          <aside className="w-56 border-r border-slate-800 p-2 space-y-1 overflow-y-auto shrink-0 bg-slate-900/30">
            {providers.map((group) => {
              const isActive = activeGroup?.provider === group.provider
              return (
                <div
                  key={group.provider}
                  onClick={() => setActiveProviderName(group.provider)}
                  className={`p-2 rounded-lg text-xs cursor-pointer transition flex items-center justify-between group ${
                    isActive
                      ? 'bg-sky-600/20 text-sky-300 border border-sky-500/40 font-medium'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="truncate">
                    <div className="font-semibold truncate">{group.provider}</div>
                    <div className="text-[10px] text-slate-500 truncate">{group.modelCount} 个模型</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteProvider(group)
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                    title="删除服务商"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </aside>

          {/* 右侧详情 */}
          {activeGroup && (
            <main className="flex-1 p-5 overflow-y-auto space-y-6">
              {/* 服务商网关配置卡片 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-100">{activeGroup.provider}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                      {activeGroup.api}
                    </span>
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    loading={savingProvider}
                    onClick={handleSaveProvider}
                  >
                    保存网关设置
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-slate-300 mb-1">API 协议方言</label>
                    <Select
                      value={providerApi}
                      onChange={setProviderApi}
                      style={{ width: '100%' }}
                      options={vocabularies.apiOptions.map((opt) => ({ label: opt, value: opt }))}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Base URL</label>
                    <Input
                      value={providerBaseUrl}
                      onChange={(e) => setProviderBaseUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label className="block text-slate-300 mb-1">
                    API Key（留空保持不变{activeGroup.hasApiKey ? '，当前已配置密钥' : '，当前未配置密钥'}）
                  </label>
                  <Input.Password
                    value={providerApiKey}
                    onChange={(e) => setProviderApiKey(e.target.value)}
                    placeholder="输入新密钥覆盖现有密钥"
                  />
                </div>
              </div>

              {/* 名下模型列表 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Cpu size={14} className="text-sky-400" />
                    <span>挂载模型列表 ({activeGroup.models.length})</span>
                  </span>
                  <Button size="small" icon={<Plus size={12} />} onClick={handleOpenAddModel}>
                    添加模型
                  </Button>
                </div>

                <div className="space-y-2">
                  {activeGroup.models.map((model) => (
                    <div
                      key={model.id}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs hover:border-slate-700 transition"
                    >
                      <div>
                        <div className="font-semibold text-slate-200 flex items-center gap-2">
                          <span>{model.name || model.id}</span>
                          <span className="text-[10px] text-slate-500 font-mono">({model.id})</span>
                          {model.available ? (
                            <span className="text-[10px] text-emerald-400">✓ 可用</span>
                          ) : (
                            <span className="text-[10px] text-amber-500">
                              ! {model.unavailableReason || '不可用'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-3">
                          <span>窗口: {model.contextWindow || '默认'}</span>
                          <span>输出: {model.maxTokens || '默认'}</span>
                          {model.reasoning && <span>支持思考</span>}
                          {model.input?.includes('image') && <span>支持图片</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button size="small" onClick={() => handleOpenEditModel(model)}>
                          编辑
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={() => handleDeleteModel(model)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </main>
          )}
        </div>
      )}

      {/* 模型编辑 / 新增弹窗 */}
      <Modal
        open={modelModalOpen}
        title={modelDraft?.source ? `编辑模型: ${modelDraft.id}` : '添加新模型'}
        width={460}
        onCancel={() => setModelModalOpen(false)}
        onOk={handleSaveModel}
        confirmLoading={savingModel}
        okText="保存"
        cancelText="取消"
      >
        {modelDraft && (
          <div className="py-2 space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">
                  模型 ID <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={modelDraft.id}
                  onChange={(e) => setModelDraft({ ...modelDraft, id: e.target.value })}
                  placeholder="如 gpt-4o"
                  disabled={Boolean(modelDraft.source)}
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">显示名称</label>
                <Input
                  value={modelDraft.name}
                  onChange={(e) => setModelDraft({ ...modelDraft, name: e.target.value })}
                  placeholder="留空显示模型 ID"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">上下文窗口</label>
                <Input
                  type="number"
                  value={modelDraft.contextWindow || ''}
                  onChange={(e) =>
                    setModelDraft({
                      ...modelDraft,
                      contextWindow: parseInt(e.target.value) || undefined
                    })
                  }
                  placeholder="如 128000"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">最大输出 Token</label>
                <Input
                  type="number"
                  value={modelDraft.maxTokens || ''}
                  onChange={(e) =>
                    setModelDraft({ ...modelDraft, maxTokens: parseInt(e.target.value) || undefined })
                  }
                  placeholder="如 4096"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-slate-300">支持多模态图片输入</span>
              <Switch
                checked={modelDraft.supportsImages}
                onChange={(checked) => setModelDraft({ ...modelDraft, supportsImages: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-300">支持思考 / 推理 (Reasoning)</span>
              <Switch
                checked={modelDraft.reasoning}
                onChange={(checked) => setModelDraft({ ...modelDraft, reasoning: checked })}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
