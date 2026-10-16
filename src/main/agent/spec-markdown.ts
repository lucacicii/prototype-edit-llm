/**
 * 把 SpecDoc 渲染成一份人能直接读的 Markdown 说明书。
 *
 * 纯函数、零依赖，放在主进程里跟 `shared/spec.ts` 的契约对齐。
 * 产物定位：机器消费读 spec.json，人读这份 md —— 重写者只读 md 也能开工。
 *
 * 注意：本模块会被打进主进程 bundle，模板里**不能出现 `<script>` 或
 * `import ... from` 这样的字样** —— electron-vite 的 esmShimPlugin 会连
 * 字符串字面量一起正则扫描（DEVELOPMENT.md §五.1）。这里只有纯文本。
 */

import type { ActionSpec, FieldSpec, FlowSpec, PageSpec, SpecDoc } from '../../shared/spec'
import { KIND_LABEL, TRIGGER_LABEL } from '../../shared/topology'

function cell(value: string | undefined): string {
  if (!value) return '—'
  // 表格里不能出现裸竖线，换行也不能留。
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—'
}

function evidenceText(items?: ActionSpec['evidence']): string {
  if (!items?.length) return ''
  return items
    .map((e) => {
      const loc = e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : ''
      const parts = [e.kind, loc, e.desc].filter(Boolean)
      return parts.join(' ')
    })
    .join('；')
}

function routeText(page: PageSpec): string {
  const r = page.route
  if (!r) return ''
  const parts: string[] = []
  if (r.tabKey) parts.push(`Tab \`${r.tabKey}\``)
  if (r.anchor) parts.push(`锚点 \`#${r.anchor}\``)
  if (r.visibleWhen) parts.push(`出现条件 \`${r.visibleWhen}\``)
  return parts.join(' · ')
}

function fieldsTable(fields: FieldSpec[]): string {
  const lines: string[] = [
    '| 字段 | 显示名 | 类型 | 必填 | 校验 / 候选 | 联动 | 出处 |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const f of fields) {
    const rules = [
      ...(f.rules ?? []).map((r) => `${r.kind}${r.value ? `=${r.value}` : ''}`),
      ...(f.options?.length
        ? [
            `候选：${f.options
              .map((o) => (typeof o === 'string' ? o : o.label))
              .slice(0, 8)
              .join(' / ')}`
          ]
        : []),
      ...(f.default ? [`默认 ${f.default}`] : [])
    ].join('；')
    const linkage = (f.linkage ?? [])
      .map((l) => `${l.when} → ${l.targetField}`)
      .join('；')
    lines.push(
      `| \`${cell(f.name)}\` | ${cell(f.label)} | ${f.type} | ${f.required ? '是' : '否'} | ${cell(
        rules
      )} | ${cell(linkage)} | ${cell(evidenceText(f.evidence))} |`
    )
  }
  return lines.join('\n')
}

function actionsTable(page: PageSpec, actions: ActionSpec[], labelOf: Map<string, string>): string {
  const lines: string[] = [
    '| 动作 | 触发 | 条件 | 参数 | 副作用 | 跳转 | 出处 |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const a of actions) {
    const params = a.params
      ? Object.entries(a.params)
          .map(([k, v]) => `${k}=${v}`)
          .join('、')
      : ''
    const target =
      a.target === page.id
        ? '（本页状态切换）'
        : a.target
          ? `${labelOf.get(a.target) ?? a.target}`
          : ''
    lines.push(
      `| ${cell(a.label)} | ${a.trigger} | ${cell(a.condition)} | ${cell(params)} | ${cell(
        a.sideEffect?.join(' / ')
      )} | ${cell(target)} | ${cell(evidenceText(a.evidence))} |`
    )
  }
  return lines.join('\n')
}

function flowLine(flow: FlowSpec, dir: 'in' | 'out', labelOf: Map<string, string>): string {
  const other = dir === 'out' ? flow.to : flow.from
  const arrow = dir === 'out' ? '→' : '←'
  const bits = [
    `${arrow} **${labelOf.get(other) ?? other}**`,
    flow.label ? `（${flow.label}）` : '',
    `触发：${flow.trigger}`,
    flow.condition ? `条件：${flow.condition}` : '',
    flow.guards?.length ? `守卫：${flow.guards.join('、')}` : '',
    flow.params
      ? `参数：${Object.entries(flow.params)
          .map(([k, v]) => `${k}=${v}`)
          .join('、')}`
      : '',
    flow.unverified ? '⚠️ 待核实' : ''
  ]
  return `- ${bits.filter(Boolean).join(' · ')}`
}

/** 跨页同名字段对照：重写时最容易踩的坑就是同名不同义。 */
function fieldDictionary(spec: SpecDoc): string {
  const byName = new Map<string, Array<{ page: PageSpec; field: FieldSpec }>>()
  for (const page of spec.pages) {
    for (const field of page.fields ?? []) {
      if (!byName.has(field.name)) byName.set(field.name, [])
      byName.get(field.name)!.push({ page, field })
    }
  }
  if (!byName.size) return '_（没有输入字段）_'
  const lines: string[] = [
    '| 字段 | 出现页面 | 显示名 | 类型 | 必填 |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const [name, hits] of byName) {
    lines.push(
      `| \`${cell(name)}\` | ${cell(hits.map((h) => h.page.label).join('、'))} | ${cell(
        hits[0].field.label
      )} | ${hits[0].field.type} | ${hits[0].field.required ? '是' : '否'} |`
    )
  }
  return lines.join('\n')
}

export function renderSpecMarkdown(spec: SpecDoc): string {
  const labelOf = new Map(spec.pages.map((p) => [p.id, p.label]))
  const generated = spec.generatedAt
    ? new Date(spec.generatedAt).toLocaleString('zh-CN')
    : '未知时间'

  const out: string[] = []
  out.push(`# ${spec.title}`)
  out.push('')
  out.push(
    [
      `- 页面：**${spec.pages.length}** 个`,
      `- 跳转：**${spec.flows.length}** 条`,
      spec.stats?.unverifiedCount ? `- 待核实：**${spec.stats.unverifiedCount}** 项` : '',
      spec.techStack ? `- 技术栈：${spec.techStack}` : '',
      spec.entryFile ? `- 入口文件：\`${spec.entryFile}\`` : '',
      `- 生成于 ${generated}`
    ]
      .filter(Boolean)
      .join('\n')
  )
  out.push('')

  out.push('## 页面清单')
  out.push('')
  out.push('| 页面 | 类型 | 说明 | 切页方式 | 出处 |')
  out.push('| --- | --- | --- | --- | --- |')
  for (const p of spec.pages) {
    const mark = p.id === spec.entry ? ' 🚪入口' : ''
    out.push(
      `| ${cell(p.label)}${mark} | ${KIND_LABEL[p.kind]} | ${cell(p.summary)} | ${cell(
        routeText(p)
      )} | ${cell(p.file ? `${p.file}${p.line ? `:${p.line}` : ''}` : '')} |`
    )
  }
  out.push('')

  out.push('## 页面详情')
  out.push('')
  for (const page of spec.pages) {
    out.push(`### ${page.label}`)
    out.push('')
    const meta = [
      KIND_LABEL[page.kind],
      page.id === spec.entry ? '入口' : '',
      page.unverified ? '⚠️ 待核实' : '',
      page.detailMissing ? '（旧版数据，无详情）' : ''
    ]
      .filter(Boolean)
      .join(' · ')
    out.push(`> ${meta}`)
    out.push('')
    if (page.summary) {
      out.push(page.summary)
      out.push('')
    }
    const route = routeText(page)
    if (route) {
      out.push(`**切页方式**：${route}`)
      out.push('')
    }
    if (page.file) {
      out.push(`**源码**：\`${page.file}${page.line ? `:${page.line}` : ''}\``)
      out.push('')
    }

    if (page.sections?.length) {
      out.push('**布局区块**')
      out.push('')
      for (const s of page.sections) {
        const bits = [s.layout, s.visibleWhen ? `出现条件 \`${s.visibleWhen}\`` : ''].filter(Boolean)
        const owned = [
          s.fieldIds?.length ? `字段：${s.fieldIds.join('、')}` : '',
          s.actionIds?.length ? `动作：${s.actionIds.join('、')}` : ''
        ].filter(Boolean)
        out.push(`- **${s.title}**${bits.length ? ` — ${bits.join(' · ')}` : ''}`)
        if (owned.length) out.push(`  - ${owned.join('；')}`)
      }
      out.push('')
    }

    out.push(`**字段**（${page.fields?.length ?? 0}）`)
    out.push('')
    if (page.fields?.length) {
      out.push(fieldsTable(page.fields))
    } else {
      out.push('_展示页，无输入字段。_')
    }
    out.push('')

    out.push(`**动作**（${page.actions?.length ?? 0}）`)
    out.push('')
    if (page.actions?.length) {
      out.push(actionsTable(page, page.actions, labelOf))
    } else {
      out.push('_无可触发动作。_')
    }
    out.push('')

    const inbound = spec.flows.filter((f) => f.to === page.id)
    const outbound = spec.flows.filter((f) => f.from === page.id)
    out.push(`**跳转**（入 ${inbound.length} · 出 ${outbound.length}）`)
    out.push('')
    if (!inbound.length && !outbound.length) {
      out.push('_孤岛页面，无进出跳转。_')
    } else {
      for (const f of outbound) out.push(flowLine(f, 'out', labelOf))
      for (const f of inbound) out.push(flowLine(f, 'in', labelOf))
    }
    out.push('')
  }

  out.push('## 字段字典')
  out.push('')
  out.push(fieldDictionary(spec))
  out.push('')

  const unverifiedPages = spec.pages.filter((p) => p.unverified)
  const unverifiedFlows = spec.flows.filter((f) => f.unverified)
  if (unverifiedPages.length || unverifiedFlows.length) {
    out.push('## 待核实清单')
    out.push('')
    out.push('下面这些条目没有在源码里找到出处，重写前请找原型作者确认。')
    out.push('')
    for (const p of unverifiedPages) out.push(`- 页面 **${p.label}**（\`${p.id}\`）`)
    for (const f of unverifiedFlows) {
      out.push(
        `- 跳转 **${labelOf.get(f.from) ?? f.from} → ${labelOf.get(f.to) ?? f.to}**${
          f.label ? `（${f.label}）` : ''
        }`
      )
    }
    out.push('')
  }

  if (spec.warnings?.length) {
    // 原始 warnings 有几十条，且大量重复语义（每条边都报一次"缺少源码证据"）。
    // 这里做轻聚合：已被「待核实清单」覆盖的不再重复，「补了跳转」按条数汇总。
    let stubbed = 0
    let restored = 0
    const notable: string[] = []
    for (const w of spec.warnings) {
      if (/缺少源码证据/.test(w)) continue // 待核实清单已列
      if (/补了一个跳转动作|补了一条跳转/.test(w)) {
        stubbed++
        continue
      }
      if (/已还原/.test(w)) {
        restored++
        continue
      }
      notable.push(w)
    }
    const summary: string[] = []
    if (stubbed) summary.push(`自动补齐了 ${stubbed} 个跳转动作（来自跳转边，均标待核实）`)
    if (restored) summary.push(`还原了 ${restored} 个被改动的文件`)
    const lines = [...notable, ...summary]
    if (lines.length) {
      out.push('## 生成时的交代')
      out.push('')
      for (const w of lines) out.push(`- ${w}`)
      out.push('')
    }
  }

  out.push('---')
  out.push('')
  out.push(
    `由 Prototype Studio 生成 · 跳转方式：${Object.values(TRIGGER_LABEL).join(' / ')}`
  )
  out.push('')

  return out.join('\n')
}
