import React, { useState, useEffect } from 'react'
import { Dropdown, Modal, Input, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  Folder,
  Plus,
  Copy,
  Trash2,
  FolderOpen,
  Link as LinkIcon,
  ChevronDown,
  Settings
} from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'
import type {
  PrototypeItem,
  ProductScenario,
  PreferredStack
} from '../stores/usePrototypeStore'

interface PrototypeSidebarProps {
  prototypes: PrototypeItem[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (data: {
    name: string
    description: string
    scenario: ProductScenario
    preferredStack: PreferredStack
  }) => void
  onClone: (item: PrototypeItem) => void
  onDelete: (id: string) => void
  onWorkspaceChanged: (ws: any) => void
  onOpenSettings: () => void
  collapsed: boolean
  width: number
  onWidthChange: (w: number) => void
  onResizeDragChange: (dragging: boolean) => void
}

const SCENARIO_OPTIONS: Array<{
  key: ProductScenario
  label: string
  badge: string
  desc: string
}> = [
  {
    key: 'auto',
    label: '🤖 AI 顾问引导规划',
    badge: 'AI 规划',
    desc: '不限定模板，AI 先通过几个问题与你对齐产品需求，再自动决定最佳技术栈'
  },
  {
    key: 'website',
    label: '🌐 品牌官网 / 落地页',
    badge: '官网',
    desc: '适合 SaaS 主页、产品宣传页、营销着陆页，注重视觉表现与转化动线'
  },
  {
    key: 'admin',
    label: '🖥️ 中台 / 后台管理系统',
    badge: '中后台',
    desc: '适合 CRM、ERP、运营工作台，包含筛选表格、表单抽屉与状态流转'
  },
  {
    key: 'mobile',
    label: '📱 手机端 / H5 / 小程序',
    badge: '移动端',
    desc: '适合移动端 App、小程序核心流程原型，采用移动端卡片与底部导航'
  },
  {
    key: 'dashboard',
    label: '📊 数据大屏 / BI 看板',
    badge: '数据看板',
    desc: '适合经营分析看板、实时监控大屏，含指标卡片与多维图表'
  }
]

const STACK_OPTIONS: Array<{ key: PreferredStack; label: string; hint: string }> = [
  { key: 'auto', label: '🤖 由 AI 自动决定（推荐）', hint: 'AI 根据产品问答结果自动选栈' },
  { key: 'native-html', label: '⚡ 轻量 HTML 直出（免构建秒开）', hint: 'HTML5 + Tailwind CDN' },
  { key: 'vue3-element', label: '🟢 Vue 3 + Element Plus', hint: '标准中后台组件库' },
  { key: 'react-ts', label: '⚛️ React + TypeScript', hint: 'React TSX 组件化' }
]

export const PrototypeSidebar: React.FC<PrototypeSidebarProps> = ({
  prototypes,
  activeId,
  onSelect,
  onCreate,
  onClone,
  onDelete,
  onWorkspaceChanged,
  onOpenSettings,
  collapsed,
  width,
  onWidthChange,
  onResizeDragChange
}) => {
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('default-host')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUrlImportModal, setShowUrlImportModal] = useState(false)

  const [newFormName, setNewFormName] = useState('')
  const [newFormDesc, setNewFormDesc] = useState('')
  const [newFormScenario, setNewFormScenario] = useState<ProductScenario>('auto')
  const [newFormStack, setNewFormStack] = useState<PreferredStack>('auto')

  const [urlFormName, setUrlFormName] = useState('')
  const [urlFormUrl, setUrlFormUrl] = useState('')

  useEffect(() => {
    loadWorkspaces()
  }, [])

  async function loadWorkspaces() {
    if (window.project?.listWorkspaces) {
      try {
        const list = await window.project.listWorkspaces()
        setWorkspaces(list || [])
        const cur = await window.project.getCurrentWorkspace()
        if (cur) setActiveWorkspaceId(cur.id)
      } catch (e) {
        console.error('Failed to load workspaces:', e)
      }
    }
  }

  function getFrameworkBadge(fw: string) {
    if (fw === 'vue3') return 'Vue 3'
    if (fw === 'vue2') return 'Vue 2'
    if (fw === 'react') return 'React'
    if (fw === 'native-dom') return 'Web'
    return '工程'
  }

  function formatTime(timestamp: number) {
    const d = new Date(timestamp)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const isDefaultWorkspace = activeWorkspaceId === 'default-host'
  const currentWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0]

  const importMenuItems: MenuProps['items'] = [
    {
      key: 'directory',
      icon: <FolderOpen size={14} />,
      label: '📂 导入本地工程目录...',
      onClick: async () => {
        if (window.project?.importDirectory) {
          const ws = await window.project.importDirectory()
          if (ws) {
            await loadWorkspaces()
            setActiveWorkspaceId(ws.id)
            onWorkspaceChanged(ws)
            message.success(`已导入项目【${ws.name}】(${ws.framework})`)
          }
        }
      }
    },
    {
      key: 'url',
      icon: <LinkIcon size={14} />,
      label: '🔗 导入现有服务 URL...',
      onClick: () => {
        setUrlFormName('')
        setUrlFormUrl('http://localhost:3000')
        setShowUrlImportModal(true)
      }
    }
  ]

  const handleCreate = () => {
    if (!newFormName.trim()) return
    onCreate({
      name: newFormName.trim(),
      description: newFormDesc.trim(),
      scenario: newFormScenario,
      preferredStack: newFormStack
    })
    setNewFormName('')
    setNewFormDesc('')
    setNewFormScenario('auto')
    setNewFormStack('auto')
    setShowCreateModal(false)
  }

  const handleConfirmImportUrl = async () => {
    if (!urlFormUrl.trim()) return
    if (window.project?.importUrl) {
      const ws = await window.project.importUrl({
        url: urlFormUrl.trim(),
        name: urlFormName.trim() || undefined
      })
      await loadWorkspaces()
      setActiveWorkspaceId(ws.id)
      onWorkspaceChanged(ws)
      message.success(`已导入 URL【${ws.name}】`)
      setShowUrlImportModal(false)
    }
  }

  const handleSwitchWorkspace = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const targetId = e.target.value
    setActiveWorkspaceId(targetId)
    if (window.project?.switchWorkspace) {
      const ws = await window.project.switchWorkspace(targetId)
      if (ws) {
        onWorkspaceChanged(ws)
        message.info(`切换至工作区【${ws.name}】`)
      }
    }
  }

  return (
    <aside
      style={{ width }}
      className={`relative bg-slate-950 border-r border-slate-800 ${
        collapsed ? 'hidden' : 'flex'
      } flex-col shrink-0 select-none`}
    >
      <ResizeHandle
        width={width}
        min={200}
        max={480}
        onChange={onWidthChange}
        onDragChange={onResizeDragChange}
      />
      {/* 1. 工作区切换与项目导入顶栏 */}
      <div className="p-2.5 border-b border-slate-800 bg-slate-900/60 flex flex-col gap-2 shrink-0">
        <div className="app-drag traffic-light-inset flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Folder size={14} className="text-sky-400" />
            <span>工作空间</span>
          </span>
          <Dropdown menu={{ items: importMenuItems }} trigger={['click']}>
            <button className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium flex items-center gap-1 transition shadow cursor-pointer">
              <span>+ 导入</span>
              <ChevronDown size={11} />
            </button>
          </Dropdown>
        </div>

        {/* 工作区选择器 */}
        <select
          value={activeWorkspaceId}
          onChange={handleSwitchWorkspace}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none hover:border-slate-600 cursor-pointer"
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name} ({getFrameworkBadge(ws.framework)})
            </option>
          ))}
        </select>
      </div>

      {/* 2. 原型方案列表 */}
      {isDefaultWorkspace ? (
        <>
          <div className="h-10 px-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/30">
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-semibold text-slate-300">原型方案列表</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                {prototypes.length}
              </span>
            </div>
            <button
              className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium flex items-center space-x-1 shadow transition-colors cursor-pointer"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={11} />
              <span>新建方案</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {prototypes.map((item) => {
              const isActive = activeId === item.id
              const lineCount = item.vueCode ? item.vueCode.split('\n').length : 0
              return (
                <div
                  key={item.id}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all group relative ${
                    isActive
                      ? 'bg-indigo-950/70 border-indigo-500/80 shadow-md text-white'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700 text-slate-300'
                  }`}
                  onClick={() => onSelect(item.id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold truncate max-w-[140px] text-xs">
                      {item.name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {formatTime(item.updatedAt)}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                    {item.description || '暂无描述'}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/50 text-[10px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                        {item.techStack === 'react-ts'
                          ? 'React'
                          : item.techStack === 'native-html'
                          ? 'HTML'
                          : 'Vue3'}
                      </span>
                      <span>{lineCount} 行</span>
                    </div>
                    <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                        title="复制副本"
                        onClick={(e) => {
                          e.stopPropagation()
                          onClone(item)
                        }}
                      >
                        <Copy size={10} />
                        <span>复制</span>
                      </button>
                      {prototypes.length > 1 && (
                        <button
                          className="text-rose-400 hover:text-rose-300 flex items-center gap-0.5"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDelete(item.id)
                          }}
                        >
                          <Trash2 size={10} />
                          <span>删除</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        /* 3. 外部工程工作区信息展示 */
        <div className="flex-1 overflow-y-auto p-3 text-xs space-y-3">
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
            <div className="font-semibold text-sky-400 flex items-center justify-between">
              <span>{currentWorkspace?.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 font-mono">
                {currentWorkspace?.framework}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 break-all font-mono">
              {currentWorkspace?.rootPath || currentWorkspace?.url}
            </div>
            {currentWorkspace?.uiLibrary && (
              <div className="text-[11px] text-emerald-400">
                组件库: {currentWorkspace.uiLibrary}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-slate-900/40 text-[11px] text-slate-400 leading-relaxed">
            💡 <b className="text-slate-300">通用圈选与逆向就绪:</b>
            在右侧内置浏览器中打开该项目的任何页面，点击顶部“🎯 圈选”或“✏️ 圈改”，探针即可自动提取真实的框架组件、层级及源码位置！
          </div>
        </div>
      )}

      {/* 3. 底部：模型与 Agent 设置 */}
      <div className="mt-auto p-2.5 border-t border-slate-800 bg-slate-900/60 shrink-0">
        <button
          onClick={onOpenSettings}
          className="w-full px-2.5 py-1.5 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-2 cursor-pointer"
          title="模型与 Agent 设置"
        >
          <Settings size={14} />
          <span>模型与 Agent 设置</span>
        </button>
      </div>

      {/* 新建原型模态框 */}
      <Modal
        open={showCreateModal}
        title="新建独立原型项目"
        width={500}
        onCancel={() => setShowCreateModal(false)}
        onOk={handleCreate}
        okText="创建项目"
        cancelText="取消"
        okButtonProps={{ disabled: !newFormName.trim() }}
      >
        <div className="py-2 space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-300 mb-1">
              项目名称 <span className="text-rose-500">*</span>
            </label>
            <Input
              value={newFormName}
              onChange={(e) => setNewFormName(e.target.value)}
              placeholder="如：SaaS 品牌官网 / 订单履约中台 / 生鲜配送小程序"
              maxLength={28}
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">
              选择产品场景模板（不选则默认由 AI 顾问提问规划）
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {SCENARIO_OPTIONS.map((opt) => {
                const active = newFormScenario === opt.key
                return (
                  <div
                    key={opt.key}
                    onClick={() => setNewFormScenario(opt.key)}
                    className={`p-2 rounded-lg border cursor-pointer transition ${
                      active
                        ? 'bg-indigo-950/60 border-indigo-500/80 text-white'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-semibold text-xs flex items-center justify-between">
                      <span>{opt.label}</span>
                      {active && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-600 text-white">
                          已选
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1">
              技术栈偏好（可选）
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {STACK_OPTIONS.map((st) => {
                const active = newFormStack === st.key
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setNewFormStack(st.key)}
                    className={`p-2 rounded-lg border text-left transition cursor-pointer ${
                      active
                        ? 'bg-sky-950/60 border-sky-500/80 text-sky-200'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-medium text-[11px]">{st.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{st.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1">项目背景或初始想法（可选）</label>
            <Input.TextArea
              value={newFormDesc}
              onChange={(e) => setNewFormDesc(e.target.value)}
              rows={2}
              placeholder="简述目标用户、核心功能点或参考风格（留空也可创建后在对话中直接和 AI 聊）"
            />
          </div>
        </div>
      </Modal>

      {/* 导入 URL 模态框 */}
      <Modal
        open={showUrlImportModal}
        title="导入现有服务 / 网页 URL"
        width={420}
        onCancel={() => setShowUrlImportModal(false)}
        onOk={handleConfirmImportUrl}
        okText="确定导入"
        cancelText="取消"
        okButtonProps={{ disabled: !urlFormUrl.trim() }}
      >
        <div className="py-2 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">项目或系统名称</label>
            <Input
              value={urlFormName}
              onChange={(e) => setUrlFormName(e.target.value)}
              placeholder="如：商户后台本地开发服务 / 线上管理系统"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              服务访问 URL <span className="text-rose-500">*</span>
            </label>
            <Input
              value={urlFormUrl}
              onChange={(e) => setUrlFormUrl(e.target.value)}
              placeholder="如：http://localhost:3000 或 https://example.com"
            />
          </div>
        </div>
      </Modal>
    </aside>
  )
}
