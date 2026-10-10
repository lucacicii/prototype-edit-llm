# 「其他工作站」定义与圈画定位能力矩阵

> 本文档是「被生成内容层框架无关化」的判定基准：后续所有实现、
> 测试、UI 文案都以这里的定义与承诺为准。

## 三种工作站的定义

| # | 代号 | 定义 | 判定条件 |
|---|------|------|----------|
| A | LLM 自选栈（内置宿主内） | LLM 在 runtime-host 内生成原型时自主选择的技术栈 | 预览 URL 为 `http://127.0.0.1:4321/prototypes/:id`，代码由本仓库 agent 写入 `runtime-host/src/views/prototypes/active.{vue,tsx,html}` |
| B | 外部本地项目目录 | 用户通过「导入本地目录」绑定的既有工程 | `ProjectWorkspace.type === 'local-directory'`，`rootPath` 指向仓库外目录，URL 是该工程的 dev server |
| C | 外部 URL | 用户直接粘贴的任意网址 | `ProjectWorkspace.type === 'remote-url'`，`framework === 'native-dom'` |

## 圈画定位能力矩阵

「圈画」拆成两个能力，承诺分别对待：

- **元素圈选**：鼠标悬停高亮 + 点击选中元素，输出标签/类名/文本/选择器/矩形框
- **源码定位**：把选中元素映射回源文件的 `file:line`

| 场景 | 元素圈选 | 源码定位 | 定位信号 |
|------|----------|----------|----------|
| A1: LLM 选 `vue3-element` | ✅ 完整 | ✅ 精确行号 | `data-v-inspector` / `vnode.props.__v_inspector` / `__vueParentComponent` 链（ElTableColumn 特殊处理） |
| A2: LLM 选 `react-ts` | ✅ 完整 | ✅ 精确行号 | `__reactFiber$` / `__reactInternalInstance$` → `_debugSource`，行号经 sourcemap 偏移校正（`calibrateReactLineOffset`） |
| A3: LLM 选 `native-html` | ✅ 完整 | ⚠️ 文本推断 | 无框架元数据，回落 `utils/inspector.ts` 的文本/标签匹配，`sourceLocated=false` |
| A4: LLM 选其他栈（Svelte/Solid/Angular/Web Components…） | ✅ 完整 | ⚠️ 文本推断或不可用 | 宿主未装配对应编译插件时无编译期位置元数据；标记 `experimental` |
| B: 外部本地项目 | ✅ 完整 | ⚠️ 取决于目标工程自身 | 若工程暴露 `data-inspector` 类属性或可访问 sourcemap 则可定位，否则同 A3 |
| C: 外部 URL | ✅ 完整 | ❌ 不承诺 | 探针仍注入（DOM 级圈选可用），但无源码可指，`sourceLocated=false` |

**总承诺：圈选永远可用；源码级定位只对已装配栈（A1/A2）保证精确，其余场景明确降级提示。**

## 显式状态契约

圈选结果（`InspectedTarget`）新增：

```ts
sourceLocated: boolean            // 是否拿到可信的 file:line
locateMode: 'compiler' | 'fiber' | 'text' | 'none'
```

- `compiler`：Vue 编译期注入（精确）
- `fiber`：React Fiber `_debugSource` + sourcemap 校正（精确）
- `text`：文本/标签相似度推断（不精确，UI 需标注「推断位置」）
- `none`：无源码（外部 URL），UI 不显示源码位置

## 栈白名单与仲裁

- **白名单**：`vue3-element`、`react-ts`、`native-html`（宿主已装配，源码定位有保证）
- **实验栈**：白名单之外一律标记 `experimental`，允许生成但 UI 提示定位降级
- **仲裁顺序**（LLM 声明与内容不符时）：
  1. 代码首行声明注释（LLM 生成时按约定写入）
  2. 内容启发式正则（`<template` / `jsx` 特征 / `<!DOCTYPE`）
  3. 两者冲突以声明优先，但记录不一致日志供排查

## 不在本轮范围

- Svelte/Solid/Angular 等实验栈的编译期注入插件（仅标记降级，不装配）
- B/C 场景的 sourcemap 拉取与解析（外部工程/sourcemap 可达性不可控）
