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
  ChevronDown
} from 'lucide-react'
import type { PrototypeItem } from '../stores/usePrototypeStore'

interface PrototypeSidebarProps {
  prototypes: PrototypeItem[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (data: { name: string; description: string }) => void
  onClone: (item: PrototypeItem) => void
  onDelete: (id: string) => void
  onWorkspaceChanged: (ws: any) => void
}

export const PrototypeSidebar: React.FC<PrototypeSidebarProps> = ({
  prototypes,
  activeId,
  onSelect,
  onCreate,
  onClone,
  onDelete,
  onWorkspaceChanged
}) => {
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('default-host')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUrlImportModal, setShowUrlImportModal] = useState(false)

  const [newFormName, setNewFormName] = useState('')
  const [newFormDesc, setNewFormDesc] = useState('')

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
      description: newFormDesc.trim()
    })
    setNewFormName('')
    setNewFormDesc('')
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
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 select-none">
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
                    <span>{lineCount} 行代码</span>
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

      {/* 新建原型模态框 */}
      <Modal
        open={showCreateModal}
        title="新建原型页面"
        width={420}
        onCancel={() => setShowCreateModal(false)}
        onOk={handleCreate}
        okText="确定创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newFormName.trim() }}
      >
        <div className="py-2 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              原型名称 <span className="text-rose-500">*</span>
            </label>
            <Input
              value={newFormName}
              onChange={(e) => setNewFormName(e.target.value)}
              placeholder="如：订单履约中心 / 财务结算审批"
              maxLength={20}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">原型简要描述</label>
            <Input.TextArea
              value={newFormDesc}
              onChange={(e) => setNewFormDesc(e.target.value)}
              rows={2}
              placeholder="描述该原型的核心业务诉求与关键组件"
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
