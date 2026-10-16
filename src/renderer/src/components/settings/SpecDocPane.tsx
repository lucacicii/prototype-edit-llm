import React from 'react'
import { Button, message } from 'antd'
import { BookText, ClipboardCopy, FileJson2 } from 'lucide-react'
import {
  ACTION_TRIGGERS,
  EVIDENCE_KINDS,
  FIELD_TYPES,
  RULE_KINDS,
  SIDE_EFFECTS,
  SPEC_VERSION
} from '../../../../shared/spec'
import { KIND_LABEL, TRIGGER_LABEL } from '../../../../shared/topology'

/**
 * Spec 格式说明书。
 *
 * 所有枚举值都从 `shared/spec.ts` / `shared/topology.ts` 的常量取，
 * 不手写 —— 契约改了这里跟着改，不会漂。
 */

interface Row {
  name: string
  type: string
  desc: string
}

const DocTable: React.FC<{ rows: Row[] }> = ({ rows }) => (
  <div className="overflow-hidden rounded-lg border border-slate-800">
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="bg-slate-950/70 text-slate-400">
          <th className="text-left font-medium px-2.5 py-1.5 w-[150px]">字段</th>
          <th className="text-left font-medium px-2.5 py-1.5 w-[110px]">类型</th>
          <th className="text-left font-medium px-2.5 py-1.5">说明</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-slate-800/70 align-top">
            <td className="px-2.5 py-1.5 font-mono text-sky-300">{r.name}</td>
            <td className="px-2.5 py-1.5 font-mono text-slate-500">{r.type}</td>
            <td className="px-2.5 py-1.5 text-slate-300 leading-relaxed">{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const Card: React.FC<{
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}> = ({ icon, title, children }) => (
  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
      {icon}
      <span>{title}</span>
    </span>
    {children}
  </div>
)

const Enum: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div className="flex items-baseline gap-2 text-[11px]">
    <span className="font-mono text-slate-400 w-[150px] shrink-0">{label}</span>
    <span className="text-slate-300">{values.join(' / ')}</span>
  </div>
)

/** 复制给别处用的重写指令模板 —— 这是整份说明书存在的意义。 */
const REWRITE_PROMPT = `我会给你一份原型页面说明书（spec.json），请按它用 <目标 UI 库> 重写这个原型。

要求：
1. 严格按 pages 建页面，route 字段决定它在这套工程里怎么落地（tabKey → Tab、anchor → 锚点、"visibleWhen" → 条件渲染）。
2. 按 pages[].sections 还原布局分区，layout 是版式描述。
3. 按 pages[].fields 建表单：type 定控件、required/rules 做校验、options 做候选项、linkage 做联动。
4. 按 pages[].actions 与 flows 还原交互：condition 是触发条件，sideEffect 是要产生的副作用，target 是跳转目标。
5. evidence 里 kind 为 inferred 的条目、以及标了 unverified 的页面/跳转，都是没有源码出处的推断 —— 实现时不要自行脑补，先问我。
6. 缺字段不要编：拿不准就列出来问我。`

export const SpecDocPane: React.FC = () => {
  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(REWRITE_PROMPT)
      message.success('已复制重写指令模板')
    } catch {
      message.error('复制失败，请手动选中复制')
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-5 space-y-6">
      <header className="flex items-center justify-between pb-3 pr-14 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-100">页面说明书（Spec v{SPEC_VERSION}）格式</h2>
          <p className="text-xs text-slate-400">
            说明书长什么样、每个字段什么意思、怎么拿它把原型重写一遍
          </p>
        </div>
        <Button size="small" icon={<ClipboardCopy size={13} />} onClick={handleCopyPrompt}>
          复制重写指令
        </Button>
      </header>

      <Card icon={<FileJson2 size={14} className="text-sky-400" />} title="这是什么 · 存在哪">
        <p className="text-[11px] text-slate-300 leading-relaxed">
          在「页面说明书」页签点生成后，AI 会读一遍原型源码，产出一份描述
          <span className="text-slate-100"> 有几个页面、页面怎么跳、每页有什么字段与动作 </span>
          的说明书。目标是：拿着它，换个 UI 库也能把原型重写出来。
        </p>
        <div className="text-[11px] text-slate-400 space-y-1">
          <div>
            真相文件{' '}
            <code className="px-1 rounded bg-slate-800 text-slate-300">
              &lt;项目目录&gt;/.prototype-meta/spec.json
            </code>
          </div>
          <div>
            兼容投影{' '}
            <code className="px-1 rounded bg-slate-800 text-slate-300">topology.json</code>
            （只有节点与边，给旧版本读；由 spec 投影而来）
          </div>
          <div>
            解析失败时的模型原文{' '}
            <code className="px-1 rounded bg-slate-800 text-slate-300">topology.raw.txt</code>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2">
          生成分两阶段：<span className="text-slate-300">静态解析器</span>
          先从源码抠出页面候选、跳转证据、表单字段（锚点、Tab、条件渲染、useState、display
          切换等），再交给模型认领并补业务语义。静态没命中的部分模型会标成
          <code className="mx-1 px-1 rounded bg-slate-800 text-slate-300">inferred</code>
          待核实，而不是编造。
        </div>
      </Card>

      <Card icon={<BookText size={14} className="text-indigo-400" />} title="顶层结构">
        <DocTable
          rows={[
            { name: 'version', type: '2', desc: '契约版本。与旧图 topology.json 区分。' },
            { name: 'title', type: 'string', desc: '说明书标题。' },
            { name: 'entry', type: 'string', desc: '入口页 id，必须是 pages 里的一个。' },
            { name: 'techStack', type: 'string?', desc: 'vue3-element / react-ts / native-html。' },
            { name: 'entryFile', type: 'string?', desc: '入口文件名。' },
            {
              name: 'sourceFingerprint',
              type: 'string',
              desc: '多文件联合指纹（入口源码 + 各文件 size/mtime）。对不上说明源码改过，说明书可能已过期。'
            },
            { name: 'entryFingerprint', type: 'string?', desc: '入口源码指纹，渲染层判断入口是否改过用。' },
            { name: 'files', type: 'string[]?', desc: '生成时的源码文件清单快照，用于判断文件增删。' },
            { name: 'generatedAt', type: 'number', desc: '生成时间戳。' },
            { name: 'pages', type: 'PageSpec[]', desc: '页面清单 —— 「有多少页面」的答案。' },
            { name: 'flows', type: 'FlowSpec[]', desc: '跳转清单 —— 「页面怎么跳转」的答案。' },
            { name: 'warnings', type: 'string[]?', desc: '校验、证据缺失、自动补齐的交代。' },
            { name: 'stats', type: 'object?', desc: '{ pageCount, flowCount, unverifiedCount }。' }
          ]}
        />
      </Card>

      <Card icon={<BookText size={14} className="text-emerald-400" />} title="pages[] 页面">
        <DocTable
          rows={[
            { name: 'id', type: 'string', desc: '全 spec 唯一（kebab-case）。flows 靠它引用。' },
            { name: 'label', type: 'string', desc: '中文名，用源码里的原叫法。' },
            { name: 'kind', type: 'enum', desc: '页面类型，见下方枚举。' },
            { name: 'file / line', type: 'string / number', desc: '所在源码文件与大致行号。' },
            { name: 'summary', type: 'string?', desc: '2–3 句业务说明：本页干什么、前置条件、产出。' },
            {
              name: 'route',
              type: 'PageRoute?',
              desc: '单文件多页语义的关键 —— 本页在源码里靠什么切出来：{ tabKey } / { anchor } / { visibleWhen }。'
            },
            { name: 'sections', type: 'SectionSpec[]?', desc: '布局分区：title + layout（版式描述）+ order + 归属的 fieldIds/actionIds。' },
            { name: 'fields', type: 'FieldSpec[]?', desc: '本页输入字段；展示页为空数组。' },
            { name: 'actions', type: 'ActionSpec[]?', desc: '本页可触发的动作。' },
            { name: 'evidence', type: 'Evidence[]?', desc: '支撑本页存在的源码出处。' },
            {
              name: 'unverified',
              type: 'boolean?',
              desc: '没有源码证据、纯推断时置 true —— 重写者应把它当"待确认"，而不是事实。'
            },
            { name: 'detailMissing', type: 'boolean?', desc: '由旧图升上来的骨架，无字段/动作详情。' }
          ]}
        />
      </Card>

      <Card icon={<BookText size={14} className="text-amber-400" />} title="fields[] 字段">
        <DocTable
          rows={[
            { name: 'name', type: 'string', desc: '源码里的变量/控件名（如 name、phone、keyword）。' },
            { name: 'label', type: 'string', desc: '界面显示名。' },
            { name: 'type', type: 'enum', desc: '控件类型，见下方枚举。判断不出填 custom，不许编。' },
            { name: 'required', type: 'boolean', desc: '是否必填。' },
            { name: 'rules', type: 'ValidationRule[]?', desc: `校验规则：{ kind, value?, message? }，如 { kind:"min", value:"6" }。kind 见下方枚举。` },
            { name: 'options', type: 'array?', desc: 'select/radio/checkbox 的候选项，字符串或 { label, value }。' },
            { name: 'default', type: 'string?', desc: '默认值原文。' },
            {
              name: 'linkage',
              type: 'FieldLinkage[]?',
              desc: '字段间联动：{ when, targetField, thenShow?, thenRequire?, thenSet? }。例：选「到店自提」才显示门店字段 —— when 是条件，targetField 是被影响的字段。'
            },
            { name: 'evidence', type: 'Evidence[]?', desc: '本字段的源码出处。' }
          ]}
        />
      </Card>

      <Card icon={<BookText size={14} className="text-rose-400" />} title="actions[] 动作 与 flows[] 跳转">
        <DocTable
          rows={[
            { name: 'actions[].id', type: 'string', desc: '页内唯一。flows 靠 actionId 反指回来。' },
            { name: 'actions[].label', type: 'string', desc: '按钮/触发点文案。' },
            { name: 'actions[].trigger', type: 'enum', desc: '触发方式，见下方枚举。' },
            { name: 'actions[].condition', type: 'string?', desc: '触发条件原文或意译；省略 = 无条件可点。' },
            { name: 'actions[].params', type: 'object?', desc: '携带参数，如 { tab:"mine" }。' },
            { name: 'actions[].sideEffect', type: 'enum[]?', desc: '产生的副作用，可多选，见下方枚举。' },
            { name: 'actions[].target', type: 'string?', desc: '跳转目标页 id；页内状态切换填自身 id。' },
            { name: 'flows[].from / to', type: 'string', desc: '两端页面 id。自环与悬空边会被丢弃并记进 warnings。' },
            { name: 'flows[].label', type: 'string?', desc: '这次跳转的触发点描述。' },
            { name: 'flows[].trigger', type: 'enum', desc: '跳转方式，见下方枚举。' },
            { name: 'flows[].condition', type: 'string?', desc: '跳转成立条件。与对应 action 冲突时以 action 为准。' },
            { name: 'flows[].guards', type: 'string[]?', desc: '前置守卫，如「需登录」「需选中地址」。' },
            { name: 'flows[].params', type: 'object?', desc: '跳转携带参数。' },
            { name: 'flows[].actionId', type: 'string?', desc: '反指来源 action，建立动作 ↔ 跳转双向关联（自动补齐）。' }
          ]}
        />
      </Card>

      <Card icon={<BookText size={14} className="text-fuchsia-400" />} title="evidence[] 证据与可信度">
        <DocTable
          rows={[
            { name: 'kind', type: 'enum', desc: `静态命中 / 源码行引用 / 模型推断 —— ${EVIDENCE_KINDS.join(' / ')}。` },
            { name: 'file / line', type: 'string / number', desc: '源码位置。' },
            { name: 'snippet', type: 'string?', desc: '≤200 字的源码原文，供人工核对。' },
            { name: 'desc', type: 'string?', desc: '一句话说明这条证据证明了什么。' }
          ]}
        />
        <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2">
          规则：一个页面/跳转如果连一条
          <code className="mx-1 px-1 rounded bg-slate-800 text-slate-300">static</code> 或
          <code className="mx-1 px-1 rounded bg-slate-800 text-slate-300">source</code>
          证据都没有，会被自动标 <code className="px-1 rounded bg-slate-800 text-slate-300">unverified: true</code>
          —— 它<b className="text-slate-200">不会被丢掉</b>，但会被明确标成"待核实"。
          自动补齐的动作与跳转一律标 inferred，绝不当成事实。
        </div>
      </Card>

      <Card icon={<BookText size={14} className="text-cyan-400" />} title="枚举值（随代码契约同步）">
        <div className="space-y-1.5">
          <Enum label="page.kind" values={Object.entries(KIND_LABEL).map(([k, v]) => `${k}（${v}）`)} />
          <Enum label="flow.trigger" values={Object.entries(TRIGGER_LABEL).map(([k, v]) => `${k}（${v}）`)} />
          <Enum label="field.type" values={FIELD_TYPES} />
          <Enum label="field.rules[].kind" values={RULE_KINDS} />
          <Enum label="action.trigger" values={ACTION_TRIGGERS} />
          <Enum label="action.sideEffect" values={SIDE_EFFECTS} />
          <Enum label="evidence.kind" values={EVIDENCE_KINDS} />
        </div>
      </Card>

      <Card icon={<ClipboardCopy size={14} className="text-sky-400" />} title="怎么拿它重写">
        <ol className="text-[11px] text-slate-300 leading-relaxed list-decimal pl-4 space-y-1">
          <li>在「页面说明书」页签生成一次，然后点工具条「导出」选 <b className="text-slate-100">Spec JSON</b>。</li>
          <li>把 json 连同上面的「重写指令」一起交给另一个工程师或 AI。</li>
          <li>
            按 <code className="px-1 rounded bg-slate-800">pages[].route</code> 决定每页在新工程里怎么落地，
            按 <code className="px-1 rounded bg-slate-800">sections</code> 还原版式。
          </li>
          <li>
            遇到 <code className="px-1 rounded bg-slate-800">unverified</code> 或
            <code className="mx-1 px-1 rounded bg-slate-800">inferred</code> 的条目，
            <b className="text-slate-100">先回头确认</b>，不要自行脑补。
          </li>
          <li>想给人读的版本，导出时选 Markdown —— 同一份数据的可读渲染。</li>
        </ol>
      </Card>
    </div>
  )
}
