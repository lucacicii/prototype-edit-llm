import React, { useState } from 'react'
import { Modal, Input, Button, Switch, Select, message } from 'antd'
import { Plus, Trash2, Globe, Cpu, RefreshCw, CloudDownload, Sparkles, Wand2 } from 'lucide-react'
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
import { fetchRemoteModelsHelper, type RemoteModelItem } from '../../utils/fetchModels'

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

  // Remote models fetching
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchingRemoteModels, setFetchingRemoteModels] = useState(false)

  // Keep form in sync when activeGroup changes
  React.useEffect(() => {
    if (activeGroup) {
      setProviderApi(activeGroup.api)
      setProviderBaseUrl(activeGroup.baseUrl)
      setProviderApiKey('')
      setRemoteModels([])
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
    // Auto-fetch remote models if not fetched yet
    if (remoteModels.length === 0) {
      fetchModelsFromProvider()
    }
  }

  const handleOpenEditModel = (model: AgentModelView) => {
    setModelDraft(draftFrom(model))
    setModelModalOpen(true)
  }

  const fetchModelsFromProvider = async () => {
    if (!activeGroup) return
    setFetchingRemoteModels(true)
    try {
      const res = await fetchRemoteModelsHelper({
        provider: activeGroup.provider,
        api: providerApi || activeGroup.api,
        baseUrl: providerBaseUrl || activeGroup.baseUrl,
        apiKey: providerApiKey || undefined
      })
      if (res?.ok && Array.isArray(res.models) && res.models.length > 0) {
        setRemoteModels(res.models)
        message.success(`成功从服务商获取到 ${res.models.length} 个模型！`)
      } else {
        message.warning(res?.error || '未能从该服务商获取到模型列表，请确认网关与密钥是否正确')
      }
    } catch (e: any) {
      message.error(`获取失败: ${e.message}`)
    } finally {
      setFetchingRemoteModels(false)
    }
  }

  const handleSelectRemoteModelToDraft = (model: RemoteModelItem) => {
    if (!modelDraft) return
    setModelDraft({
      ...modelDraft,
      id: model.id,
      name: model.name || '',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: Boolean(model.reasoning),
      supportsImages: Boolean(model.supportsImages),
      thinkingLevels: model.thinkingLevels || ['off'],
      defaultThinkingLevel: model.defaultThinkingLevel || 'off'
    })
    message.success(`已自动填充模型 ${model.id} 的参数与能力！`)
  }

  const handleInferModelCapabilities = () => {
    if (!modelDraft || !modelDraft.id.trim()) {
      message.warning('请先输入模型 ID')
      return
    }
    const id = modelDraft.id.toLowerCase()
    const isReasoning =
      id.includes('r1') ||
      id.includes('reasoner') ||
      id.includes('o1') ||
      id.includes('o3') ||
      id.includes('thinking') ||
      id.includes('qwq')

    const isImage =
      id.includes('4o') ||
      id.includes('vision') ||
      id.includes('vl') ||
      id.includes('claude-3') ||
      id.includes('gemini') ||
      id.includes('omni')

    let ctx = 128000
    if (id.includes('1m') || id.includes('gemini-1.5') || id.includes('gemini-2')) ctx = 1000000
    else if (id.includes('200k') || id.includes('claude-3')) ctx = 200000
    else if (id.includes('64k')) ctx = 64000
    else if (id.includes('32k')) ctx = 32000

    let maxTok = 4096
    if (id.includes('o1') || id.includes('o3')) maxTok = 65536
    else if (id.includes('gpt-4o') || id.includes('claude-3-7')) maxTok = 16384
    else if (id.includes('claude-3-5') || id.includes('deepseek') || id.includes('qwen')) maxTok = 8192

    setModelDraft({
      ...modelDraft,
      contextWindow: ctx,
      maxTokens: maxTok,
      reasoning: isReasoning,
      supportsImages: isImage,
      thinkingLevels: isReasoning ? ['off', 'low', 'medium', 'high'] : ['off'],
      defaultThinkingLevel: isReasoning ? 'medium' : 'off'
    })
    message.success(`已根据模型特征自动推断并填充能力参数！`)
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
      <header className="p-4 pr-16 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={fetchingRemoteModels}
                      onClick={fetchModelsFromProvider}
                      className="h-7 px-2.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      <CloudDownload size={13} className={fetchingRemoteModels ? 'animate-bounce' : ''} />
                      <span>{fetchingRemoteModels ? '拉取中...' : '拉取远端模型列表'}</span>
                    </button>
                    <Button size="small" icon={<Plus size={12} />} onClick={handleOpenAddModel}>
                      添加模型
                    </Button>
                  </div>
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
        width={500}
        onCancel={() => setModelModalOpen(false)}
        onOk={handleSaveModel}
        confirmLoading={savingModel}
        okText="保存"
        cancelText="取消"
      >
        {modelDraft && (
          <div className="py-2 space-y-3.5 text-xs">
            {/* 智能选择与自动填充区域 */}
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>自动获取模型列表与配置</span>
                </span>
                <button
                  type="button"
                  disabled={fetchingRemoteModels}
                  onClick={fetchModelsFromProvider}
                  className="h-6 px-2 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                >
                  <CloudDownload size={12} className={fetchingRemoteModels ? 'animate-bounce' : ''} />
                  <span>{fetchingRemoteModels ? '拉取中...' : '拉取模型'}</span>
                </button>
              </div>

              {remoteModels.length > 0 && !modelDraft.source && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    从获取到的远端模型列表中选择：
                  </label>
                  <Select
                    showSearch
                    style={{ width: '100%' }}
                    placeholder="选择并自动填充模型参数..."
                    value={modelDraft.id || undefined}
                    onChange={(val) => {
                      const m = remoteModels.find((item) => item.id === val)
                      if (m) handleSelectRemoteModelToDraft(m)
                      else setModelDraft({ ...modelDraft, id: val })
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300">
                    模型 ID <span className="text-rose-500">*</span>
                  </label>
                  {!modelDraft.source && (
                    <button
                      type="button"
                      onClick={handleInferModelCapabilities}
                      className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5 cursor-pointer"
                      title="根据模型名称推断窗口与特性"
                    >
                      <Wand2 size={10} />
                      <span>智能推断参数</span>
                    </button>
                  )}
                </div>
                <Input
                  value={modelDraft.id}
                  onChange={(e) => setModelDraft({ ...modelDraft, id: e.target.value })}
                  placeholder="如 gpt-4o / deepseek-chat"
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
                <label className="block text-slate-300 mb-1">上下文窗口 (Context Window)</label>
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
              <span className="text-slate-300">支持多模态图片输入 (Vision)</span>
              <Switch
                checked={modelDraft.supportsImages}
                onChange={(checked) => setModelDraft({ ...modelDraft, supportsImages: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-300">支持思考 / 深度推理 (Reasoning)</span>
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
