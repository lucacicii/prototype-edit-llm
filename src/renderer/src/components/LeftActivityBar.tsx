import React from 'react'
import { Layers, Package, Settings } from 'lucide-react'

export type PrimaryMenuKey = 'prototype' | 'materials'

interface LeftActivityBarProps {
  activeMenu: PrimaryMenuKey
  onSelectMenu: (menu: PrimaryMenuKey) => void
  onOpenSettings: () => void
  materialCount?: number
  enabledMaterialCount?: number
}

export const LeftActivityBar: React.FC<LeftActivityBarProps> = ({
  activeMenu,
  onSelectMenu,
  onOpenSettings,
  materialCount = 0,
  enabledMaterialCount = 0
}) => {
  return (
    <nav
      aria-label="主导航菜单"
      className="w-[72px] bg-slate-950 border-r border-slate-800/90 flex flex-col items-center justify-between shrink-0 select-none z-30"
    >
      {/* 顶部拖拽与主菜单区（macOS 下为红绿灯留出顶部空间） */}
      <div className="w-full flex flex-col items-center">
        <div className="app-drag w-full h-11 shrink-0" />

        <div className="w-full px-2 flex flex-col items-center gap-2 mt-1">
          {/* 菜单 1：当前原型功能 */}
          <button
            type="button"
            onClick={() => onSelectMenu('prototype')}
            title="原型开发工作台"
            className={`group relative w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
              activeMenu === 'prototype'
                ? 'bg-sky-500/15 text-sky-400 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            {activeMenu === 'prototype' && (
              <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r bg-sky-400" />
            )}
            <Layers size={18} />
            <span className="text-[11px] font-medium leading-none">原型</span>
          </button>

          {/* 菜单 2：物料库 */}
          <button
            type="button"
            onClick={() => onSelectMenu('materials')}
            title={`物料库（已启用 ${enabledMaterialCount} / 共 ${materialCount} 项）`}
            className={`group relative w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
              activeMenu === 'materials'
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            {activeMenu === 'materials' && (
              <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r bg-indigo-400" />
            )}
            <div className="relative">
              <Package size={18} />
              {enabledMaterialCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full bg-indigo-600 text-[9px] font-bold text-white flex items-center justify-center leading-none shadow">
                  {enabledMaterialCount > 99 ? '99+' : enabledMaterialCount}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium leading-none">物料库</span>
          </button>
        </div>
      </div>

      {/* 中部可拖拽空白区域 */}
      <div className="app-drag flex-1 w-full" />

      {/* 底部（菜单栏右下角）：模型与 Agent 设置 */}
      <div className="w-full px-2 py-2.5 border-t border-slate-800/80 flex items-center justify-end">
        <button
          type="button"
          onClick={onOpenSettings}
          title="模型与 Agent 设置"
          className="px-2.5 py-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition flex flex-col items-center justify-center gap-1 cursor-pointer"
        >
          <Settings size={17} />
          <span className="text-[10px] font-medium leading-none">设置</span>
        </button>
      </div>
    </nav>
  )
}
