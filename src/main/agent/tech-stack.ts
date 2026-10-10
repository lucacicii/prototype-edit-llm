/**
 * 技术栈白名单与仲裁。
 *
 * 能力矩阵（圈选永远可用，源码定位精度按栈分档）见
 * docs/workstation-definitions.md。
 */

export type TechStack = 'vue3-element' | 'react-ts' | 'native-html'

export interface StackInfo {
  /** 白名单内 = 宿主已装配，源码定位有保证；白名单外 = experimental。 */
  techStack: string
  experimental: boolean
  /** 文件扩展名（落盘与历史快照用）。 */
  fileExtension: 'vue' | 'tsx' | 'html'
  label: string
}

/** 白名单：宿主 runtime-host 已装配对应编译插件的栈。 */
export const SUPPORTED_STACKS: Record<TechStack, StackInfo> = {
  'vue3-element': {
    techStack: 'vue3-element',
    experimental: false,
    fileExtension: 'vue',
    label: 'Vue 3 + Element Plus'
  },
  'react-ts': {
    techStack: 'react-ts',
    experimental: false,
    fileExtension: 'tsx',
    label: 'React + TypeScript'
  },
  'native-html': {
    techStack: 'native-html',
    experimental: false,
    fileExtension: 'html',
    label: '原生 HTML'
  }
}

/** LLM 生成代码时按约定在首行写栈声明。HTML 栈的产物里
 * 也允许 HTML 注释形式（那是它的原生语法）；JS 注释
 * 是通用形式（HTML 解析器会把 // 注释当文本，
 * 但仲裁只在代码里找，文本里找不到也不影响）。
 * 注意：HTML 注释不能作为 .tsx 的声明 —— 那是语法错误（实测）。
 */
const DECL_RE = /(?:\/\/|<!--)\s*tech-stack:\s*([a-z0-9-]+)\s*(?:-->|$)/m

/** 启发式正则：内容特征（声明缺失或冲突时的仲裁依据）。 */
const VUE_SFC_RE = /(^|\n)\s*<template[\s>]/m
const REACT_RE = /\bimport\s+React\b|\bexport\s+default\s+function\b|\breturn\s*\(\s*</m
const DOCTYPE_RE = /<!DOCTYPE\s+html/i

function detectByContent(code: string): TechStack | null {
  // 顺序有含义：其他栈的产物里也可能出现 <template> 字样，
  // 但 Vue SFC 的 <template> 一定在顶层（行首空白）且配 <script>；
  // DOCTYPE + <html> 是原生 HTML 文档的强信号。
  if (DOCTYPE_RE.test(code) && /<html[\s>]/.test(code)) return 'native-html'
  if (VUE_SFC_RE.test(code) && code.includes('<script')) return 'vue3-element'
  if (REACT_RE.test(code)) return 'react-ts'
  return null
}

/**
 * 仲裁 LLM 生成的代码属于哪个栈。
 *
 * 顺序：首行声明注释 → 内容启发式。两者冲突时以声明优先
 * （LLM 的意图比正则可靠），但把冲突记到日志供排查。
 * 返回 null = 两个通道都没认出（此时由调用方按默认栈处理）。
 */
export function detectTechStack(code: string): { stack: TechStack | null; declared: string | null; conflict: boolean } {
  const declaredMatch = DECL_RE.exec(code.slice(0, 512))
  const declared = declaredMatch ? declaredMatch[1].toLowerCase() : null
  const detected = detectByContent(code)

  if (declared && declared !== detected) {
    if (detected) {
      console.warn(
        `[tech-stack] 声明(${declared})与内容特征(${detected})冲突，以声明为准`
      )
    }
    return {
      stack: declared in SUPPORTED_STACKS ? (declared as TechStack) : null,
      declared,
      conflict: !!detected
    }
  }
  return { stack: detected, declared, conflict: false }
}

/** 栈是否在白名单内（源码定位有保证）。白名单外一律 experimental。 */
export function stackInfo(stack: string | null | undefined): StackInfo {
  const known = stack && stack in SUPPORTED_STACKS ? SUPPORTED_STACKS[stack as TechStack] : null
  if (known) return known
  // 白名单外的栈：允许生成，但 UI 与模型都要提示定位降级
  return {
    techStack: stack || 'unknown',
    experimental: true,
    fileExtension: 'html',
    label: stack ? `${stack}（实验栈，圈选定位降级为文本推断）` : '未知栈'
  }
}
