import React, { useState } from 'react'
import { Modal, Input, Button, Switch, Select, message } from 'antd'
import { Plus, Trash2, Globe, Cpu, RefreshCw, CloudDownload, Sparkles, Wand2, Download } from 'lucide-react'
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
import {
  fetchRemoteModelsHelper,
  inferModelCapabilities,
  probeThinkingLevelsHelper,
  sortThinkingLevels,
  type RemoteModelItem
} from '../../utils/fetchModels'

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
  const [syncingThunder, setSyncingThunder] = useState(false)

  // Model modal
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  const [savingModel, setSavingModel] = useState(false)

  // Remote models fetching
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([])
  const [fetchingRemoteModels, setFetchingRemoteModels] = useState(false)
  const [probingThinking, setProbingThinking] = useState(false)

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

  // 手动从 Thunder 配置一次性导入模型：只在点击时读 Thunder 配置目录
  //（$THUNDER_CONFIG_DIR 优先，否则 ~/.thunder），按"自家已有永远赢"合并
  //（同 id 跳过、同 provider 端点冲突整条跳过）。ok:true 即成功：无新增时
  // 显示"无变化"，真冲突才走 warning；ok:false 只剩报错场景。
  const handleSyncThunder = async () => {
    if (!window.agent?.syncThunderModels) return
    setSyncingThunder(true)
    try {
      const res = await window.agent.syncThunderModels()
      if (res?.ok) {
        const sourceSuffix = res.sourceDir ? `（来源：${res.sourceDir}）` : ''
        const changed = (res.imported?.length ?? 0) > 0 || (res.keysImported?.length ?? 0) > 0
        if (!changed) {
          message.success(`Thunder 配置与自家一致，无变化${sourceSuffix}`)
        } else {
          const parts: string[] = []
          if (res.imported?.length) parts.push(`导入 ${res.imported.length} 个（${res.imported.slice(0, 3).join('、')}${res.imported.length > 3 ? '…' : ''}）`)
          if (res.skipped?.length) parts.push(`跳过 ${res.skipped.length} 个（自家已有）`)
          if (res.conflicts?.length) parts.push(`${res.conflicts.length} 个冲突未导入`)
          if (res.keysImported?.length) parts.push(`存入 ${res.keysImported.length} 把密钥`)
          message.success(`从 Thunder 同步完成${sourceSuffix}：${parts.join('，')}`)
          if (res.conflicts?.length) {
            message.warning(`首条冲突：${res.conflicts[0].selectionId}——${res.conflicts[0].reason}`, 8)
          }
        }
        await refresh()
      } else {
        message.error(res?.error || '未能从 Thunder 导入模型')
      }
    } catch (e: any) {
      message.error(`同步失败：${e?.message ?? e}`)
    } finally {
      setSyncingThunder(false)
    }
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

  const probeThinkingForModel = async (targetModelId: string, silent = false) => {
    if (!activeGroup || !targetModelId.trim()) return
    setProbingThinking(true)
    try {
      const res = await probeThinkingLevelsHelper({
        provider: activeGroup.provider,
        api: providerApi || activeGroup.api,
        baseUrl: providerBaseUrl || activeGroup.baseUrl,
        apiKey: providerApiKey || undefined,
        modelId: targetModelId.trim()
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
              : levels[0] || 'off'

        setModelDraft((prev) => {
          if (!prev || prev.id.trim() !== targetModelId.trim()) return prev
          return {
            ...prev,
            reasoning,
            thinkingLevels: levels,
            defaultThinkingLevel
          }
        })

        if (!silent) {
          const sourceLabel = res.probed ? '远端网关探测' : '模型特征推断'
          message.success(
            `已通过${sourceLabel}获取思考等级：${levels.map((l) => l.toUpperCase()).join(' / ')}`
          )
        }
      } else if (!silent) {
        message.warning(res?.error || '未能探测到思考等级')
      }
    } catch (e: any) {
      if (!silent) {
        message.error(`探测思考等级失败: ${e.message}`)
      }
    } finally {
      setProbingThinking(false)
    }
  }

  const handleSelectRemoteModelToDraft = (model: RemoteModelItem) => {
    if (!modelDraft) return
    const levels = model.thinkingLevels?.length ? sortThinkingLevels(model.thinkingLevels) : ['off']
    const reasoning =
      typeof model.reasoning === 'boolean'
        ? model.reasoning
        : levels.some((lv) => lv !== 'off' && lv !== 'none')
    const defaultThinkingLevel =
      model.defaultThinkingLevel && levels.includes(model.defaultThinkingLevel)
        ? model.defaultThinkingLevel
        : reasoning
          ? levels.includes('medium')
            ? 'medium'
            : levels[levels.length - 1]
          : 'off'

    setModelDraft({
      ...modelDraft,
      id: model.id,
      name: model.name || '',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning,
      supportsImages: Boolean(model.supportsImages),
      thinkingLevels: levels,
      defaultThinkingLevel
    })
    message.success(`已自动填充模型 ${model.id} 的参数与能力！`)
    // Actively probe the gateway in background to refine exact thinking levels
    void probeThinkingForModel(model.id, true)
  }

  const handleInferModelCapabilities = async () => {
    if (!modelDraft || !modelDraft.id.trim()) {
      message.warning('请先输入模型 ID')
      return
    }
    const targetId = modelDraft.id.trim()
    const caps = inferModelCapabilities(targetId)

    setModelDraft((prev) =>
      prev
        ? {
            ...prev,
            contextWindow: caps.contextWindow,
            maxTokens: caps.maxTokens,
            reasoning: caps.reasoning,
            supportsImages: caps.supportsImages,
            thinkingLevels: caps.thinkingLevels,
            defaultThinkingLevel: caps.defaultThinkingLevel
          }
        : prev
    )
    await probeThinkingForModel(targetId, false)
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
          <Button
            size="small"
            icon={<Download size={12} className={syncingThunder ? 'animate-bounce' : ''} />}
            onClick={handleSyncThunder}
            loading={syncingThunder}
            title="只在点击时读取 Thunder 配置（$THUNDER_CONFIG_DIR 优先，否则 ~/.thunder），按自家优先合并导入"
          >
            {syncingThunder ? '同步中…' : '从 Thunder 同步'}
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
          <Button className="mt-2" icon={<Download size={12} />} onClick={handleSyncThunder} loading={syncingThunder} title="只在点击时读取 Thunder 配置（$THUNDER_CONFIG_DIR 优先，否则 ~/.thunder），按自家优先合并导入">
            {syncingThunder ? '同步中…' : '从 Thunder 同步已有模型'}
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
                          {model.reasoning && (
                            <span>
                              支持思考 (
                              {(model.thinkingLevels?.length
                                ? model.thinkingLevels
                                : ['off', 'low', 'medium', 'high']
                              )
                                .map((l) => l.toUpperCase())
                                .join('/')}
                              )
                            </span>
                          )}
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
              <div className="flex items-center gap-2">
                <span className="text-slate-300">支持思考 / 深度推理 (Reasoning)</span>
                <button
                  type="button"
                  disabled={probingThinking || !modelDraft.id.trim()}
                  onClick={() => probeThinkingForModel(modelDraft.id, false)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                  title="向服务商发起轻量请求，自动探测该模型支持的思考等级"
                >
                  <Wand2 size={10} className={probingThinking ? 'animate-spin' : ''} />
                  <span>{probingThinking ? '探测中...' : '自动探测等级'}</span>
                </button>
              </div>
              <Switch
                checked={modelDraft.reasoning}
                onChange={(checked) => {
                  const nextLevels = checked
                    ? modelDraft.thinkingLevels.some((lv) => lv !== 'off' && lv !== 'none')
                      ? modelDraft.thinkingLevels
                      : ['off', 'low', 'medium', 'high']
                    : ['off']
                  const nextDefault = checked
                    ? nextLevels.includes(modelDraft.defaultThinkingLevel) &&
                      modelDraft.defaultThinkingLevel !== 'off'
                      ? modelDraft.defaultThinkingLevel
                      : nextLevels.includes('medium')
                        ? 'medium'
                        : nextLevels[nextLevels.length - 1] || 'off'
                    : 'off'
                  setModelDraft({
                    ...modelDraft,
                    reasoning: checked,
                    thinkingLevels: nextLevels,
                    defaultThinkingLevel: nextDefault
                  })
                }}
              />
            </div>

            {/* 思考等级与默认档位配置 */}
            <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-medium">
                  思考等级档位 (Thinking Levels)
                </label>
                <span className="text-[10px] text-slate-500">
                  点选启用模型支持的思考强度
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(vocabularies.thinkingVocabulary?.length
                  ? vocabularies.thinkingVocabulary
                  : ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
                ).map((lv) => {
                  const active = modelDraft.thinkingLevels.includes(lv)
                  return (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => {
                        const exists = modelDraft.thinkingLevels.includes(lv)
                        const rawNext = exists
                          ? modelDraft.thinkingLevels.filter((item) => item !== lv)
                          : [...modelDraft.thinkingLevels, lv]
                        const nextLevels =
                          rawNext.length > 0 ? sortThinkingLevels(rawNext) : ['off']
                        const hasReasoning = nextLevels.some(
                          (item) => item !== 'off' && item !== 'none'
                        )
                        const nextDefault = nextLevels.includes(modelDraft.defaultThinkingLevel)
                          ? modelDraft.defaultThinkingLevel
                          : hasReasoning && nextLevels.includes('medium')
                            ? 'medium'
                            : nextLevels[0] || 'off'
                        setModelDraft({
                          ...modelDraft,
                          reasoning: hasReasoning,
                          thinkingLevels: nextLevels,
                          defaultThinkingLevel: nextDefault
                        })
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border transition cursor-pointer ${
                        active
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-semibold'
                          : 'bg-slate-800/60 text-slate-400 border-slate-700/70 hover:border-slate-600'
                      }`}
                    >
                      {lv.toUpperCase()}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="text-slate-400 text-[11px]">默认思考档位</label>
                <Select
                  size="small"
                  style={{ width: 140 }}
                  value={
                    modelDraft.thinkingLevels.includes(modelDraft.defaultThinkingLevel)
                      ? modelDraft.defaultThinkingLevel
                      : modelDraft.thinkingLevels[0] || 'off'
                  }
                  onChange={(val) =>
                    setModelDraft({ ...modelDraft, defaultThinkingLevel: val })
                  }
                  options={(modelDraft.thinkingLevels.length
                    ? modelDraft.thinkingLevels
                    : ['off']
                  ).map((lv) => ({
                    label: lv.toUpperCase(),
                    value: lv
                  }))}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
