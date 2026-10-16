/**
 * 拓扑图/Spec 生成：提示词、回包解析。
 *
 * 提示词里描述的 JSON、解析器接受的形状、校验器吃的字段，
 * 分开写就会各说各话，所以 prompt 与解析放同一模块。
 * 校验在 `shared/spec.ts`（normalizeSpec），静态证据在 `spec-static.ts`。
 */

import type { StaticEvidence } from './spec-static'

export interface TopologySourceFile {
  file: string
  code: string
}

export interface TopologyPromptInput {
  projectName: string
  techStack: string
  entryFile: string
  /** 项目里的源码文件清单（入口排第一），用于告诉模型「还有哪些文件」。 */
  files: string[]
  /** 已读取的源码正文；超过预算的没进来，靠 files 说明它们存在。 */
  sources: TopologySourceFile[]
  /** 是否因为体积被截断，让模型知道有文件没看全。 */
  truncated: boolean
}

/** v2 Spec 生成的输入：源码 + 静态证据 + 截断明细。 */
export interface SpecPromptInput {
  projectName: string
  techStack: string
  entryFile: string
  files: string[]
  /** 入口全量 + 非入口证据窗口（命中行上下 40 行），无命中文件只给前 30 行。 */
  sources: TopologySourceFile[]
  /** 静态解析器打底的证据，全量内联。 */
  evidence: StaticEvidence
  /** 省略的文件与只给了窗口的文件，如实告知模型。 */
  omittedFiles: string[]
  windowedFiles: Array<{ file: string; ranges: string }>
}

const STACK_HINT: Record<string, string> = {
  'vue3-element': 'Vue 3 单文件组件（<template> / <script setup>）',
  'react-ts': 'React 函数组件（JSX）',
  'native-html': '原生 HTML 文档'
}

export function buildTopologyPrompt(input: TopologyPromptInput): string {
  const stack = STACK_HINT[input.techStack] ?? input.techStack
  const sections: string[] = []

  sections.push(
    [
      `你是一名产品分析师。下面是一个已经做好的原型（${stack}），请把它整理成一张**页面跳转流转图**。`,
      ``,
      `任务：找出原型里的所有「页面 / 视图」，以及它们之间的跳转关系。`,
      `- 节点：一个页面、一个独立视图、一个会遮住整页的弹窗、或一个由状态切换出来的分支页面。`,
      `- 边：用户能看到的一次跳转 —— 点击按钮/列表项、链接、路由跳转、状态切换。`,
      `- 如果一个文件里用页内区块、hash 路由、条件渲染（v-if / useState）或弹窗实现了多个屏，`,
      `  请把它们拆成多个节点，这才是这个原型真实的「页数」。`,
      `- 底部 Tab / 顶部导航 / 侧边导航上的**每一项**都要单独算一个页面，`,
      `  即使实现上共用同一个视图容器（点不同 Tab 只是换标题/内容）——`,
      `  用户看到的是多个页面，绝不要把它们合并成一个「占位页」节点。`,
      `- 漏页比多页更糟：整理完先数一遍导航上能点进去的地方，确认每个都有着落。`,
      `- 确实只有一个屏时，就返回 1 个节点、0 条边，不要硬造跳转。`,
      `- 每条边都必须能在源码里找到依据。找不到依据的跳转不要写。`
    ].join('\n')
  )

  sections.push(
    [
      `【项目】`,
      `- 名称：${input.projectName}`,
      `- 技术栈：${input.techStack}（${stack}）`,
      `- 入口文件：${input.entryFile}`,
      input.files.length > 1 ? `- 全部源码文件：${input.files.join('、')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  for (const source of input.sources) {
    const isEntry = source.file === input.entryFile ? '（入口）' : ''
    sections.push([`【源码 ${source.file}${isEntry}】`, '```', source.code, '```'].join('\n'))
  }

  if (input.truncated) {
    sections.push(
      `注意：上面只给了部分源码（其余文件体积过大已省略，清单见【项目】）。没读到的文件不要凭空猜测它的页面。`
    )
  }

  sections.push(
    [
      `【输出要求】`,
      `只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。`,
      `**不要创建、修改或删除任何文件，不要调用任何写文件的工具。**`,
      `字段如下：`,
      `- title: 字符串，这张图的名字。`,
      `- entry: 字符串，入口页面的 id。`,
      `- nodes: 数组，每项 { id, label, kind, file, line, note }。`,
      `  - id: 短英文标识（kebab-case），全图唯一，不要空格。`,
      `  - label: 页面的中文名，用源码里出现的叫法。`,
      `  - kind: 只能是 "page" | "view" | "modal" | "state"。`,
      `  - file: 该页面所在的源码文件（相对项目根，如 ${input.entryFile}）。`,
      `  - line: 该页面开始的大致行号（数字，估不准就省略）。`,
      `  - note: 一句话说明这个页面是干什么的。`,
      `- edges: 数组，每项 { from, to, label, trigger, selector }。`,
      `  - from / to: 上面 nodes 里的 id。`,
      `  - label: 这次跳转的触发点，例如「点击列表项」。`,
      `  - trigger: 只能是 "click" | "link" | "route" | "state" | "other"。`,
      `  - selector: **触发这次跳转的那个元素**的 CSS 选择器。`,
      `    我们会用它把预览真的点进去，再给目标页面截图 —— 所以它必须是一个`,
      `    在源码里真实存在、能点中的元素（优先用 id、data-* 属性、或唯一的 class 组合；`,
      `    不要写会在运行期改变的下标路径，也不要写 :nth-child 这种脆弱的）。`,
      `    如果这次跳转不是由某个可点击元素触发的（例如代码里直接切状态、定时跳转），`,
      `    就**省略**这个字段，不要硬凑。`,
      ``,
      `再次强调：你只输出 JSON，不要创建或修改任何文件。`,
      ``,
      `示例形状（不要照抄内容）：`,
      `{"title":"某原型页面拓扑图","entry":"list","nodes":[{"id":"list","label":"订单列表","kind":"page","file":"${input.entryFile}","note":"展示全部订单"}],"edges":[{"from":"list","to":"detail","label":"点击列表项","trigger":"click","selector":".order-item"}]}`
    ].join('\n')
  )

  return sections.join('\n\n')
}

/**
 * v2 Spec 生成的提示词：前端重写分析师产出可重写说明书。
 *
 * 与旧 `buildTopologyPrompt` 并存（旧函数保留供回退）。最终目标是“拿着
 * spec 能用任意 UI 库重写”，所以字段的 required/rules/linkage 与动作的
 * condition/params/sideEffect/target 一个都不能靠编 —— 无依据就写
 * inferred，校验层会自动标 unverified。
 */
export function buildSpecPrompt(input: SpecPromptInput): string {
  const stack = STACK_HINT[input.techStack] ?? input.techStack
  const sections: string[] = []

  sections.push(
    [
      `你是一名前端重写分析师。下面是一个已经做好的原型（${stack}），请把它整理成一份**页面说明书（Spec）** —— 拿着这份说明书，另一个工程师能用任意 UI 库（antd / element-plus 等）把原型完整重写出来。`,
      ``,
      `任务分三层：`,
      `1. 页面列表：找出原型里的所有「页面 / 视图」。一个文件里用页内区块、hash 路由、条件渲染（v-if / useState）或弹窗实现的多个屏，全部拆成独立页面；底部 Tab / 顶部导航 / 侧边导航的每一项单独算一页，即使共用同一个视图容器；漏页比多页更糟。`,
      `2. 页面关系：页面之间怎么跳转。每条跳转写清触发点、成立条件、携带参数、前置守卫。`,
      `3. 页面逻辑：每个页面的业务详情 —— 有哪些输入字段（名称/类型/必填/校验规则/候选项/联动）、有哪些可触发的动作（触发条件/副作用/跳转目标）、布局上分哪几个区块。`,
      `- 确实只有一个屏时，就返回 1 个页面、0 条跳转，不要硬造。`,
      ``,
      `【铁律 · 最重要】每个 page / flow / field / action 都必须带 evidence 字段，指向它的源码出处：`,
      `- 引用静态证据或源码行：{"kind":"source","file":"index.html","line":423,"desc":"Tab 按钮 data-tab=\\"tpl\\""}`,
      `- 引用静态证据命中：{"kind":"static","file":"index.html","line":423,"desc":"静态解析命中"}`
      ,
      `- 实在没有依据：{"kind":"inferred"}（下游会标为待核实）。`,
      `缺少 evidence 的条目会被下游一律标记为"待核实"，说明书可信度直接归零。所以：宁可能力不够写少几条，也不要写一堆没有出处的条目。`
    ].join('\n')
  )

  sections.push(
    [
      `【项目】`,
      `- 名称：${input.projectName}`,
      `- 技术栈：${input.techStack}（${stack}）`,
      `- 入口文件：${input.entryFile}`,
      input.files.length > 1 ? `- 全部源码文件：${input.files.join('、')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  sections.push(
    [
      `【静态证据】（从源码自动提取，必须逐条处理）`,
      `- 候选页面 ${input.evidence.stats.pageCandidates} 个：下面列出的每个候选页必须逐个认领 —— 要么成为 pages 里的一项，要么书面说明合并理由（在 warnings 里写一句），禁止静默丢失。`,
      `- 跳转证据 ${input.evidence.stats.jumpEvidence} 条：每条必须对应到某个 action/flow，或书面驳回（误报，因为…）。`,
      `- 表单证据 ${input.evidence.stats.formFields} 个字段：静态命中的字段/按钮在 spec 里出现率必须是 100%（允许你补更多，但不许更少）。`,
      '```json',
      JSON.stringify({
        pageCandidates: input.evidence.pageCandidates,
        jumpEvidence: input.evidence.jumpEvidence,
        formEvidence: input.evidence.formEvidence
      }),
      '```'
    ].join('\n')
  )

  for (const source of input.sources) {
    const isEntry = source.file === input.entryFile ? '（入口，全量）' : ''
    sections.push([`【源码 ${source.file}${isEntry}】`, '```', source.code, '```'].join('\n'))
  }

  if (input.omittedFiles.length || input.windowedFiles.length) {
    const lines = ['注意：上面不是全部源码，没给全的部分不要凭空猜测它的页面。']
    if (input.omittedFiles.length) lines.push(`- 完全没读的文件：${input.omittedFiles.join('、')}`)
    for (const w of input.windowedFiles) {
      lines.push(`- ${w.file}：只给了命中行附近的窗口（${w.ranges}），窗口之外省略。`)
    }
    sections.push(lines.join('\n'))
  }

  // 源码块很长（可能 90k 字符），模型读完容易忘掉头部的铁律 —— 在离生成点
  // 最近的位置再复述一次，并给一个完整的条目样例。
  sections.push(
    [
      `【写之前再确认一次】`,
      `每个 page、每条 flow、每个 field、每个 action 都要有 evidence，形如：`,
      `  "evidence": [{"kind":"source","file":"${input.entryFile}","line":423,"desc":"Tab 按钮 data-tab=\\"tpl\\""}]`,
      `没有出处的条目会被下游标成"待核实"，等于告诉重写者"这条别信"。请优先保证每条都带证据，而不是条目多。`,
      `另外这两块不能省（它们是"业务逻辑详情"的主体）：`,
      `- pages[].sections：本页布局分几个区块（如"底部 Tab 栏""搜索浮层"），每块写 title + layout + 归属的 fieldIds/actionIds。`,
      `- pages[].route：本页在源码里靠什么切出来 —— {"tabKey":"tpl"} / {"anchor":"pricing"} / {"visibleWhen":"activeTab==='search'"}。`
    ].join('\n')
  )

  sections.push(
    [
      `【输出要求】`,
      `只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。`,
      `**不要创建、修改或删除任何文件，不要调用任何写文件的工具。**`,
      `字段如下：`,
      `- title: 字符串，说明书标题。`,
      `- entry: 字符串，入口页面的 id。`,
      `- pages: 数组，每项 { id, label, kind, file, line, summary, route, sections, fields, actions, evidence }。`,
      `  - id: 短英文标识（kebab-case），全 spec 唯一。label: 中文名，用源码原叫法。kind: "page"|"view"|"modal"|"state"。file/line: 源码位置。summary: 2-3 句业务说明。`,
      `  - route: 单文件多页语义的关键，如 {"tabKey":"mine"} / {"anchor":"capability"} / {"visibleWhen":"activeTab==='search'"}。`,
      `  - sections: 数组，每项 { id, title, layout, order, visibleWhen, fieldIds, actionIds }，记录布局分区与字段归属。`,
      `  - fields: 数组，每项 { name, label, type, required, rules, options, default, linkage, evidence }。type 只能是 text|number|date|select|radio|checkbox|textarea|search|password|custom，无法判断填 custom。rules 每项 { kind, value?, message? }，只有源码能佐证的才写。linkage 每项 { when, thenShow?, thenRequire?, thenSet?, targetField }。`,
      `  - actions: 数组，每项 { id, label, trigger, condition, params, sideEffect, target, evidence }。trigger 只能是 click|submit|change|route|timer|other。sideEffect 从 stateSet|navigate|openModal|closeModal|toast|apiMock|filter|reset 里多选，只选有依据的。target 是跳转目标页 id，不跳转省略。`,
      `- flows: 数组，每项 { from, to, label, trigger, condition, params, guards, evidence, actionId }。trigger 只能是 click|link|route|state|other。condition 是跳转成立条件，guards 是前置守卫（如"需登录"），actionId 反指来源 action。凡 action.target 指向他页者必须有对应 flow。`,
      `- evidence: 数组，每项 { kind, file, line, snippet, desc }。kind 只能是 static|source|inferred —— 引用静态证据用 static，引用源码行用 source，没依据用 inferred。`,
      `- warnings: 数组，字符串。候选页合并理由、误报驳回、编不出来的字段说明全写在这里。`,
      ``,
      `再次强调：你只输出 JSON，不要创建或修改任何文件。`
    ].join('\n')
  )

  return sections.join('\n\n')
}

/**
 * 从模型回包里抠出 JSON。
 *
 * 尽量宽容：剥围栏、截掉前后废话、按括号计数找第一个平衡的对象
 * （计数要跳过字符串里的括号和转义）。解析不出来就返回 null，
 * 上层据此走「重试一次 → 报错并留下原文」的路径。
 */
export function parseTopologyReply(reply: string | null | undefined): unknown | null {
  if (typeof reply !== 'string') return null
  let text = reply.trim()
  if (!text) return null

  // 剥 ```json / ``` 围栏（可能有多段，取第一段含 { 的）
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && fence[1].includes('{')) text = fence[1].trim()

  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 解析失败时给用户看的原文片段。 */
export function rawExcerpt(reply: string | null | undefined, limit = 600): string {
  const text = typeof reply === 'string' ? reply.trim() : ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

