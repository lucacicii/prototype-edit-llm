/**
 * Spec 静态解析器：从源码里抠出页面候选、跳转证据、表单证据。
 *
 * 纯函数，无 electron/fs 依赖 —— 输入是调用方读好的源码，输出是拼进
 * LLM prompt 的证据块。轻量正则 + 行扫描，不引入 HTML/Vue 编译器依赖。
 *
 * 注意：这里只收集**证据**，不做语义判断。“这是不是一个页面”“这次跳转
 * 准不准”由 LLM 认领或驳回，静态层只负责把候选摆出来并记下来源行号。
 * 截图链路已删除，所以不收集 selector。
 */

export interface StaticSourceFile {
  file: string
  code: string
}

export interface PageCandidate {
  /** 候选 id 建议（kebab-case），LLM 可改。 */
  hintId: string
  label: string
  file: string
  line: number
  /** 命中依据，如 `van-tabbar 4 项`、`href="#capability"`。 */
  basis: string
}

export interface JumpEvidence {
  fromHint: string
  toHint: string
  /** 触发事件原文，如 `@click="active='cat'"`。 */
  event?: string
  /** 锚点跳转的 href，如 `#capability`。 */
  href?: string
  /** 外层条件原文，如 `v-if="loggedIn"`。 */
  condition?: string
  snippet: string
  file: string
  line: number
}

export interface StaticField {
  name: string
  label: string
  type: string
  required: boolean
}

export interface StaticButton {
  label: string
}

export interface FormEvidence {
  pageHint: string
  fields: StaticField[]
  buttons: StaticButton[]
  file: string
  line: number
}

export interface StaticStats {
  files: number
  chars: number
  pageCandidates: number
  jumpEvidence: number
  formFields: number
}

export interface StaticEvidence {
  pageCandidates: PageCandidate[]
  jumpEvidence: JumpEvidence[]
  formEvidence: FormEvidence[]
  stats: StaticStats
}

const MAX_SNIPPET_LINES = 3

function slug(text: string, fallback: string): string {
  const s = text
    .toLowerCase()
    .replace(/[一-鿿]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || fallback
}

function snippetOf(lines: string[], lineNo: number): string {
  const start = Math.max(0, lineNo - 2)
  return lines
    .slice(start, lineNo + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-MAX_SNIPPET_LINES)
    .join('\n')
    .slice(0, 300)
}

function pushCandidate(
  list: PageCandidate[],
  seen: Set<string>,
  cand: PageCandidate
): void {
  const key = `${cand.file}:${cand.hintId}`
  if (seen.has(key)) return
  seen.add(key)
  list.push(cand)
}

/**
 * 从单个文件的源码提取三类证据。调用方负责把多文件结果合并。
 */
export function extractStaticEvidence(files: StaticSourceFile[]): StaticEvidence {
  const pageCandidates: PageCandidate[] = []
  const jumpEvidence: JumpEvidence[] = []
  const formEvidence: FormEvidence[] = []
  const seen = new Set<string>()
  let chars = 0

  for (const { file, code } of files) {
    chars += code.length
    const lines = code.split('\n')

    // —— 1. 锚点集合：href="#xxx" 即一个页面候选 ——
    const anchorIds = new Map<string, number>()
    lines.forEach((line, i) => {
      const re = /href="#([A-Za-z0-9_-]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        if (!anchorIds.has(m[1])) anchorIds.set(m[1], i + 1)
      }
    })
    for (const [id, lineNo] of anchorIds) {
      if (id.length < 2) continue
      pushCandidate(pageCandidates, seen, {
        hintId: slug(id, 'section'),
        label: id,
        file,
        line: lineNo,
        basis: `锚点 href="#${id}"`
      })
    }
    // 锚点目标元素本身（id="xxx" 的 section/div）也记一笔，LLM 合并用。
    lines.forEach((line, i) => {
      const m = line.match(/<(section|div|main|article)[^>]*\bid="([A-Za-z0-9_-]{2,})"/)
      if (m && anchorIds.has(m[2])) {
        const anchorLine = lines
          .slice(Math.max(0, i - 6), i)
          .join(' ')
          .match(/<h[1-3][^>]*>([^<]{1,20})</)
        pushCandidate(pageCandidates, seen, {
          hintId: slug(m[2], 'section'),
          label: anchorLine?.[1]?.trim() || m[2],
          file,
          line: i + 1,
          basis: `锚点目标 <${m[1]} id="${m[2]}">`
        })
      }
    })

    // —— 2. Tab / 导航项：data-tab、el-tab-pane、JS 数组、STUBS 查表 ——
    lines.forEach((line, i) => {
      // data-tab="xxx" 按钮/项（HTML 直写）
      const tab = line.match(/data-tab="([A-Za-z0-9_-]+)"/)
      if (tab) {
        const label =
          line.match(/>([^<]{1,12})<\//)?.[1]?.trim() ||
          line.match(/title="([^"]{1,12})"/)?.[1] ||
          tab[1]
        pushCandidate(pageCandidates, seen, {
          hintId: slug(tab[1], 'tab'),
          label,
          file,
          line: i + 1,
          basis: `导航项 data-tab="${tab[1]}"`
        })
      }
      // el-tab-pane / van-tab / a-tab-pane
      const pane =
        line.match(/<(el-tab-pane|van-tab|a-tab-pane)[^>]*label="([^"]+)"/) ||
        line.match(/<(el-tab-pane|van-tab|a-tab-pane)[^>]*name="([^"]+)"/)
      if (pane) {
        pushCandidate(pageCandidates, seen, {
          hintId: slug(pane[2], 'tab'),
          label: pane[2],
          file,
          line: i + 1,
          basis: `<${pane[1]} label/name="${pane[2]}">`
        })
      }
    })

    // JS 数组定义的导航项：var TABS = [{k:'home',t:'首页'},...]
    // HTML 里没有字面量，靠数组还原。k/t、key/title、id/name 三种键名都认。
    const arrayText = code
    const arrRe = /(?:var|let|const)\s+([A-Z_]*TABS?|[A-Z_]*NAVS?|[A-Z_]*MENUS?|[A-Z_]*PAGES?)\s*=\s*\[([\s\S]{1,2000}?)\];/g
    let arrM: RegExpExecArray | null
    while ((arrM = arrRe.exec(arrayText)) !== null) {
      const body = arrM[2]
      const itemRe = /\{\s*[^}]*?(?:k|key|id|name)\s*:\s*['"]([A-Za-z0-9_-]+)['"][^}]*?(?:t|title|label|text)\s*:\s*['"]([^'"]{1,12})['"]/g
      let itemM: RegExpExecArray | null
      while ((itemM = itemRe.exec(body)) !== null) {
        const lineNo = code.slice(0, arrM.index + itemM.index).split('\n').length
        pushCandidate(pageCandidates, seen, {
          hintId: slug(itemM[1], 'tab'),
          label: itemM[2],
          file,
          line: lineNo,
          basis: `JS 数组 ${arrM[1]} 项 ${itemM[1]}「${itemM[2]}」`
        })
      }
    }

    // STUBS 查表式页面：var STUBS = { cat: {i, t:'分类', d}, ... }
    const stubRe = /(?:var|let|const)\s+([A-Z_]*STUBS?)\s*=\s*\{([\s\S]{1,4000}?)\n\s*\};/g
    let stubM: RegExpExecArray | null
    while ((stubM = stubRe.exec(arrayText)) !== null) {
      const body = stubM[2]
      const keyRe = /^\s*([A-Za-z0-9_]+)\s*:\s*\{[^}]*?(?:t|title|label)\s*:\s*['"]([^'"]{1,12})['"]/gm
      let keyM: RegExpExecArray | null
      while ((keyM = keyRe.exec(body)) !== null) {
        const lineNo = code.slice(0, stubM.index + keyM.index).split('\n').length
        pushCandidate(pageCandidates, seen, {
          hintId: slug(keyM[1], 'state'),
          label: keyM[2],
          file,
          line: lineNo,
          basis: `${stubM[1]} 查表页 ${keyM[1]}「${keyM[2]}」`
        })
      }
    }

    // id="xxx" 的页面级容器（stubView/searchPage 这类）。
    // 只认 class 白名单全词：view/stub/page/modal/popup/panel/sheet/searchpage。
    // 黑名单（手机外壳、装饰件、小组件）直接排除：screen/island/big/badge/icon/btn/toast。
    // 同行或上一行的 HTML 注释（如 <!-- 首页视图 -->）优先当标题。
    lines.forEach((line, i) => {
      const tagM = line.match(/<(div|section|main)\b([^>]*)>/)
      if (!tagM) return
      const attrs = tagM[2]
      const id = attrs.match(/\bid="([A-Za-z0-9_-]{3,})"/)?.[1]
      if (!id) return
      // 黑名单：手机外壳、装饰件、小组件，一律不是页面。
      if (/^(screen|island|stubIcon|.*[Ii]con|.*[Bb]adge|.*[Bb]tn|.*[Tt]oast|.*[Bb]anner)$/.test(id)) return
      const cls = attrs.match(/\bclass="([^"]*)"/)?.[1] ?? ''
      const words = cls.toLowerCase().split(/[\s_-]+/)
      const WHITE = new Set([
        'view', 'stub', 'page', 'pages', 'modal', 'popup', 'panel', 'sheet', 'searchpage', 'search'
      ])
      if (!words.some((w) => WHITE.has(w) || w.endsWith('page') || w.endsWith('view'))) return
      const rawComment =
        (lines[i - 1] ?? '').match(/<!--\s*(.{1,20})\s*-->/)?.[1]?.trim() ||
        line.match(/<!--\s*(.{1,20})\s*-->/)?.[1]?.trim()
      // 去掉装饰性符号：===== 搜索浮层 ===== → 搜索浮层
      const comment = rawComment?.replace(/^[=\-*#\s]+|[=\-*#\s]+$/g, '').trim() || undefined
      const title =
        comment ||
        lines
          .slice(i, Math.min(lines.length, i + 5))
          .join(' ')
          .match(/<h[1-4][^>]*>([^<]{1,20})</)?.[1]?.trim()
      pushCandidate(pageCandidates, seen, {
        hintId: slug(id, 'page'),
        label: title || id,
        file,
        line: i + 1,
        basis: `页面容器 <${tagM[1]} id="${id}">`
      })
    })

    // —— 3. 条件渲染块：v-if / v-show / {cond && ( ——
    lines.forEach((line, i) => {
      const cond =
        line.match(/v-(if|show)="([^"]{2,60})"/) ||
        line.match(/\{\s*([A-Za-z0-9_.$'"]{2,40}\s*===?\s*['"][^'"]+['"])\s*&&\s*\(/)
      if (!cond) return
      // 只收看起来像页面切换的：容器是 section/div/main，且条件里带引号字面量
      if (!/<(section|div|main|article|template)/.test(line)) return
      if (!/['"]/.test(cond[2])) return
      const lit = cond[2].match(/['"]([^'"]+)['"]/)?.[1] ?? cond[2]
      const title =
        lines
          .slice(i, Math.min(lines.length, i + 4))
          .join(' ')
          .match(/<h[1-3][^>]*>([^<]{1,20})</)?.[1]?.trim() || lit
      pushCandidate(pageCandidates, seen, {
        hintId: slug(lit, 'state'),
        label: title,
        file,
        line: i + 1,
        basis: `条件渲染 ${cond[1] ?? cond[0]}="${cond[2]}"`
      })
    })

    // —— 4. React 状态切换：useState('tab') 初值 + setX('...') 字面量 ——
    lines.forEach((line, i) => {
      const st = line.match(/useState\s*\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/)
      if (st) {
        pushCandidate(pageCandidates, seen, {
          hintId: slug(st[1], 'state'),
          label: st[1],
          file,
          line: i + 1,
          basis: `useState 初始值 '${st[1]}'`
        })
      }
      const set = line.match(/set[A-Za-z0-9_]*\s*\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/)
      if (set) {
        pushCandidate(pageCandidates, seen, {
          hintId: slug(set[1], 'state'),
          label: set[1],
          file,
          line: i + 1,
          basis: `状态切换 setX('${set[1]}')`
        })
      }
    })

    // —— 5. 跳转证据：点击切换 / href / v-if 条件 ——
    lines.forEach((line, i) => {
      // @click="active='x'" / :onClick=setTab('x') / onClick={() => setTab('x')}
      const click =
        line.match(/@click="([^"]{2,80})"/) ||
        line.match(/onClick=\{\s*\(\)\s*=>\s*([A-Za-z0-9_.'"]+\([^)]{0,40}\))\s*\}/) ||
        line.match(/@click\.native="([^"]{2,80})"/)
      if (click) {
        const lit =
          click[1].match(/['"]([A-Za-z0-9_-]+)['"]/)?.[1] ??
          click[1].match(/#([A-Za-z0-9_-]+)/)?.[1]
        if (lit) {
          jumpEvidence.push({
            fromHint: '',
            toHint: slug(lit, 'page'),
            event: click[1].slice(0, 120),
            snippet: snippetOf(lines, i),
            file,
            line: i + 1
          })
        }
      }
      // display 切换目标：$('#x').style.display / $('#x').classList.add('show')
      // jQuery 风格的 $() 与原生 getElementById 都认。
      const viewSwitch = line.match(
        /(?:\$\(['"]#([A-Za-z0-9_-]+)['"]\)|getElementById\(['"]([A-Za-z0-9_-]+)['"]\))\s*\.\s*(style\.display|classList)/
      )
      if (viewSwitch) {
        const target = viewSwitch[1] ?? viewSwitch[2]
        // 过滤掉明显不是页面的：badge、toast、遮罩小件
        if (!/(badge|toast|mask|tooltip|badge|popover)/i.test(target)) {
          jumpEvidence.push({
            fromHint: '',
            toHint: slug(target, 'page'),
            event: `${viewSwitch[0].slice(0, 80)}`,
            snippet: snippetOf(lines, i),
            file,
            line: i + 1
          })
        }
      }
      // dataset.tab 读取：var k = btn.dataset.tab，说明这是 Tab 分发器。
      // 它的 if (k === 'home') / STUBS[k] 分支即跳转证据。
      if (/\.dataset\.tab/.test(line)) {
        const window = lines.slice(i, Math.min(lines.length, i + 25)).join('\n')
        const branchRe = /(?:if\s*\(\s*k\s*===\s*['"]([A-Za-z0-9_-]+)['"]|STUBS\[k\]|STUBS\.([A-Za-z0-9_]+))/g
        let branchM: RegExpExecArray | null
        const branchSeen = new Set<string>()
        while ((branchM = branchRe.exec(window)) !== null) {
          const lit = branchM[1] ?? (branchM[2] ? null : null)
          if (lit && !branchSeen.has(lit)) {
            branchSeen.add(lit)
            jumpEvidence.push({
              fromHint: '',
              toHint: slug(lit, 'page'),
              event: `Tab 分发 → '${lit}'`,
              snippet: snippetOf(lines, i),
              file,
              line: i + 1
            })
          }
        }
        // STUBS[k] 查表：所有 STUBS 键都是跳转目标
        if (/STUBS\[k\]/.test(window)) {
          for (const cand of pageCandidates) {
            if (cand.file === file && cand.basis.includes('查表页')) {
              jumpEvidence.push({
                fromHint: '',
                toHint: cand.hintId,
                event: `Tab 分发 → STUBS['${cand.hintId}']`,
                snippet: snippetOf(lines, i),
                file,
                line: i + 1
              })
            }
          }
        }
      }
      // 程序化点击：$('.tab[data-tab="home"]').click() / $(...).click()
      const progClick = line.match(/\$\(['"]([^'"]+)['"]\)\.click\(\)/)
      if (progClick) {
        const lit =
          progClick[1].match(/data-tab="([A-Za-z0-9_-]+)"/)?.[1] ??
          progClick[1].match(/#([A-Za-z0-9_-]+)/)?.[1]
        if (lit) {
          jumpEvidence.push({
            fromHint: '',
            toHint: slug(lit, 'page'),
            event: `程序化点击 ${progClick[1]}`,
            snippet: snippetOf(lines, i),
            file,
            line: i + 1
          })
        }
      }
    })
    // href 锚点跳转：from 填同一文件，to 填锚点
    lines.forEach((line, i) => {
      const href = line.match(/href="#([A-Za-z0-9_-]{2,})"/)
      if (href) {
        jumpEvidence.push({
          fromHint: '',
          toHint: slug(href[1], 'section'),
          href: `#${href[1]}`,
          snippet: snippetOf(lines, i),
          file,
          line: i + 1
        })
      }
    })

    // —— 6. 表单证据：v-model / name / input / select / 按钮 ——
    const fields: StaticField[] = []
    const buttons: StaticButton[] = []
    lines.forEach((line, i) => {
      const vm = line.match(/v-model="([^"]+)"/)
      const ctrl = line.match(/<(input|select|textarea)[^>]*>/)
      if (vm || ctrl) {
        const tag = ctrl?.[1] ?? 'input'
        const typeAttr = ctrl?.[0]?.match(/type="([^"]+)"/)?.[1]
        const idAttr = ctrl?.[0]?.match(/\bid="([^"]+)"/)?.[1]
        const nameAttr = ctrl?.[0]?.match(/\bname="([^"]+)"/)?.[1]
        const placeholder = ctrl?.[0]?.match(/placeholder="([^"]{1,20})"/)?.[1]
        // 中文 placeholder（如“搜索商品、品牌、店铺”）不能当 name，优先 name/id/v-model。
        const name =
          vm?.[1] ??
          nameAttr ??
          idAttr ??
          (/[一-鿿]/.test(placeholder ?? '') ? undefined : placeholder) ??
          `${tag}-${i + 1}`
        // 邻近 <label> 文本是真显示名：本行或前 3 行内的 <label>…</label>。
        const nearLabel = [line, lines[i - 1] ?? '', lines[i - 2] ?? '', lines[i - 3] ?? '']
          .map((l) => l.match(/<label[^>]*>([^<]{1,20})</)?.[1]?.trim())
          .find(Boolean)
        const label =
          (nearLabel || placeholder || name).replace(/\s*\*\s*$/, '').trim() || name
        fields.push({
          name,
          label,
          type:
            tag === 'select'
              ? 'select'
              : tag === 'textarea'
                ? 'textarea'
                : typeAttr === 'number'
                  ? 'number'
                  : typeAttr === 'date'
                    ? 'date'
                    : typeAttr === 'password'
                      ? 'password'
                      : typeAttr === 'checkbox'
                        ? 'checkbox'
                        : typeAttr === 'radio'
                          ? 'radio'
                          : tag === 'input' && /搜索|search/i.test(line)
                            ? 'search'
                            : 'text',
          // required 的两种写法：HTML 属性，或邻近 label 里的红星 *。
          required: /\brequired\b/.test(line) || /\*/.test(nearLabel ?? '')
        })
      }
      // 只收真 HTML 标签：行首空白后直接是 <button。JS 字符串拼接的
      // '<button class="chip">' + h + '</button>'（前面有引号/+号）不收。
      const btn =
        line.match(/^\s*<(button|el-button|van-button|a-button)\b[^>]*>([^<]{1,16})</) ||
        line.match(/^\s*<(input\b[^>]*type="(submit|button)"[^>]*value="([^"]{1,16})")/)
      if (btn) {
        const label = (btn[2] ?? btn[3] ?? '').trim()
        if (label && !/['"+]/.test(label)) buttons.push({ label })
      }
    })
    if (fields.length || buttons.length) {
      // 去重：同名只留一个
      const seenField = new Set<string>()
      formEvidence.push({
        pageHint: '',
        fields: fields.filter((f) => (seenField.has(f.name) ? false : (seenField.add(f.name), true))),
        buttons: Array.from(new Map(buttons.map((b) => [b.label, b])).values()),
        file,
        line: 1
      })
    }
  }

  return {
    pageCandidates,
    jumpEvidence,
    formEvidence,
    stats: {
      files: files.length,
      chars,
      pageCandidates: pageCandidates.length,
      jumpEvidence: jumpEvidence.length,
      formFields: formEvidence.reduce((n, f) => n + f.fields.length, 0)
    }
  }
}
