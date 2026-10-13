# Prototype Studio (`prototype-edit-llm`) 开发与 Thunder 协同指南

本文档重点说明 `prototype-edit-llm` 的整体工程架构、独立项目数据目录规范，以及**如何与底层 Rust Agent 引擎 `thunder` 进行日常协同开发、协议交互与版本发布**。

---

## 一、整体架构定位：纯壳注入浏览器 + Thunder 全能力 Agent

`prototype-edit-llm`（产品名 **Prototype Studio**）采用 **「宿主壳与业务项目完全解耦」** 的设计：

1. **宿主应用 (`prototype-edit-llm`)**：
   - **模型与密钥唯一中心**：负责管理 LLM 服务商端点（`providers.json`）、通过系统钥匙串加密存储 API Key（`provider-secrets.json`），以及探测模型思考等级（`thinkingLevels`）。
   - **纯净浏览器壳 + CDP 探针注入 (`BrowserViewManager`)**：内置浏览器不耦合任何特定前端业务代码。页面加载时通过 CDP 自动注入 `injected-browser-probe.ts`，直接从 DOM 节点的 `__vnode` / `__vueParentComponent` / `__reactFiber$` / `_debugSource` 提取元素的真实源码文件路径（`sourceFile`）与行号（`sourceLine`），并采集运行期控制台报错。
   - **双模预览运行器 (`ProjectRunner`)**：
     - **静态直出服务** (`http://127.0.0.1:4322/projects/<id>/...`)：针对 `native-html` 项目直接映射项目目录，免编译毫秒级预览。
     - **Vite 编译宿主** (`http://127.0.0.1:4321/prototypes/<id>`)：自动铺设在 `~/.prototype-studio/runtime-host` 下，为 Vue 3 (`index.vue`) 与 React (`index.tsx`) 提供 HMR 编译预览，绝不污染本仓库源码树。

2. **Agent 引擎侧车 (`thunder-daemon` / `thunder-runtime`)**：
   - 以独立 Rust 二进制侧车（Sidecar）方式运行，通过 **stdio NDJSON**（行分隔 JSON）与 Electron 主进程通信。
   - 主对话与工程读写由 **`thunder-daemon`** 驱动：每个原型方案作为独立的 `workspace_dir` 传入，直接复用 `thunder` 原生的：
     - **完整工具集 (`thunder-agent-pack-code`)**：`read_file`、`write_file`、`ls`、`find`、`grep`、`bash`（带路径沙箱 Path Jail 与原子文件写入）。
     - **交互式澄清工具 (`ask_user_question`)**：面向产品经理（PM）发起结构化的单选/多选问题卡片。
     - **上下文指令自动发现**：自动读取项目目录下的 `AGENTS.md`（由 `pm-persona.ts` 按产品场景生成）。

---

## 二、目录结构与数据隔离规范 (`~/.prototype-studio/`)

所有运行期数据、模型配置与用户创建的原型项目统一存放在 **`~/.prototype-studio/`**（可通过环境变量 `PROTOTYPE_STUDIO_HOME` 覆盖），与本代码仓库完全隔离：

```text
~/.prototype-studio/
├── providers.json              # 模型服务商与模型参数清单（不含密钥）
├── provider-secrets.json       # Electron safeStorage (系统钥匙串) 加密后的 API Keys (0600)
├── .prototype-agent.json       # 当前选中的模型引用 { provider, id }、thinkingLevel 与 Agent 调优参数
├── .prototype-history/         # 各原型项目的历史版本快照仓 (v1.html / v2.vue / v3.tsx ...)
├── runtime-host/               # 运行期自动铺设的 Vite 多栈编译宿主副本
├── thunder/                    # THUNDER_CONFIG_DIR 隔离目录（存放 thunder 会话、trace 与缓存，不碰 ~/.thunder）
└── projects/                   # 所有独立的原型项目工作区
    ├── active-project.txt      # 当前激活的项目 ID
    └── <project-id>/           # 单个独立原型项目（即 thunder-daemon 的 workspace_dir）
        ├── AGENTS.md           # 自动生成的 PM 场景引导与技术栈规范（thunder 自动加载）
        ├── index.html          # 或 index.vue / index.tsx 及项目其他源码文件
        └── .prototype-meta/
            ├── project.json    # 项目元数据（名称、场景、技术栈、sessionId 等）
            └── chat.json       # 聊天面板消息持久化
```

### 模型服务商如何与本机 `~/.thunder` 隔离？

1. **环境变量隔离**：应用启动时，`src/main/runtime-env.ts` 会将 `process.env.THUNDER_CONFIG_DIR` 设为 `~/.prototype-studio/thunder`，因此 `thunder` 侧车永远不会读写用户本机的 `~/.thunder/`。
2. **`model_descriptor` 按次完整透传**：
   - `thunder` 侧车不需要维护任何 `models.json` 或 `auth.json`。
   - 每次执行任务时，Electron 主进程从 `providers.json` + `provider-secrets.json` 解密组装出完整的 `RuntimeModel`，通过 `run_task` 请求的 **`model_descriptor`** 字段直接传给 `thunder-daemon`。
   - `thunder-daemon` 收到 `model_descriptor` 后直接调用 `RpiAiClient::from_descriptor` 构建 HTTP 流客户端。

---

## 三、如何与 `thunder` 仓库协同开发

`thunder` 是一个独立的 Rust 仓库（如本地位于 `/Users/lucas/wz/GitHub/thunder`，远端发布于 GitHub Releases）。
`prototype-edit-llm` **不将 `thunder` 源码硬编码进仓库**，而是通过 **`sidecars.lock.json` + `build/thunder-bin/<arch>/` 缓存 + 环境变量覆盖** 三级机制协同。

### 1. 二进制侧车的查找优先级

无论在开发态（`src/main/agent/thunder-binaries.ts`）还是打包脚本（`scripts/thunder-binaries.mjs`）中，查找 `thunder-daemon` 和 `thunder-runtime` 的顺序严格一致：

1. **第 1 优先级：环境变量显式指定（联调最快）**
   - `$THUNDER_DAEMON_BIN`
   - `$THUNDER_RUNTIME_BIN`
2. **第 2 优先级：打包后的应用内资源目录**
   - `Resources/bin/thunder-daemon` & `Resources/bin/thunder-runtime`（仅在 `.app` 打包态生效）
3. **第 3 优先级：仓库本地经校验的缓存目录**
   - `<repo>/build/thunder-bin/<platform>-<arch>/`（与 `sidecars.lock.json` 中的 SHA256 比对）

---

### 2. 场景 A：日常只改 `prototype-edit-llm`（不改 `thunder`）

当你只开发前端或 Electron 宿主逻辑时，直接从 GitHub Releases 拉取已锁定的 `thunder` 二进制即可：

```bash
# 1. 根据 sidecars.lock.json 从 GitHub Release 下载对应架构二进制并校验 SHA256
npm run fetch:thunder

# 2. 校验本地侧车缓存是否与 sidecars.lock.json 一致
npm run verify:sidecars

# 3. 启动开发环境
npm run dev
```

---

### 3. 场景 B：同时修改 `thunder`（Rust）与 `prototype-edit-llm` 本地联调

当你在 `/Users/lucas/wz/GitHub/thunder` 中修改了协议、工具或 Loop 逻辑，需要在 `prototype-edit-llm` 中立刻验证时，有两种方式：

#### 方式 1：环境变量直连（免拷贝，改完 Rust 编译即生效）

在 `/Users/lucas/wz/GitHub/thunder` 编译后：
```bash
cd /Users/lucas/wz/GitHub/thunder
cargo build --release -p thunder-agent-daemon -p thunder-agent-runtime
```

然后在启动 `prototype-edit-llm` 时指定环境变量指向 `target/release`：
```bash
cd /Users/lucas/wz/GitHub/prototype-edit-llm
THUNDER_DAEMON_BIN=/Users/lucas/wz/GitHub/thunder/target/release/thunder-daemon \
THUNDER_RUNTIME_BIN=/Users/lucas/wz/GitHub/thunder/target/release/thunder-runtime \
npm run dev
```

#### 方式 2：使用快捷脚本一键从本地 `thunder` 仓库同步并更新锁文件

`package.json` 已内置指向 `/Users/lucas/wz/GitHub/thunder` 的同步脚本：

```bash
# 1. 在 thunder 仓库构建 release 产物
cd /Users/lucas/wz/GitHub/thunder
cargo build --release -p thunder-agent-daemon -p thunder-agent-runtime

# 2. 回到 prototype-edit-llm，一键拷贝二进制到 build/thunder-bin 并更新 sidecars.lock.json
cd /Users/lucas/wz/GitHub/prototype-edit-llm
npm run sync:thunder:local
```

> 说明：
> - `npm run fetch:thunder:local`：只将 `/Users/lucas/wz/GitHub/thunder/target/release/` 下的二进制复制到 `build/thunder-bin/<arch>/`，不改写 `sidecars.lock.json`。
> - `npm run sync:thunder:local`：复制二进制的同时带上 `--bless`，自动将当前 `thunder` 的版本号、git commit 短哈希和二进制 SHA256 写入 `sidecars.lock.json`。
> - 如果你的 `thunder` 仓库在其他路径，可手动执行：
>   ```bash
>   node scripts/fetch-thunder-binaries.mjs --from-checkout /path/to/your/thunder --bless
>   ```

---

### 4. 场景 C：`thunder` 发布新 GitHub Release 后正式升级版本

当 `thunder` 仓库修改完毕、推送到 GitHub 并发布了新的 Release Tag（例如 `v0.5.0`）后，在 `prototype-edit-llm` 中执行：

```bash
node scripts/fetch-thunder-binaries.mjs \
  --from-release \
  --version 0.5.0 \
  --source https://github.com/lucacicii/thunder/releases/download/v0.5.0 \
  --bless
```

如果还需要同步锁定其他架构（例如在 Mac 上把 `linux-x64` 或 `darwin-x64` 的 SHA256 也写入 `sidecars.lock.json`）：

```bash
node scripts/fetch-thunder-binaries.mjs --from-release --arch darwin-x64 --bless
node scripts/fetch-thunder-binaries.mjs --from-release --arch linux-x64 --bless
```

完成后提交更新后的 `sidecars.lock.json` 即可。

---

## 四、`prototype-edit-llm` 与 `thunder-daemon` 通信协议速查

主进程桥接代码位于：
- `src/main/ipc/thunder-client.ts`（STDIO NDJSON 客户端）
- `src/main/ipc/agent-bridge.ts`（业务编排、探针上下文注入、预览同步）

### 1. 宿主发往 `thunder-daemon` 的核心指令 (`DaemonRequest`)

| Method | 用途 | 关键参数 |
| :--- | :--- | :--- |
| `run_task` | 启动一轮原型生成或修改任务 | `task_id`, `session_id`, `prompt`, `workspace_dir` (`~/.prototype-studio/projects/<id>`), `model_descriptor`, `thinking_level`, `attachments`, `headless: false` |
| `answer_question` | 回复 AI 产品顾问发起的 `ask_user_question` | `question_id`, `answers` (`{ [question]: "选中项" }`), `cancelled` |
| `steer_task` | 在运行中动态追加引导指令或后续队列 | `task_id`, `message`, `behavior` (`"steer"` \| `"follow_up"`) |
| `cancel_task` | 停止当前正在执行的任务 | `task_id` |
| `ping` | 检查 Daemon 存活状态与版本号 | `{}` |

### 2. `thunder-daemon` 推送回宿主的核心事件 (`DaemonResponse`)

| Type | 用途 | 宿主处理逻辑 |
| :--- | :--- | :--- |
| `observed_event` | 细粒度流式事件 (`token_delta`, `reasoning_delta`, `tool_exec_start`, `tool_exec_result`, `turn_end`, `custom:file_change`) | 转发至渲染层 `ChatPanel.tsx` 实时展示流式文本、思考过程与工具调用；遇到 `file_change` 或 `write_file` 完成时立即触发 `ProjectRunner` 同步预览 |
| `user_question` | AI 调用了 `ask_user_question` 并挂起等待用户回答 | 转发至渲染层 `agent:user-question`，在聊天区弹出「AI 产品顾问澄清卡片」，用户提交后调用 `answer_question` 唤醒循环 |
| `task_completed` | 本轮任务正常结束 | 触发最终文件同步、记录版本历史快照（`.prototype-history`）并结束生成状态 |
| `task_failed` | 任务失败或被取消 | 区分 `Cancelled` 与异常报错并反馈至对话面板 |

---

## 五、四个必须知道的坑

### 1. 不要在 `src/main` 的字符串里写「静态 import」

electron-vite 的 `esmShimPlugin` 会在 bundle 命中 `__dirname` / `require(` 时，用正则把 CJS 垫片插在**整个 bundle 里最后一个静态 `import ... from '...'` 之后**。而这个正则扫描的是**包括字符串字面量在内的全部文本** —— 只要主进程源码的某个模板字符串里出现了 `import X from 'y'`（例如内置的 React 骨架代码），垫片就会被插进字符串里，`__dirname` 永远未定义，主进程启动即崩（`ReferenceError: __dirname is not defined`）。

两条规则：
- 主进程需要目录路径时用自算的 `moduleDir = dirname(fileURLToPath(import.meta.url))`（见 `src/main/index.ts`），不要依赖 `__dirname`。
- 模板字符串里尽量不出现裸的 `import ... from '...'`（React 骨架已因此改为依赖自动 JSX 运行时，不再写 `import React`）。

### 2. 一个项目只能有一个入口文件

`techStack` 与 `entryFile` 必须永远一致。若项目目录里同时存在 `index.html` 与 `index.vue`，按「最新修改时间」判定入口会在两者间随机翻转，导致 `native-html` 项目被当成 `.vue` 去服务而 ERR_FAILED。

`ProjectRunner.syncAndResolvePreviewUrl()` 在写入入口前会先删掉同层的其他入口候选，`syncProjectEntryAndStack()` 还会按内容声明校正栈并把内容归一到规范文件名（见 `project-store.ts` 的 `entryFileForStack` / `ENTRY_CANDIDATES`）。新增入口形态请只改这两个常量。

### 3. thunder 的后台调用只认它自己的 `models.json`

我们逐任务传给 daemon 的 `model_descriptor`（含本次要用的模型与 key）只影响**本次任务**。thunder 自己的后台调用 —— 自动命名会话、以后可能的摘要/工具 —— 走的是 thunder 的配置链：`$THUNDER_CONFIG_DIR/models.json`（`thunder-agent-providers/src/source.rs` 的 `ConfigSource::thunder_user`）。这个文件不存在时，thunder 退回内置目录（默认 `openai/gpt-4o`），在本应用里没有 key，于是每次任务结束都刷一条
`WARN Auto title generation failed ... [no_utility_model]`，会话标题也一塌糊涂。

所以 `src/main/agent/thunder-model-config.ts` 会把 app 的模型库镜像写入 `~/.prototype-studio/thunder/models.json`（0600，含明文 key —— thunder 没有 keyring 接口，这也是它只能待在隔离数据根、绝不能落进项目目录的原因），并显式钉住 `utilityModel`。写入时机有两处：`index.ts` 启动时、以及 `agent-bridge` 拉起 daemon 之前（内容不变则跳过写入）。

新增 provider 字段时，记得同时更新 `thunder-model-config.ts` 的映射，否则 thunder 侧会缺字段（例如 `thinkingLevels` 缺失会让它重新联网探测）。

### 4. 停靠在输入框上方的卡片必须自带高度上限

`.pc-chat-root` 是被祖先 `overflow: hidden` 裁掉的定高面板（App.tsx 的 `h-screen` + `overflow-hidden`），里面只有 `.pc-feed` 是滚动区。任何停靠在 `.pc-composer-zone` 里的卡片如果不自带上限，内容一多就会顶穿面板 —— 超出的部分被祖先默默裁掉，**没有任何滚动容器**，底部按钮直接点不到。

`.pc-question-card` 就是这么踩的（5 个问题 × 4 个选项 ≈ 900px 高，而面板只有 ~600px）。两条规则：
- 卡片自己带 `max-height` + `overflow: hidden`，把滚动交给内部列表（`.pc-question-list` 的 `flex: 1 1 auto; min-height: 0; overflow-y: auto`），让标题与操作行钉住；
- `.pc-composer-zone` 要 `flex-shrink: 0`。一旦让它收缩，它就会小于内容高度，而输入框不肯让位，于是输入框溢出到面板外被裁掉。让出空间是卡片的 `max-height` 的事。

注意 `max-height: min-content` 不能当“内容下限”用：作为滚动容器的列表仍按内容高度参与 `min-content` 计算，算出来比 `max-height` 还大，而 `min-height` 优先于 `max-height`，卡片反而不再封顶。需要下限就写明确的像素值（`.pc-question-card` 的 `min-height: 92px`）。

验证这类布局不必靠眼睛：把真实的 `chat.css` 套进一份复刻的 DOM 骨架（`h-screen` + `overflow-hidden` 的祖先、`.pc-feed`、`.pc-composer-zone` + 问题卡 + 输入框），用 headless Chrome 的 `--dump-dom` 读回一个写进 `<pre>` 的 `getBoundingClientRect()` 结果，就能直接判定「确认按钮/输入框是否还在屏幕内、列表是否真的在滚」。同一份骨架把本次的修复逐条注释掉，即可得到“修复前”对照 —— 问题卡会从封顶值变成 1376px，按钮落到 y=1460，一眼就能看出因果。

---

## 六、常用开发与构建命令汇总

```bash
# 启动开发模式（Electron 主进程 + Preload + React 渲染层热更新）
npm run dev

# 清理构建缓存并启动开发模式
npm run dev:clean

# 仅编译主进程、Preload 与渲染层代码（验证 TypeScript 与打包）
npm run build

# 从 GitHub Release 拉取锁定的 thunder 二进制
npm run fetch:thunder

# 从本地 /Users/lucas/wz/GitHub/thunder 同步最新编译的二进制并更新 sidecars.lock.json
npm run sync:thunder:local

# 校验本地 thunder 二进制缓存与 sidecars.lock.json 的 SHA256 是否一致
npm run verify:sidecars

# 准备打包侧车（将二进制与版本溯源戳 thunder-revision.txt 整理到 build/sidecars/）
npm run build:sidecars

# 构建 macOS 未签名解压目录包（用于本地快速验证打包产物）
npm run build:unpack

# 构建正式 macOS .dmg 安装包
npm run build:mac
```
