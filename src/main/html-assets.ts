/**
 * 导入单个 HTML 文件时的本地资源解析与复制。
 *
 * 设计约束：
 * - 纯模块，只依赖 `fs` / `path`，不 import electron —— 这样
 *   `scripts/verify-html-import.cjs` 可以用 sucrase 直接转译自检。
 * - 先只读地“规划”（collectAssetPlan），项目目录建好之后再复制
 *   （copyAssetPlan），避免导入失败留下半成品。
 * - 包含根 = 所选 HTML 文件所在目录。引用到根外的路径一律跳过并给出原因，
 *   不跟随符号链接逃逸，也不抓取任何远程资源。
 */

import { promises as fs } from 'fs'
import * as path from 'path'

export type AssetKind = 'stylesheet' | 'script' | 'image' | 'font' | 'media' | 'html' | 'other'

export interface RawAssetRef {
  /** 原始属性值（已做 HTML 实体解码，query/hash 尚未剥离）。 */
  raw: string
  kind: AssetKind
  /** 便于排查的来源，如 `<link rel="stylesheet">`、`inline <style>`、`style attr`。 */
  origin: string
  /** 相对入口 HTML 所在目录的 POSIX 目录；'' 表示同目录。 */
  baseDir: string
}

export interface HtmlExtraction {
  refs: RawAssetRef[]
  warnings: string[]
  /** 应用 `<base href>` 之后的有效基准目录。 */
  baseDir: string
}

export type RefClass =
  | { type: 'empty' }
  | { type: 'external'; reason: string }
  | { type: 'absolute'; reason: string }
  | { type: 'local'; path: string; suffix: string }

export interface AssetLimits {
  maxFileBytes: number
  maxTotalBytes: number
  maxFiles: number
  maxWarnings: number
}

export const DEFAULT_ASSET_LIMITS: AssetLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFiles: 1000,
  maxWarnings: 50
}

/** CSS / HTML 递归扫描的单文件上限：超过它只复制、不解析。 */
const MAX_SCAN_BYTES = 4 * 1024 * 1024

export interface PlannedAsset {
  /** 相对新项目目录的 POSIX 路径，例如 `css/app.css`。 */
  rel: string
  absPath: string
  bytes: number
  kind: AssetKind
}

export interface AssetPlan {
  assets: PlannedAsset[]
  warnings: string[]
  skipped: Array<{ ref: string; reason: string }>
  totalBytes: number
}

const NATIVE_HTML_MARKER = '<!-- tech-stack: native-html -->'

/** 这些路径属于项目自身，复制资源时不能覆盖。 */
const RESERVED_TOP = new Set([
  '.prototype-meta',
  '.prototype-history',
  'AGENTS.md',
  'CLAUDE.md',
  'materials',
  'index.html',
  'index.vue',
  'index.tsx'
])

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp'])
const MEDIA_EXT = new Set(['.mp4', '.webm', '.mp3', '.wav', '.ogg', '.m4a', '.vtt', '.webvtt'])
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot'])
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs'])
const HTML_EXT = new Set(['.html', '.htm'])

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole
  })
}

function kindFromExt(value: string): AssetKind {
  const clean = value.split(/[?#]/)[0].toLowerCase()
  const ext = path.posix.extname(clean)
  if (ext === '.css') return 'stylesheet'
  if (SCRIPT_EXT.has(ext)) return 'script'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (FONT_EXT.has(ext)) return 'font'
  if (MEDIA_EXT.has(ext)) return 'media'
  if (HTML_EXT.has(ext)) return 'html'
  return 'other'
}

function spaces(length: number): string {
  return ' '.repeat(Math.max(0, length))
}

/** 注释、脚本正文、样式正文先用空格遮蔽，避免把字符串里的假标签当成引用。 */
function maskHtml(html: string): { masked: string; styleBodies: string[] } {
  let masked = html.replace(/<!--[\s\S]*?-->/g, (m) => spaces(m.length))

  masked = masked.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (_whole, attrs: string, body: string) => `<script${attrs}>${spaces(body.length)}</script>`
  )

  const styleBodies: string[] = []
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
  let match: RegExpExecArray | null
  while ((match = styleRe.exec(masked)) !== null) {
    styleBodies.push(match[1])
  }
  masked = masked.replace(styleRe, (whole, body: string) => {
    const at = whole.indexOf(body)
    return at < 0 ? whole : whole.slice(0, at) + spaces(body.length) + whole.slice(at + body.length)
  })

  return { masked, styleBodies }
}

/** 极简标签扫描：只返回开标签的名字与属性原文；不依赖 DOM。 */
function* scanTags(html: string): Generator<{ name: string; rawAttrs: string }> {
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) return
    const first = html[lt + 1]
    if (!first || !/[a-zA-Z]/.test(first)) {
      i = lt + 1
      continue
    }
    let j = lt + 1
    while (j < html.length && /[a-zA-Z0-9:_-]/.test(html[j])) j++
    const name = html.slice(lt + 1, j).toLowerCase()
    const attrsStart = j
    let quote: string | null = null
    let end = -1
    for (; j < html.length; j++) {
      const ch = html[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        end = j
        break
      }
    }
    if (end < 0) return
    yield { name, rawAttrs: html.slice(attrsStart, end) }
    i = end + 1
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const key = match[1].toLowerCase()
    if (key in attrs) continue
    attrs[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

function parseSrcset(value: string): string[] {
  // 不能直接 split(',')：data URI 本身带逗号。按 HTML srcset 的读法
  // 逐个读“非空白 URL token”，逗号只作为分隔符（URL 末尾的逗号要剥掉）。
  const out: string[] = []
  let i = 0
  while (i < value.length) {
    while (i < value.length && (/\s/.test(value[i]) || value[i] === ',')) i++
    if (i >= value.length) break

    const start = i
    while (i < value.length && !/\s/.test(value[i])) i++
    const token = value.slice(start, i)
    const hadTrailingComma = /,+$/.test(token)
    const url = token.replace(/,+$/, '')
    if (url) out.push(url)

    if (hadTrailingComma) continue
    while (i < value.length && value[i] !== ',') i++
  }
  return out
}

function preloadKind(as: string): AssetKind {
  const value = as.trim().toLowerCase()
  if (value === 'style') return 'stylesheet'
  if (value === 'script') return 'script'
  if (value === 'image') return 'image'
  if (value === 'font') return 'font'
  if (value === 'audio' || value === 'video' || value === 'track') return 'media'
  if (value === 'document') return 'html'
  return 'other'
}

export function extractCssRefs(css: string, baseDir: string, origin: string): RawAssetRef[] {
  const refs: RawAssetRef[] = []
  const seen = new Set<string>()
  const push = (raw: string, kind: AssetKind): void => {
    const value = raw.trim()
    if (!value) return
    const key = `${kind}\u0000${value}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ raw: value, kind, origin, baseDir })
  }

  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = urlRe.exec(css)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (raw) push(raw, kindFromExt(raw))
  }

  const importRe = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)|"([^"]*)"|'([^']*)')/gi
  while ((match = importRe.exec(css)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim()
    if (raw) push(raw, 'stylesheet')
  }

  return refs
}

export function classifyResourceRef(raw: string): RefClass {
  const value = raw.trim()
  if (!value || value === '#' || value.startsWith('#')) return { type: 'empty' }
  if (value.startsWith('//')) return { type: 'external', reason: '协议相对 URL' }
  if (/^[a-zA-Z]:[\\/]/.test(value)) return { type: 'absolute', reason: 'Windows 绝对路径' }

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)
  if (scheme) return { type: 'external', reason: `${scheme[1]} URL` }

  if (value.startsWith('/')) return { type: 'absolute', reason: '站点绝对路径' }

  const hashAt = value.indexOf('#')
  const queryAt = value.indexOf('?')
  const cut = [hashAt, queryAt].filter((i) => i >= 0).sort((a, b) => a - b)[0]
  const pathPart = cut === undefined ? value : value.slice(0, cut)
  const suffix = cut === undefined ? '' : value.slice(cut)
  if (!pathPart) return { type: 'empty' }

  let decoded = pathPart
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    // 非法百分号编码：按原样尝试，能读到文件就复制。
  }
  return { type: 'local', path: decoded, suffix }
}

/**
 * 把引用解析成相对导入根的 POSIX 路径。
 * `css/../images/a.png` 允许；`../x`、`%2e%2e/x`、绝对路径拒绝。
 */
export function resolveLocalAssetPath(
  baseDir: string,
  decodedPath: string
): { rel: string } | { reason: string } {
  const p = decodedPath.replace(/\\/g, '/')
  if (!p || p.includes('\u0000')) return { reason: '空路径或非法字符' }
  if (p.startsWith('/') || /^[a-zA-Z]:\//.test(p)) return { reason: '绝对路径' }

  const joined = path.posix.normalize(path.posix.join(baseDir || '.', p))
  if (joined === '.' || joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined)) {
    return { reason: '路径越出所选 HTML 所在目录' }
  }

  const segments = joined.split('/')
  if (
    RESERVED_TOP.has(segments[0]) ||
    segments.includes('.prototype-meta') ||
    segments.includes('.prototype-history')
  ) {
    return { reason: '与项目保留路径冲突' }
  }

  return { rel: joined }
}

/** 应用 `<base href>`：只接受仍在导入根内的相对路径。 */
function resolveBaseDir(baseDir: string, href: string): { baseDir: string } | { reason: string } {
  const cls = classifyResourceRef(href)
  if (cls.type === 'empty') return { baseDir }
  if (cls.type !== 'local') {
    return { reason: '不是本地相对路径' }
  }
  const p = cls.path.replace(/\\/g, '/')
  const joined = path.posix.normalize(path.posix.join(baseDir || '.', p))
  if (joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined)) {
    return { reason: '越出所选文件所在目录' }
  }
  if (href.trim().endsWith('/')) {
    const normalized = joined.replace(/\/+$/, '')
    return { baseDir: normalized === '.' ? '' : normalized }
  }
  const dir = path.posix.dirname(joined)
  return { baseDir: dir === '.' ? '' : dir }
}

export function extractHtmlRefs(html: string, baseDir = ''): HtmlExtraction {
  const { masked, styleBodies } = maskHtml(html)
  const tags = Array.from(scanTags(masked))
  const warnings: string[] = []
  const refs: RawAssetRef[] = []

  let effectiveBase = baseDir
  const baseTag = tags.find((tag) => tag.name === 'base')
  if (baseTag) {
    const href = parseAttrs(baseTag.rawAttrs).href
    if (href) {
      const resolved = resolveBaseDir(effectiveBase, href)
      if ('baseDir' in resolved) {
        effectiveBase = resolved.baseDir
      } else {
        warnings.push(`<base href="${href}"> 已忽略：${resolved.reason}`)
      }
    }
  }

  let localAnchors = 0
  for (const tag of tags) {
    const attrs = parseAttrs(tag.rawAttrs)
    const origin = `<${tag.name}>`

    if (tag.name === 'a') {
      const href = attrs.href?.trim()
      if (href && !href.startsWith('#') && classifyResourceRef(href).type === 'local') {
        localAnchors++
      }
    }

    if (tag.name === 'link') {
      const rel = (attrs.rel || '').toLowerCase()
      const href = attrs.href
      if (!href) continue
      if (rel.split(/\s+/).includes('stylesheet')) {
        refs.push({ raw: href, kind: 'stylesheet', origin: '<link rel="stylesheet">', baseDir: effectiveBase })
      } else if (rel.includes('icon')) {
        refs.push({ raw: href, kind: 'image', origin: '<link rel="icon">', baseDir: effectiveBase })
      } else if (rel.includes('preload') || rel.includes('modulepreload')) {
        refs.push({
          raw: href,
          kind: attrs.as ? preloadKind(attrs.as) : kindFromExt(href),
          origin: '<link rel="preload">',
          baseDir: effectiveBase
        })
      }
      continue
    }

    if (tag.name === 'script' && attrs.src) {
      refs.push({ raw: attrs.src, kind: 'script', origin, baseDir: effectiveBase })
    } else if (tag.name === 'img') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: 'image', origin, baseDir: effectiveBase })
      for (const url of parseSrcset(attrs.srcset || '')) {
        refs.push({ raw: url, kind: 'image', origin: '<img srcset>', baseDir: effectiveBase })
      }
    } else if (tag.name === 'source') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: kindFromExt(attrs.src), origin, baseDir: effectiveBase })
      for (const url of parseSrcset(attrs.srcset || '')) {
        refs.push({ raw: url, kind: kindFromExt(url), origin: '<source srcset>', baseDir: effectiveBase })
      }
    } else if (tag.name === 'video') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: 'media', origin, baseDir: effectiveBase })
      if (attrs.poster) refs.push({ raw: attrs.poster, kind: 'image', origin: '<video poster>', baseDir: effectiveBase })
    } else if (tag.name === 'audio' || tag.name === 'track') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: 'media', origin, baseDir: effectiveBase })
    } else if (tag.name === 'iframe') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: 'html', origin, baseDir: effectiveBase })
    } else if (tag.name === 'object') {
      if (attrs.data) refs.push({ raw: attrs.data, kind: kindFromExt(attrs.data), origin, baseDir: effectiveBase })
    } else if (tag.name === 'embed') {
      if (attrs.src) refs.push({ raw: attrs.src, kind: kindFromExt(attrs.src), origin, baseDir: effectiveBase })
    } else if (tag.name === 'input') {
      if ((attrs.type || '').toLowerCase() === 'image' && attrs.src) {
        refs.push({ raw: attrs.src, kind: 'image', origin, baseDir: effectiveBase })
      }
    } else if (tag.name === 'image' || tag.name === 'use') {
      const href = attrs.href ?? attrs['xlink:href']
      if (href && !href.startsWith('#')) {
        refs.push({ raw: href, kind: 'image', origin, baseDir: effectiveBase })
      }
    }

    if (attrs.style) {
      refs.push(...extractCssRefs(attrs.style, effectiveBase, 'style attr'))
    }
  }

  for (const body of styleBodies) {
    refs.push(...extractCssRefs(body, effectiveBase, 'inline <style>'))
  }

  if (localAnchors > 0) {
    warnings.push(
      `页面里有 ${localAnchors} 个本地 <a href> 链接未复制（导入只包含当前页面及其静态资源）`
    )
  }

  return { refs, warnings, baseDir: effectiveBase }
}

async function isInside(rootReal: string, candidateReal: string): Promise<boolean> {
  const rel = path.relative(rootReal, candidateReal)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export async function collectAssetPlan(params: {
  entryAbsPath: string
  html: string
  limits?: Partial<AssetLimits>
}): Promise<AssetPlan> {
  const entryAbs = path.resolve(params.entryAbsPath)
  const root = path.dirname(entryAbs)
  const rootReal = await fs.realpath(root).catch(() => root)
  const limits: AssetLimits = { ...DEFAULT_ASSET_LIMITS, ...(params.limits || {}) }

  const extracted = extractHtmlRefs(params.html)
  const warnings = [...extracted.warnings]
  const skipped: Array<{ ref: string; reason: string }> = []
  const assets: PlannedAsset[] = []
  const seenDest = new Set<string>()
  const scannedFiles = new Set<string>()
  const queue: RawAssetRef[] = [...extracted.refs]
  let totalBytes = 0

  while (queue.length > 0) {
    if (assets.length >= limits.maxFiles) {
      warnings.push(`资源数量超过 ${limits.maxFiles} 个，其余未复制`)
      break
    }

    const ref = queue.shift()!
    const cls = classifyResourceRef(ref.raw)
    if (cls.type === 'empty') continue
    if (cls.type !== 'local') {
      skipped.push({ ref: ref.raw, reason: cls.reason })
      continue
    }

    const resolved = resolveLocalAssetPath(ref.baseDir, cls.path)
    if ('reason' in resolved) {
      skipped.push({ ref: ref.raw, reason: resolved.reason })
      continue
    }

    const abs = path.resolve(root, resolved.rel)
    const real = await fs.realpath(abs).catch(() => null)
    if (!real) {
      skipped.push({ ref: ref.raw, reason: '文件不存在' })
      continue
    }
    if (!(await isInside(rootReal, real))) {
      skipped.push({ ref: ref.raw, reason: '符号链接指向所选目录之外' })
      continue
    }

    const stat = await fs.stat(real).catch(() => null)
    if (!stat?.isFile()) {
      skipped.push({ ref: ref.raw, reason: '不是普通文件' })
      continue
    }
    if (stat.size > limits.maxFileBytes) {
      skipped.push({
        ref: ref.raw,
        reason: `文件超过 ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB`
      })
      continue
    }
    if (totalBytes + stat.size > limits.maxTotalBytes) {
      warnings.push(`资源总量超过 ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB，其余未复制`)
      break
    }

    const destKey = resolved.rel.toLowerCase()
    if (seenDest.has(destKey)) continue
    seenDest.add(destKey)

    assets.push({ rel: resolved.rel, absPath: abs, bytes: stat.size, kind: ref.kind })
    totalBytes += stat.size

    const ext = path.posix.extname(resolved.rel).toLowerCase()
    const shouldScan = (ext === '.css' || HTML_EXT.has(ext)) && stat.size <= MAX_SCAN_BYTES
    if (shouldScan && !scannedFiles.has(real)) {
      scannedFiles.add(real)
      const text = await fs.readFile(real, 'utf-8').catch(() => null)
      if (text) {
        const dir = path.posix.dirname(resolved.rel)
        const dirRel = dir === '.' ? '' : dir
        if (ext === '.css') {
          queue.push(...extractCssRefs(text, dirRel, resolved.rel))
        } else {
          queue.push(...extractHtmlRefs(text, dirRel).refs)
        }
      }
    }
  }

  let finalWarnings = warnings
  if (warnings.length > limits.maxWarnings) {
    finalWarnings = warnings.slice(0, limits.maxWarnings)
    finalWarnings.push(`另有 ${warnings.length - limits.maxWarnings} 条提示未显示`)
  }

  return { assets, warnings: finalWarnings, skipped, totalBytes }
}

export async function copyAssetPlan(
  plan: AssetPlan,
  destRoot: string
): Promise<{ copied: number; warnings: string[] }> {
  const root = path.resolve(destRoot)
  const warnings: string[] = []
  let copied = 0

  for (const asset of plan.assets) {
    const dest = path.join(root, asset.rel)
    const back = path.relative(root, path.resolve(dest))
    if (!back || back.startsWith('..') || path.isAbsolute(back)) {
      warnings.push(`复制失败：${asset.rel}（目标路径越界）`)
      continue
    }
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(asset.absPath, dest)
      copied++
    } catch (err: any) {
      warnings.push(`复制失败：${asset.rel}（${err?.message ?? String(err)}）`)
    }
  }

  return { copied, warnings }
}

/** 导入的 HTML 统一标成 native-html，避免后续被内联脚本特征误判栈。 */
export function ensureNativeHtmlMarker(html: string): { html: string; added: boolean } {
  if (/tech-stack\s*:/i.test(html.slice(0, 512))) return { html, added: false }
  return { html: `${NATIVE_HTML_MARKER}\n${html}`, added: true }
}

export function deriveProjectName(params: { filePath: string; html: string }): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(params.html)
  const rawTitle = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''
  const generic = new Set(['document', 'untitled', '无标题', '未命名'])
  const title = rawTitle && !generic.has(rawTitle.toLowerCase()) ? rawTitle : ''
  const base = path.basename(params.filePath, path.extname(params.filePath)).trim()
  return (title || base || '导入的 HTML 原型').slice(0, 60)
}
