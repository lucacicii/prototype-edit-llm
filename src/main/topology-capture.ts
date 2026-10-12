/**
 * 页面截图与「导出成一张图」。
 *
 * 都靠一个**独立的隐藏宿主窗口**完成，绝不碰用户正在看的那个预览：预览里
 * 可能有攒着的圈改标注、可能正停在某个弹窗上，为了截图去刷新它是拿用户的
 * 现场换我们的产物。
 *
 * 两个 Electron 上的硬约束（实测出来的，不是理论）：
 * 1. 截图必须用 **BrowserView**，不能用 BrowserWindow 自己的 webContents ——
 *    后者上 `Page.enable` 永远不回包，整个流程就吊死。
 * 2. **先导航、再 attach debugger**。刚建出来还停在 about:blank 的窗口上
 *    attach + `Page.enable` 同样不回包（宿主窗口藏不藏、在不在屏内都无关）。
 *
 * 还有一条：宿主窗口**建好就一直留着，用完不销毁**。`host.destroy()` 之后
 * 进程会在几百毫秒内静默死掉（截图结果都来不及返回），去掉 view 则安然无事
 * —— 宿主全程隐藏，留着它的代价只是一个隐藏渲染进程。主进程那边的
 * `BrowserViewManager.destroy()` 也是同一个路数：只摘 view，不销毁窗口。
 *
 * 这个模块**只负责截图**。导出产物是 HTML 文档（见 loadShotImages /
 * renderTopologyDocumentFile），不再走「画出版面再抓屏」那条路。
 *
 * 截图为什么要「走路径」：单文件原型里「详情页」只是同一份 DOM 的另一个状态，
 * 光导航过去是截不到的。所以按模型给出的选择器一路点进去，到了再截。
 */

import { BrowserView, BrowserWindow, WebContents, nativeImage } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { capturePath, type TopologyGraph } from '../shared/topology'
import { renderTopologyDocument } from './agent/topology'

/** 截图用的视口宽度；固定下来缩略图才一致，不受用户把预览拉多宽影响。 */
const CAPTURE_WIDTH = 440
const CAPTURE_HEIGHT = 900
/** 2 倍像素比：图要放进导出的图片里，1 倍会明显发虚。 */
const CAPTURE_SCALE = 2
/** 存给面板/导出用的缩略图宽度。 */
const THUMB_WIDTH = 420
/** 卡片可见区域的宽高比，缩略图比它多留一点，交给 SVG 的 slice 兜底。 */
const THUMB_CROP_RATIO = 1.25
const CLICK_SETTLE_MS = 350
const LOAD_TIMEOUT_MS = 20_000
/** 整页长图的上限（CSS 像素）；再长的页面截断，免得一张图把内存吃干。 */
const MAX_CONTENT_HEIGHT = 8_000

export interface CapturedShot {
  file: string
  width: number
  height: number
}

export interface CaptureOutcome {
  /** nodeId → 落盘的截图（file 相对 .prototype-meta/）。 */
  shots: Record<string, CapturedShot>
  /** nodeId → 缩略图 dataURL，渲染导出图片时内联用。 */
  thumbs: Map<string, string>
  warnings: string[]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CaptureHost {
  host: BrowserWindow
  view: BrowserView
  wc: WebContents
}

/**
 * 藏起来的宿主窗口 + 一个能跑 CDP 的 BrowserView。
 *
 * 建成单例、用完不销毁（见文件头的第三条约束）。
 *
 * 宿主的内宽内高必须不小于 view 的 bounds：view 超出的部分不会绘制，
 * 截出来就是图的右边/下边被砍掉。1600×1200 只是第一屏的初始值，
 * 后面 `fitCaptureHost` 会按需放大，并且只放大不缩小。
 */
let sharedHost: CaptureHost | null = null

function getCaptureHost(width: number, height: number): CaptureHost {
  if (!sharedHost || sharedHost.host.isDestroyed()) {
    const prefs = {
      sandbox: false,
      contextIsolation: false,
      webSecurity: false,
      nodeIntegration: false
    }
    const host = new BrowserWindow({
      show: false,
      width,
      height,
      x: -30_000,
      y: -30_000,
      backgroundColor: '#ffffff',
      webPreferences: prefs
    })
    const view = new BrowserView({ webPreferences: prefs })
    host.setBrowserView(view)
    sharedHost = { host, view, wc: view.webContents }
  }
  fitCaptureHost(sharedHost, width, height)
  return sharedHost
}

function fitCaptureHost(capture: CaptureHost, width: number, height: number): void {
  const { host, view } = capture
  const [cw, ch] = host.getContentSize()
  if (cw < width || ch < height) {
    host.setContentSize(Math.max(cw, Math.ceil(width)), Math.max(ch, Math.ceil(height)))
  }
  view.setBounds({ x: 0, y: 0, width, height })
}

/** 导航之后再调用：刚建出来的空窗口上 attach 会吊死（约束 2）。 */
async function ensureDebugger(wc: WebContents): Promise<void> {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  await wc.debugger.sendCommand('Page.enable')
}

/** 等一次真实的 load 结束；失败/超时都返回 false，由调用方决定怎么办。 */
function loadAndWait(wc: WebContents, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wc.off('did-finish-load', onFinish)
      wc.off('did-fail-load', onFail)
      resolve(ok)
    }
    const onFinish = () => done(true)
    const onFail = () => done(false)
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS)
    wc.once('did-finish-load', onFinish)
    wc.once('did-fail-load', onFail)
    void wc.loadURL(url).catch(() => done(false))
  })
}

/** 在预览里点一下某个元素。找不到/点了报错都只返回 false。 */
async function clickSelector(wc: WebContents, selector: string): Promise<boolean> {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) { return false; }
    return true;
  })()`
  try {
    return (await wc.executeJavaScript(expression)) === true
  } catch {
    return false
  }
}

interface RawShot {
  dataUrl: string
  width: number
  height: number
}

/** 抓出一张纯白图（渲染帧没起来）时返回 true。抽几个点就够判断。 */
function isBlank(image: Electron.NativeImage): boolean {
  try {
    if (image.isEmpty()) return true
    const { width, height } = image.getSize()
    if (!width || !height) return true
    const bitmap = image.toBitmap()
    const stride = width * 4
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(Math.random() * width)
      const y = Math.floor(Math.random() * height)
      const at = y * stride + x * 4
      if (bitmap[at] !== 255 || bitmap[at + 1] !== 255 || bitmap[at + 2] !== 255) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * 量出页面「自然」的内容高度。
 *
 * 不能用 `Page.getLayoutMetrics`：一旦把视口高度设成过内容高度，body 就会
 * 撑满视口，内容尺寸从此恒等于视口高度 —— 短页面会越截越长（第一版就是这么
 * 把「详情页」截成 1719px 空白长图的）。所以量 body 各子元素的外接框，
 * 它只反映内容，不理会视口有多高。
 */
async function measureContentHeight(wc: WebContents): Promise<number> {
  const measure = `(() => {
    const body = document.body;
    if (!body) return 0;
    let bottom = 0;
    for (const child of body.children) {
      const rect = child.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, rect.bottom + window.scrollY);
    }
    return Math.ceil(bottom);
  })()`
  try {
    const value = await wc.executeJavaScript(measure)
    return Number(value) || 0
  } catch {
    return 0
  }
}

/**
 * 整页截图。
 *
 * 先把视口还原成标准手机尺寸再量内容：短页面按一屏截（看着就是一台手机），
 * 长页面按内容长度拉满。这样每张图的长度都只由页面自己决定。
 */
async function captureFullPage(wc: WebContents): Promise<RawShot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
        deviceScaleFactor: CAPTURE_SCALE,
        mobile: false
      })
      await delay(120)

      const natural = await measureContentHeight(wc)
      const contentHeight = Math.min(
        Math.max(natural || CAPTURE_HEIGHT, CAPTURE_HEIGHT),
        MAX_CONTENT_HEIGHT
      )

      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: CAPTURE_WIDTH,
        height: contentHeight,
        deviceScaleFactor: CAPTURE_SCALE,
        mobile: false
      })
      await delay(200)

      const shot = await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true
      })
      if (!shot?.data) continue

      const image = nativeImage.createFromDataURL(`data:image/png;base64,${shot.data}`)
      if (isBlank(image) && attempt === 0) {
        await delay(300)
        continue
      }
      return {
        dataUrl: `data:image/png;base64,${shot.data}`,
        width: CAPTURE_WIDTH,
        height: contentHeight
      }
    } catch (err) {
      console.warn('[topology] captureScreenshot failed:', err)
      return null
    }
  }
  return null
}

/**
 * 把整页长图收成卡片用的缩略图。
 *
 * 原样内联进渲染 HTML 会到好几 MB，而卡片只看得到顶上一条 —— 所以按比例
 * 缩到固定宽度，再从顶部裁出一段。
 */
function cropToCard(image: Electron.NativeImage): Electron.NativeImage {
  const resized = image.resize({ width: THUMB_WIDTH, quality: 'good' })
  const size = resized.getSize()
  const cropHeight = Math.min(size.height, Math.round(THUMB_WIDTH * THUMB_CROP_RATIO))
  return cropHeight > 0 && cropHeight < size.height
    ? resized.crop({ x: 0, y: 0, width: size.width, height: cropHeight })
    : resized
}

function toThumb(raw: RawShot): string | null {
  try {
    const image = nativeImage.createFromDataURL(raw.dataUrl)
    if (image.isEmpty()) return null
    return cropToCard(image).toDataURL()
  } catch (err) {
    console.warn('[topology] thumbnail failed:', err)
    return null
  }
}

function safeFileName(nodeId: string): string {
  return `${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'node'}.png`
}

/**
 * 逐个页面截图。
 *
 * 每个节点都从入口重新开始：点过的东西没法「点回去」，重载一次最省事也最准
 * —— 原型都小，多几次重载换来确定性。
 */
export async function capturePreviewShots(options: {
  graph: TopologyGraph
  previewUrl: string
  entryFile: string
  /** 截图落盘目录（`.prototype-meta/topology-shots`）。 */
  shotDir: string
}): Promise<CaptureOutcome> {
  const { graph, previewUrl, entryFile, shotDir } = options
  const outcome: CaptureOutcome = { shots: {}, thumbs: new Map(), warnings: [] }

  const { wc } = getCaptureHost(CAPTURE_WIDTH, CAPTURE_HEIGHT)
  try {
    // 先导航再 attach —— 见文件头的约束 2
    if (!(await loadAndWait(wc, previewUrl))) {
      outcome.warnings.push('预览页打不开，这一轮没有截图')
      return outcome
    }
    await ensureDebugger(wc)

    await fs.mkdir(shotDir, { recursive: true })

    const base = new URL(previewUrl)
    let missed = 0

    for (const node of graph.nodes) {
      const route = capturePath(graph, node.id)
      // 走不到（模型没给选择器）时退一步：它要是独立文件，直接开那个文件。
      const directFile =
        route === null && node.file && node.file !== entryFile
          ? new URL(node.file, base).toString()
          : null

      if (route === null && !directFile) {
        missed++
        continue
      }

      if (!(await loadAndWait(wc, previewUrl))) continue

      if (route && route.length) {
        let ok = true
        for (const step of route) {
          if (!(await clickSelector(wc, step.selector!))) {
            ok = false
            break
          }
          await delay(CLICK_SETTLE_MS)
        }
        if (!ok) {
          missed++
          continue
        }
      } else if (directFile) {
        if (!(await loadAndWait(wc, directFile))) {
          missed++
          continue
        }
      }

      await delay(CLICK_SETTLE_MS)
      const raw = await captureFullPage(wc)
      if (!raw) {
        missed++
        continue
      }

      const file = safeFileName(node.id)
      await fs.writeFile(path.join(shotDir, file), nativeImage.createFromDataURL(raw.dataUrl).toPNG())

      outcome.shots[node.id] = {
        file: `topology-shots/${file}`,
        width: raw.width,
        height: raw.height
      }
      const thumb = toThumb(raw)
      if (thumb) outcome.thumbs.set(node.id, thumb)
    }

    if (missed) {
      outcome.warnings.push(
        `${missed} 个页面没能截到图（跳转点不到，或模型没给出可点的元素），这些页面只显示名称`
      )
    }
  } catch (err: any) {
    outcome.warnings.push(`截图过程出错：${err?.message ?? String(err)}`)
  }

  return outcome
}

/** 读回落盘的截图，缩成缩略图给面板用（避免把整页长图塞进 IPC）。 */
export async function loadShotThumbs(
  graph: TopologyGraph | null,
  metaDir: string
): Promise<Map<string, string>> {
  const thumbs = new Map<string, string>()
  if (!graph) return thumbs

  for (const node of graph.nodes) {
    if (!node.shot?.file) continue
    try {
      const buf = await fs.readFile(path.join(metaDir, node.shot.file))
      const image = nativeImage.createFromBuffer(buf)
      if (image.isEmpty()) continue
      thumbs.set(node.id, cropToCard(image).toDataURL())
    } catch {
      // 图被删了就用不到缩略图，节点自己会退回文字卡片
    }
  }
  return thumbs
}

/**
 * 读回落盘的**完整**截图（不裁不缩），内联成 data URL。
 *
 * 与 `loadShotThumbs` 的区别就是要「完整」：导出文档里每张截图都是整页原图，
 * 所以这里不做 `cropToCard`，只用 `toDataURL` 重新编码一遍保证内联合法。
 * 代价是导出的 HTML 会比较大（每张长图几百 KB 到 1 MB 量级），换来的是
 * 一个双击就能看、不依赖任何外部文件的文件。
 */
export async function loadShotImages(
  graph: TopologyGraph | null,
  metaDir: string
): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  if (!graph) return images

  for (const node of graph.nodes) {
    if (!node.shot?.file) continue
    try {
      const buf = await fs.readFile(path.join(metaDir, node.shot.file))
      const image = nativeImage.createFromBuffer(buf)
      if (image.isEmpty()) continue
      images.set(node.id, image.toDataURL())
    } catch {
      // 图没了就画占位框，不影响其余节点
    }
  }
  return images
}

/**
 * 生成可导出的自包含 HTML 文档，写盘由调用方负责。
 *
 * 导出改成 HTML 而不是图片，是因为图片那条路本质上要「在离屏窗口里画出
 * 版面再抓屏」，抓屏取景依赖量出来的 DOM 尺寸，实测反复被视口继承和纹理
 * 上限咬到（右边整层节点被裁）。HTML 里截图按原始比例完整内联、长短卡片
 * 各自排开，画布多大只由内容决定，不由任何窗口决定。
 */
export async function renderTopologyDocumentFile(
  graph: TopologyGraph,
  metaDir: string
): Promise<{ html: string; shotCount: number }> {
  const images = await loadShotImages(graph, metaDir)
  return { html: renderTopologyDocument(graph, images), shotCount: images.size }
}
