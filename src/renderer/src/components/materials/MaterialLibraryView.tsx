import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Input, Modal, Switch, message } from 'antd'
import {
  Package,
  Upload,
  Image as ImageIcon,
  FileText,
  Database,
  Code2,
  File,
  Trash2,
  Copy,
  CheckCircle2,
  Search,
  Sparkles,
  ExternalLink,
  RefreshCw,
  FolderPlus
} from 'lucide-react'
import {
  useMaterialStore,
  type MaterialCategory,
  type MaterialItem
} from '../../stores/useMaterialStore'

const CATEGORY_TABS: Array<{
  key: 'all' | MaterialCategory
  label: string
  icon: React.ReactNode
}> = [
  { key: 'all', label: '全部物料', icon: <Package size={13} /> },
  { key: 'image', label: '图片素材', icon: <ImageIcon size={13} /> },
  { key: 'document', label: '文档规范', icon: <FileText size={13} /> },
  { key: 'data', label: '数据样本 (JSON/CSV)', icon: <Database size={13} /> },
  { key: 'code', label: '代码/组件片段', icon: <Code2 size={13} /> },
  { key: 'other', label: '其他文件', icon: <File size={13} /> }
]

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  image: '图片素材',
  document: '文档规范',
  data: '数据样本',
  code: '代码片段',
  other: '其他文件'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const MaterialLibraryView: React.FC = () => {
  const {
    materials,
    loading,
    loadMaterials,
    uploadViaDialog,
    uploadFiles,
    updateMaterial,
    deleteMaterial,
    toggleAllEnabled
  } = useMaterialStore()

  const [activeCategory, setActiveCategory] = useState<'all' | MaterialCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Selected item detail state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCategory, setEditCategory] = useState<MaterialCategory>('other')
  const [textPreview, setTextPreview] = useState<{
    loading: boolean
    isText: boolean
    content?: string
    truncated?: boolean
  }>({ loading: false, isText: false })

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadMaterials()
  }, [])

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return materials.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q)
      )
    })
  }, [materials, activeCategory, searchQuery])

  const selectedItem = useMemo(
    () => materials.find((m) => m.id === selectedId) || filteredMaterials[0] || null,
    [materials, selectedId, filteredMaterials]
  )

  useEffect(() => {
    if (!selectedItem) {
      setEditName('')
      setEditDesc('')
      setTextPreview({ loading: false, isText: false })
      return
    }
    setEditName(selectedItem.name)
    setEditDesc(selectedItem.description || '')
    setEditCategory(selectedItem.category)

    let cancelled = false
    if (selectedItem.category !== 'image' && window.materialApi?.readContent) {
      setTextPreview({ loading: true, isText: false })
      window.materialApi
        .readContent(selectedItem.id)
        .then((res) => {
          if (cancelled) return
          if (res?.ok && res.isText) {
            setTextPreview({
              loading: false,
              isText: true,
              content: res.content || '',
              truncated: res.truncated
            })
          } else {
            setTextPreview({ loading: false, isText: false })
          }
        })
        .catch(() => {
          if (!cancelled) setTextPreview({ loading: false, isText: false })
        })
    } else {
      setTextPreview({ loading: false, isText: false })
    }

    return () => {
      cancelled = true
    }
  }, [selectedItem?.id])

  const enabledCount = useMemo(
    () => materials.filter((m) => m.enabled !== false).length,
    [materials]
  )

  const handleUploadDialog = async () => {
    const added = await uploadViaDialog(
      activeCategory !== 'all' ? { category: activeCategory } : undefined
    )
    if (added.length > 0) {
      setSelectedId(added[0].id)
      message.success(`已上传 ${added.length} 项物料至物料库`)
    }
  }

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    const added = await uploadFiles(
      files,
      activeCategory !== 'all' ? { category: activeCategory } : undefined
    )
    if (added.length > 0) {
      setSelectedId(added[0].id)
      message.success(`已上传 ${added.length} 项物料至物料库`)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    const added = await uploadFiles(
      files,
      activeCategory !== 'all' ? { category: activeCategory } : undefined
    )
    if (added.length > 0) {
      setSelectedId(added[0].id)
      message.success(`已导入 ${added.length} 项物料`)
    }
  }

  const handleSaveMeta = async () => {
    if (!selectedItem) return
    const updated = await updateMaterial({
      id: selectedItem.id,
      name: editName.trim() || selectedItem.name,
      description: editDesc.trim(),
      category: editCategory
    })
    if (updated) {
      message.success('已保存物料说明与属性')
    }
  }

  const handleToggleEnabled = async (item: MaterialItem, enabled: boolean) => {
    await updateMaterial({ id: item.id, enabled })
    message.info(
      enabled
        ? `已将「${item.name}」设为原型依赖`
        : `已取消「${item.name}」的默认原型依赖`
    )
  }

  const handleDelete = (item: MaterialItem) => {
    Modal.confirm({
      title: '删除物料',
      content: `确定从物料库中删除「${item.name} (${item.fileName})」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteMaterial(item.id)
        if (selectedId === item.id) {
          setSelectedId(null)
        }
        message.info('已删除物料')
      }
    })
  }

  const copyToClipboard = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(tip)
    } catch {
      message.warning('复制失败')
    }
  }

  const renderCategoryBadge = (cat: MaterialCategory) => {
    if (cat === 'image') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-pink-500/15 text-pink-300 border border-pink-500/30">
          图片
        </span>
      )
    }
    if (cat === 'document') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
          文档
        </span>
      )
    }
    if (cat === 'data') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          数据
        </span>
      )
    }
    if (cat === 'code') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
          代码
        </span>
      )
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
        文件
      </span>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0 h-full bg-slate-950 text-slate-100 select-none relative overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault()
        if (!isDraggingOver) setIsDraggingOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDraggingOver(false)
      }}
      onDrop={handleDrop}
    >
      {/* 拖拽上传遮罩 */}
      {isDraggingOver && (
        <div className="absolute inset-4 z-50 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 pointer-events-none">
          <Upload size={42} className="text-indigo-300 animate-bounce" />
          <div className="text-base font-semibold text-white">松开鼠标即可上传文件或图片至物料库</div>
          <div className="text-xs text-indigo-200">
            支持 PNG / JPG / SVG / WebP 图片、Markdown / TXT 需求文档、JSON / CSV 数据样本及代码文件
          </div>
        </div>
      )}

      {/* 顶栏 Header */}
      <header className="app-drag h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Package size={17} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100">原型物料库</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/80 font-mono">
                已启用依赖 {enabledCount} / {materials.length}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              上传图片素材、业务规范文档、JSON/CSV 数据作为原型依赖，AI 生成与修改原型时将自动引用
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            onClick={() => void loadMaterials()}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
            title="刷新物料列表"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            onClick={handleUploadDialog}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition cursor-pointer"
          >
            <Upload size={14} />
            <span>上传文件 / 图片</span>
          </button>
        </div>
      </header>

      {/* 分类过滤与搜索工具栏 */}
      <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORY_TABS.map((tab) => {
            const active = activeCategory === tab.key
            const count =
              tab.key === 'all'
                ? materials.length
                : materials.filter((m) => m.category === tab.key).length
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveCategory(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    active ? 'bg-indigo-800/80 text-indigo-100' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          {materials.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => void toggleAllEnabled(true)}
                className="hover:text-indigo-300 transition cursor-pointer"
              >
                全部启用
              </button>
              <span className="text-slate-700">|</span>
              <button
                type="button"
                onClick={() => void toggleAllEnabled(false)}
                className="hover:text-slate-200 transition cursor-pointer"
              >
                全部停用
              </button>
            </div>
          )}

          <div className="relative w-64">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索物料名称、文件名或用途说明..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 text-xs text-slate-200 outline-none transition"
            />
          </div>
        </div>
      </div>

      {/* 主体：左侧物料网格 + 右侧详情与预览面板 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 左侧物料卡片区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredMaterials.length === 0 ? (
            <div className="h-full min-h-[340px] rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-3">
                <FolderPlus size={26} />
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">
                {materials.length === 0 ? '物料库还是空的' : '没有匹配的物料'}
              </h3>
              <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-5">
                {materials.length === 0
                  ? '你可以上传产品 Logo、页面 Banner 图、图标、PRD 文档、JSON Mock 数据或组件代码作为原型的物料依赖。开启依赖后，AI 会在生成原型时自动使用这些真实素材。'
                  : '尝试切换分类标签或清空搜索关键词。'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleUploadDialog}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 shadow cursor-pointer transition"
                >
                  <Upload size={14} />
                  <span>选择文件或图片上传</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredMaterials.map((item) => {
                const isSelected = selectedItem?.id === item.id
                const isEnabled = item.enabled !== false
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`group rounded-xl border transition flex flex-col overflow-hidden cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/30 border-indigo-500 ring-1 ring-indigo-500/40'
                        : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    {/* 缩略预览区 */}
                    <div className="relative h-36 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-center overflow-hidden">
                      {item.category === 'image' && item.url ? (
                        <img
                          src={item.url}
                          alt={item.name}
                          className="w-full h-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-500">
                          {item.category === 'document' ? (
                            <FileText size={32} className="text-sky-400/80" />
                          ) : item.category === 'data' ? (
                            <Database size={32} className="text-emerald-400/80" />
                          ) : item.category === 'code' ? (
                            <Code2 size={32} className="text-amber-400/80" />
                          ) : (
                            <File size={32} className="text-slate-400/80" />
                          )}
                          <span className="text-[11px] font-mono text-slate-400 px-2 truncate max-w-[180px]">
                            {item.fileName}
                          </span>
                        </div>
                      )}

                      {/* 左上角分类标签 */}
                      <div className="absolute top-2 left-2">
                        {renderCategoryBadge(item.category)}
                      </div>

                      {/* 右上角依赖开关状态 */}
                      <div
                        className="absolute top-2 right-2 flex items-center gap-1 bg-slate-950/85 backdrop-blur px-2 py-0.5 rounded-full border border-slate-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          size="small"
                          checked={isEnabled}
                          onChange={(checked) => void handleToggleEnabled(item, checked)}
                        />
                        <span
                          className={`text-[10px] font-medium ${
                            isEnabled ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {isEnabled ? '依赖中' : '未启用'}
                        </span>
                      </div>
                    </div>

                    {/* 底部信息区 */}
                    <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-xs font-semibold text-slate-100 truncate">
                            {item.name}
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">
                            {formatBytes(item.size)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 line-clamp-2 min-h-[30px]">
                          {item.description || (
                            <span className="text-slate-600 italic">
                              暂无用途说明（可在右侧添加备注供 AI 理解）
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-mono truncate max-w-[140px]" title={`#materials/${item.fileName}`}>
                          #materials/{item.fileName}
                        </span>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              void copyToClipboard(
                                `#materials/${item.fileName}`,
                                `已复制引用标签 #materials/${item.fileName}，可粘贴到 AI 对话框`
                              )
                            }
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-indigo-300 transition cursor-pointer"
                            title="复制 #引用 标签用于对话"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                            title="删除物料"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 右侧物料详情与依赖配置侧栏 */}
        {selectedItem && (
          <aside className="w-96 border-l border-slate-800 bg-slate-900/70 flex flex-col shrink-0 overflow-y-auto">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles size={15} className="text-indigo-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200 truncate">
                  物料属性与依赖配置
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(selectedItem)}
                className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>删除</span>
              </button>
            </div>

            <div className="p-4 space-y-4 flex-1">
              {/* 依赖开关卡片 */}
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <CheckCircle2
                      size={14}
                      className={
                        selectedItem.enabled !== false ? 'text-emerald-400' : 'text-slate-500'
                      }
                    />
                    <span>作为原型默认物料依赖</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    开启后，AI 生成或修改原型时会自动获知该物料
                  </div>
                </div>
                <Switch
                  checked={selectedItem.enabled !== false}
                  onChange={(checked) => void handleToggleEnabled(selectedItem, checked)}
                />
              </div>

              {/* 预览窗口 */}
              <div>
                <div className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                  <span>物料内容预览</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {selectedItem.mimeType} · {formatBytes(selectedItem.size)}
                  </span>
                </div>

                {selectedItem.category === 'image' && selectedItem.url ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col items-center gap-2">
                    <img
                      src={selectedItem.url}
                      alt={selectedItem.name}
                      className="max-h-52 object-contain rounded"
                    />
                  </div>
                ) : textPreview.loading ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-500 text-center">
                    正在读取文件内容...
                  </div>
                ) : textPreview.isText ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                    <pre className="p-3 text-[11px] font-mono text-slate-300 max-h-52 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
                      {textPreview.content || '(空文件)'}
                    </pre>
                    {textPreview.truncated && (
                      <div className="px-3 py-1 bg-slate-900 border-t border-slate-800 text-[10px] text-amber-400">
                        文件较大，仅展示前 128 KB 预览，Agent 可读取完整文件
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 text-center">
                    二进制文件（{selectedItem.fileName}），已就绪可供原型工程直接引用
                  </div>
                )}
              </div>

              {/* 快捷引用方式 */}
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-300">
                  在原型对话或代码中引用
                </label>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400 shrink-0">对话点名引用:</span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          `#materials/${selectedItem.fileName}`,
                          '已复制对话引用标签，可在 AI 对话框直接粘贴'
                        )
                      }
                      className="font-mono text-indigo-300 hover:text-indigo-200 flex items-center gap-1 truncate cursor-pointer"
                    >
                      <span className="truncate">#materials/{selectedItem.fileName}</span>
                      <Copy size={11} className="shrink-0" />
                    </button>
                  </div>

                  {selectedItem.url && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">HTTP 预览地址:</span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(
                            selectedItem.url!,
                            '已复制物料 HTTP URL（可用于 <img> 或 fetch）'
                          )
                        }
                        className="font-mono text-sky-300 hover:text-sky-200 flex items-center gap-1 truncate cursor-pointer"
                        title={selectedItem.url}
                      >
                        <span className="truncate">{selectedItem.url}</span>
                        <ExternalLink size={11} className="shrink-0" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 编辑元数据表单 */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    物料名称
                  </label>
                  <Input
                    size="small"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="如：品牌 Logo / 首页主视觉图 / 订单接口 JSON"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    物料分类
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditCategory(cat)}
                        className={`px-2 py-1 rounded text-[11px] border transition cursor-pointer ${
                          editCategory === cat
                            ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 font-medium'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    AI 用途说明（告诉 Agent 如何使用该物料）
                  </label>
                  <Input.TextArea
                    rows={3}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="例如：这是导航栏左上角的品牌 Logo；或：这是商品列表表格的真实字段与测试数据，请按此渲染表格"
                    className="text-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleSaveMeta()}
                  className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow transition cursor-pointer"
                >
                  保存物料信息
                </button>

                <div className="text-[10px] text-slate-500 pt-1">
                  上传时间：{formatDate(selectedItem.createdAt)} · 原始文件名：{selectedItem.originalName}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
