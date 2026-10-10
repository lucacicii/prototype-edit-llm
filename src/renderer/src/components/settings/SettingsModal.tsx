import React, { useState } from 'react'
import { Modal } from 'antd'
import { Server, Settings2, ArrowLeft } from 'lucide-react'
import { ProviderPane } from './ProviderPane'
import { AgentPane } from './AgentPane'
import { AddProviderModal } from './AddProviderModal'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState<'provider' | 'agent'>('provider')
  const [addProviderOpen, setAddProviderOpen] = useState(false)

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={900}
        destroyOnClose
        centered
        styles={{
          body: {
            padding: 0,
            overflow: 'hidden',
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b'
          }
        }}
      >
        <div className="flex h-[580px] text-slate-200 select-none">
          {/* 左侧菜单导航 */}
          <nav className="w-48 bg-slate-950 border-r border-slate-800 p-3 flex flex-col justify-between shrink-0">
            <div className="space-y-1">
              <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                系统设置
              </div>
              <button
                onClick={() => setActiveTab('provider')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                  activeTab === 'provider'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <Server size={14} />
                <span>服务商管理</span>
              </button>
              <button
                onClick={() => setActiveTab('agent')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                  activeTab === 'agent'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <Settings2 size={14} />
                <span>通用与 Agent</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>返回工作区</span>
            </button>
          </nav>

          {/* 右侧面板 */}
          <section className="flex-1 min-w-0 bg-slate-900/60 overflow-hidden">
            {activeTab === 'provider' ? (
              <ProviderPane onOpenAddProvider={() => setAddProviderOpen(true)} />
            ) : (
              <AgentPane />
            )}
          </section>
        </div>
      </Modal>

      <AddProviderModal open={addProviderOpen} onClose={() => setAddProviderOpen(false)} />
    </>
  )
}
