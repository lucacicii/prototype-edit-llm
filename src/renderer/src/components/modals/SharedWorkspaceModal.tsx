import React, { useEffect, useState } from 'react'
import { Modal, Input, Button, message } from 'antd'
import {
  FileText,
  FolderPlus,
  RefreshCw,
  Save,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Copy
} from 'lucide-react'

interface SharedWorkspaceModalProps {
  open: boolean
  workspace: any | null
  initialTab?: 'agents' | 'artifacts'
  onClose: () => void
  onWorkspaceUpdated?: (ws: any) => void
}

const DISABLE_MARKER = '<!-- prototype-studio:disable -->'

export const SharedWorkspaceModal: React.FC<SharedWorkspaceModalProps> = ({
  open,
  workspace,
  initialTab = 'agents',
  onClose,
  onWorkspaceUpdated
}) => {
  const [files, setFiles] = useState<string[]>([])
  const [sharedDir, setSharedDir] = useState<string>('')
  const [agentsDisabled, setAgentsDisabled] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string>('AGENTS.md')
  const [content, setContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // 新建 .ps/ 产物文件
  const [creatingFile, setCreatingFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')

  // 基本信息编辑（工作区名称 & 预览地址）
  const [wsName, setWsName] = useState('')
  const [wsUrl, setWsUrl] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  const workspaceId = workspace?.id
  const dirty = content !== savedContent

  useEffect(() => {
    if (!open || !workspaceId || workspaceId === 'default-host') return
    setWsName(workspace?.name || '')
    setWsUrl(workspace?.url || '')
    void loadAll(initialTab === 'artifacts' ? undefined : 'AGENTS.md')
  }, [open, workspaceId, initialTab])

  const loadAll = async (preferFile?: string) => {
    if (!workspaceId || !window.project?.listSharedFiles) return
    setLoading(true)
    try {
      const res = await window.project.listSharedFiles(workspaceId)
      if (res?.ok) {
        const list = res.files || []
        setFiles(list)
        setSharedDir(res.sharedDir || workspace?.sharedDir || '')
        setAgentsDisabled(Boolean(res.agentsDisabled))
        let target = preferFile
        if (!target) {
          if (initialTab === 'artifacts') {
            target = list.find((f) => f.startsWith('.ps/')) || 'AGENTS.md'
          } else {
            target = list.includes(selectedFile) ? selectedFile : 'AGENTS.md'
          }
        }
        await openFile(target)
      }
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (relPath: string) => {
    if (!workspaceId || !window.project?.readSharedFile) return
    setSelectedFile(relPath)
    const res = await window.project.readSharedFile({ workspaceId, relPath })
    if (res?.ok && typeof res.content === 'string') {
      setContent(res.content)
      setSavedContent(res.content)
      if (typeof res.agentsDisabled === 'boolean') {
        setAgentsDisabled(res.agentsDisabled)
      }
    } else {
      setContent('')
      setSavedContent('')
    }
  }

  const handleSaveFile = async () => {
    if (!workspaceId || !selectedFile || !window.project?.writeSharedFile) return
    setSaving(true)
    try {
      const res = await window.project.writeSharedFile({
        workspaceId,
        relPath: selectedFile,
        content
      })
      if (res?.ok) {
        setSavedContent(content)
        if (res.files) setFiles(res.files)
        if (typeof res.agentsDisabled === 'boolean') setAgentsDisabled(res.agentsDisabled)
        message.success(`已保存 ${selectedFile}`)
      } else {
        message.error(res?.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshAgentsTable = async () => {
    if (!workspaceId || !window.project?.refreshSharedWorkspace) return
    setLoading(true)
    try {
      const res = await window.project.refreshSharedWorkspace(workspaceId)
      if (res?.ok) {
        if (res.workspace) onWorkspaceUpdated?.(res.workspace)
        await openFile('AGENTS.md')
        message.success(
          res.agentsDisabled
            ? 'AGENTS.md 含 disable 标记（用户接管模式），未覆盖托管块'
            : '已按最新仓库列表重新同步 AGENTS.md 地址表'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleToggleDisableOwnership = async () => {
    if (!workspaceId || selectedFile !== 'AGENTS.md') return
    let next: string
    if (content.includes(DISABLE_MARKER)) {
      next = content
        .split('\n')
        .filter((line) => line.trim() !== DISABLE_MARKER)
        .join('\n')
    } else {
      next = `${DISABLE_MARKER}\n${content}`
    }
    setContent(next)
    if (window.project?.writeSharedFile) {
      const res = await window.project.writeSharedFile({
        workspaceId,
        relPath: 'AGENTS.md',
        content: next
      })
      if (res?.ok) {
        setSavedContent(next)
        setAgentsDisabled(Boolean(res.agentsDisabled))
        message.success(
          res.agentsDisabled
            ? '已切换为用户完全接管（程序不再自动重写 AGENTS.md）'
            : '已恢复自动托管地址表'
        )
      }
    }
  }

  const handleCreateArtifact = async () => {
    const raw = newFileName.trim().replace(/^\/+/, '')
    if (!raw || !workspaceId || !window.project?.writeSharedFile) return
    const relPath = raw.startsWith('.ps/') ? raw : `.ps/${raw}`
    const initialBody = `# ${raw.replace(/\.md$/i, '')}\n\n`
    const res = await window.project.writeSharedFile({
      workspaceId,
      relPath,
      content: initialBody
    })
    if (res?.ok) {
      if (res.files) setFiles(res.files)
      setCreatingFile(false)
      setNewFileName('')
      await openFile(relPath)
      message.success(`已创建共享产物 ${relPath}`)
    } else {
      message.error(res?.error || '创建失败')
    }
  }

  const handleDeleteArtifact = async (relPath: string) => {
    if (relPath === 'AGENTS.md' || !workspaceId || !window.project?.deleteSharedFile) return
    Modal.confirm({
      title: '删除共享产物',
      content: `确定要删除 ${relPath} 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const res = await window.project.deleteSharedFile({ workspaceId, relPath })
        if (res?.ok) {
          const nextFiles = res.files || []
          setFiles(nextFiles)
          if (selectedFile === relPath) {
            await openFile('AGENTS.md')
          }
          message.success(`已删除 ${relPath}`)
        } else {
          message.error(res?.error || '删除失败')
        }
      }
    })
  }

  const handleSaveWorkspaceMeta = async () => {
    if (!workspaceId || !window.project?.updateWorkspaceMeta) return
    setSavingMeta(true)
    try {
      const res = await window.project.updateWorkspaceMeta({
        workspaceId,
        name: wsName.trim() || undefined,
        url: wsUrl.trim() || undefined
      })
      if (res?.ok && res.workspace) {
        onWorkspaceUpdated?.(res.workspace)
        if (selectedFile === 'AGENTS.md') {
          await openFile('AGENTS.md')
        }
        message.success('工作区配置已更新并同步至地址表')
      }
    } finally {
      setSavingMeta(false)
    }
  }

  const handleCopyPath = async () => {
    if (!sharedDir) return
    try {
      await navigator.clipboard.writeText(sharedDir)
      message.success('中立目录路径已复制')
    } catch {
      // ignore
    }
  }

  const artifactFiles = files.filter((f) => f !== 'AGENTS.md')

  return (
    <Modal
      open={open}
      title={`🗂️ 共享工作区管理 · ${workspace?.name || ''}`}
      width={860}
      onCancel={onClose}
      footer={
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-slate-400 font-mono truncate max-w-[500px]">
            中立 cwd: {sharedDir || workspace?.sharedDir || '-'}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[11px] text-amber-400 mr-1">● 有未保存修改</span>
            )}
            <Button onClick={onClose}>关闭</Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!dirty}
              icon={<Save size={13} />}
              onClick={handleSaveFile}
            >
              保存文件 ({selectedFile})
            </Button>
          </div>
        </div>
      }
    >
      <div className="py-1 space-y-3 text-xs">
        {/* 顶栏：工作区名称 / 预览地址 / 中立目录说明 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2.5">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">工作区名称</label>
              <Input
                size="small"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                placeholder="工作区名称"
              />
            </div>
            <div className="col-span-6">
              <label className="block text-[11px] text-slate-400 mb-1">
                主预览 Dev Server 地址
              </label>
              <Input
                size="small"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>
            <div className="col-span-2">
              <Button
                size="small"
                block
                loading={savingMeta}
                onClick={handleSaveWorkspaceMeta}
              >
                更新信息
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles size={12} className="text-sky-400 shrink-0" />
              <span className="truncate">
                Agent 启动在 <code className="text-slate-200">{sharedDir}</code>，自动读取{' '}
                <code className="text-sky-300">AGENTS.md</code> 地址表并获得所有关联仓库的访问授权。
              </span>
            </div>
            <button
              onClick={handleCopyPath}
              className="text-sky-400 hover:text-sky-300 flex items-center gap-1 shrink-0 ml-2 cursor-pointer"
            >
              <Copy size={11} />
              <span>复制路径</span>
            </button>
          </div>
        </div>

        {/* 主体：左侧文件树（AGENTS.md + .ps/ 产物）+ 右侧编辑器 */}
        <div className="grid grid-cols-12 gap-3 h-[420px]">
          {/* 左侧文件列表 */}
          <div className="col-span-4 bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col overflow-hidden">
            <div className="text-[11px] font-semibold text-slate-400 mb-1.5 px-1">
              工作区地址表 (Managed)
            </div>
            <button
              onClick={() => openFile('AGENTS.md')}
              className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer mb-3 ${
                selectedFile === 'AGENTS.md'
                  ? 'bg-sky-950/80 text-sky-300 border border-sky-700/70'
                  : 'text-slate-300 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5 font-mono">
                <FileText size={13} className="text-sky-400" />
                <span>AGENTS.md</span>
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded ${
                  agentsDisabled
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}
              >
                {agentsDisabled ? '手动接管' : '自动托管'}
              </span>
            </button>

            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[11px] font-semibold text-slate-400">
                共享产物与笔记 (.ps/)
              </span>
              <button
                onClick={() => {
                  setCreatingFile(true)
                  setNewFileName('notes.md')
                }}
                className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
              >
                <FolderPlus size={12} />
                <span>新建</span>
              </button>
            </div>

            {creatingFile && (
              <div className="mb-2 p-2 rounded bg-slate-900 border border-slate-700 space-y-1.5">
                <div className="text-[10px] text-slate-400">相对路径（自动归入 .ps/ 下）：</div>
                <Input
                  size="small"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="例如 notes.md 或 spec/api.md"
                  onPressEnter={handleCreateArtifact}
                />
                <div className="flex justify-end gap-1.5">
                  <Button size="small" onClick={() => setCreatingFile(false)}>
                    取消
                  </Button>
                  <Button size="small" type="primary" onClick={handleCreateArtifact}>
                    创建
                  </Button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-1">
              {artifactFiles.length === 0 ? (
                <div className="text-[11px] text-slate-500 px-2 py-4 text-center">
                  暂无 .ps/ 共享产物
                  <div className="text-[10px] text-slate-600 mt-1">
                    可新建跨仓库设计笔记、接口约定或由 Agent 自动写入
                  </div>
                </div>
              ) : (
                artifactFiles.map((file) => (
                  <div
                    key={file}
                    onClick={() => openFile(file)}
                    className={`group px-2.5 py-1.5 rounded flex items-center justify-between text-xs cursor-pointer transition ${
                      selectedFile === file
                        ? 'bg-sky-950/80 text-sky-300 border border-sky-700/70'
                        : 'text-slate-300 hover:bg-slate-900 border border-transparent'
                    }`}
                  >
                    <span className="font-mono truncate">{file}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteArtifact(file)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 p-0.5 cursor-pointer"
                      title="删除文件"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 右侧内容编辑区 */}
          <div className="col-span-8 bg-slate-950 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
            <div className="h-9 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs text-slate-200">
                <span>{selectedFile}</span>
                {selectedFile === 'AGENTS.md' && (
                  <span className="text-[10px] text-slate-400 font-sans">
                    （标记块以外的自定义说明在刷新地址表时会自动保留）
                  </span>
                )}
              </div>

              {selectedFile === 'AGENTS.md' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleDisableOwnership}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 cursor-pointer"
                    title="插入或移除 <!-- prototype-studio:disable --> 标记"
                  >
                    {agentsDisabled ? (
                      <>
                        <ShieldCheck size={11} className="text-emerald-400" />
                        <span>恢复自动托管</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={11} className="text-amber-400" />
                        <span>完全手动接管</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleRefreshAgentsTable}
                    disabled={loading}
                    className="text-[11px] px-2 py-0.5 rounded bg-sky-900/60 hover:bg-sky-800/70 text-sky-200 border border-sky-700/60 flex items-center gap-1 cursor-pointer"
                    title="按当前关联仓库重新生成托管块"
                  >
                    <RefreshCw size={11} />
                    <span>同步地址表</span>
                  </button>
                </div>
              )}
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full bg-slate-950 text-slate-200 font-mono text-xs p-3 outline-none resize-none leading-relaxed"
              placeholder="在此编写工作区上下文说明、跨仓约定或产物笔记..."
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
