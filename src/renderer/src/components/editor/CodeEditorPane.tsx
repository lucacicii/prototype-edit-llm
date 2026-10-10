import React from 'react'
import { message } from 'antd'
import { Copy, Code2 } from 'lucide-react'
import Editor from '@monaco-editor/react'

interface CodeEditorPaneProps {
  code: string
  techStack?: 'vue3-element' | 'react-ts' | 'native-html'
  onChange?: (newCode: string) => void
}

export const CodeEditorPane: React.FC<CodeEditorPaneProps> = ({
  code,
  techStack = 'vue3-element',
  onChange
}) => {
  const getLanguage = () => {
    if (techStack === 'react-ts') return 'typescript'
    if (techStack === 'native-html') return 'html'
    return 'html' // Vue SFC template/script highlighting
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      message.success('源码已复制到剪贴板')
    } catch {
      message.error('复制失败')
    }
  }

  return (
    <div className="h-full w-full bg-slate-950 flex flex-col font-mono text-xs overflow-hidden select-none">
      <div className="h-9 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-slate-400">
        <div className="flex items-center space-x-2">
          <Code2 size={14} className="text-sky-400" />
          <span>
            {techStack === 'react-ts'
              ? 'React TSX 源码 (自动同步)'
              : techStack === 'native-html'
              ? 'HTML 源码 (自动同步)'
              : 'Vue 3 SFC 源码 (自动同步)'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="text-xs hover:text-slate-200 transition flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded cursor-pointer"
        >
          <Copy size={11} />
          <span>复制代码</span>
        </button>
      </div>

      <div className="flex-1 w-full min-h-0 select-text">
        <Editor
          height="100%"
          language={getLanguage()}
          theme="vs-dark"
          value={code}
          onChange={(val) => onChange?.(val || '')}
          options={{
            fontSize: 12,
            lineNumbers: 'on',
            minimap: { enabled: false },
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            tabSize: 2
          }}
        />
      </div>
    </div>
  )
}
