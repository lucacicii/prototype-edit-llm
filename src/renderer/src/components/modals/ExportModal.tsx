import React, { useState, useEffect } from 'react'
import { Modal, Input, Button, Alert, Checkbox, message } from 'antd'
import { FolderOpen } from 'lucide-react'

interface ExportModalProps {
  open: boolean
  codeContent: string
  techStack?: 'vue3-element' | 'react-ts' | 'native-html'
  onClose: () => void
  onSuccess?: (path: string) => void
}

const defaultPasswordTemplateDir =
  '/Users/lucas/wb/refactoring/wb-tools/packages/web-ums-password-template'

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  codeContent,
  techStack = 'vue3-element',
  onClose,
  onSuccess
}) => {
  const ext = techStack === 'react-ts' ? 'tsx' : techStack === 'native-html' ? 'html' : 'vue'
  const defaultRelPath = `src/views/prototype-demo/index.${ext}`

  const [targetDir, setTargetDir] = useState(
    localStorage.getItem('wb_prototype_export_dir') || defaultPasswordTemplateDir
  )
  const [relativeFilePath, setRelativeFilePath] = useState(defaultRelPath)
  const [fileExists, setFileExists] = useState(false)
  const [exporting, setExporting] = useState(false)

  const computedFullPath = targetDir && relativeFilePath
    ? `${targetDir.replace(/\/+$/, '')}/${relativeFilePath.replace(/^\/+/, '')}`
    : ''

  useEffect(() => {
    setRelativeFilePath(defaultRelPath)
  }, [techStack])

  useEffect(() => {
    async function checkExists() {
      if (!computedFullPath || !window.project?.checkFileExists) {
        setFileExists(false)
        return
      }
      const res = await window.project.checkFileExists(computedFullPath)
      setFileExists(Boolean(res?.exists))
    }
    checkExists()
  }, [computedFullPath])

  const handleSelectDir = async () => {
    if (!window.project?.selectDirectory) return
    const dir = await window.project.selectDirectory()
    if (dir) {
      setTargetDir(dir)
      localStorage.setItem('wb_prototype_export_dir', dir)
    }
  }

  const handleConfirmExport = async () => {
    if (!window.project?.saveCode) {
      message.warning('当前运行在纯浏览器模式下，无法使用桌面落盘功能')
      return
    }

    if (fileExists) {
      Modal.confirm({
        title: '覆盖确认',
        content: '目标文件已存在，确认覆盖现有代码吗？',
        okText: '覆盖并导出',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          await doExport()
        }
      })
      return
    }

    await doExport()
  }

  const doExport = async () => {
    setExporting(true)
    try {
      const res = await window.project.saveCode({
        filePath: computedFullPath,
        content: codeContent
      })
      if (res?.success) {
        message.success(`代码已成功导出到: ${res.savedPath || computedFullPath}`)
        onSuccess?.(res.savedPath || computedFullPath)
        onClose()
      } else {
        message.error(`导出失败: ${res?.error || '未知错误'}`)
      }
    } catch (err: any) {
      message.error(`导出异常: ${err.message || String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="导出页面文件至本地业务工程"
      width={620}
      onCancel={onClose}
      onOk={handleConfirmExport}
      confirmLoading={exporting}
      okText="立即导出"
      cancelText="取消"
      okButtonProps={{ disabled: !targetDir || !relativeFilePath }}
    >
      <div className="py-2 space-y-4 text-xs">
        <div>
          <label className="block text-slate-300 font-medium mb-1">
            目标工程目录 (Workspace / Project Path)
          </label>
          <div className="flex gap-2">
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder="例如: /path/to/project"
            />
            <Button icon={<FolderOpen size={14} />} onClick={handleSelectDir}>
              浏览目录...
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            默认为 <code>web-ums-password-template</code> 工程根目录
          </p>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            相对页面文件路径 (Relative File Path)
          </label>
          <Input
            value={relativeFilePath}
            onChange={(e) => setRelativeFilePath(e.target.value)}
            placeholder={`例如: src/views/prototype-demo/index.${ext}`}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            支持自动创建未存在的父目录，当前技术栈默认扩展名：<code>.{ext}</code>
          </p>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">路由同步</label>
          <Checkbox disabled>
            <span className="text-slate-500">
              自动写入业务工程路由 (src/router/local_router.ts)
              <span className="ml-1 text-amber-500">（暂未支持）</span>
            </span>
          </Checkbox>
          <p className="text-[11px] text-slate-500 mt-1">
            当前仅导出单个页面文件，导出后请自行配置路由
          </p>
        </div>

        {computedFullPath && (
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px]">
            <span className="text-slate-400">完整落盘路径：</span>
            <code className="text-sky-300 break-all ml-1">{computedFullPath}</code>
          </div>
        )}

        {fileExists && (
          <Alert
            message="注意：目标文件已存在，确认导出将直接覆盖该文件！"
            type="warning"
            showIcon
          />
        )}
      </div>
    </Modal>
  )
}
