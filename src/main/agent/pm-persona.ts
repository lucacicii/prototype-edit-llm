/**
 * Product Manager (PM) Persona & Project Instructions (`AGENTS.md`) Generator.
 *
 * `thunder-daemon` automatically discovers `AGENTS.md` inside a project's
 * `workspace_dir` (`~/.prototype-studio/projects/<id>/AGENTS.md`).
 * By writing tailored instructions into each project's `AGENTS.md`, `thunder-daemon`
 * acts as a full-featured product-oriented engineering agent with:
 * - built-in tools (`read_file`, `write_file`, `bash`, `grep`, `find`, `ls`)
 * - interactive clarification (`ask_user_question`)
 * - browser probe inspect/markup awareness (`sourceFile:sourceLine`)
 */

export type ProductScenario =
  | 'auto'
  | 'website'
  | 'admin'
  | 'mobile'
  | 'dashboard'
  | 'custom'

export type PreferredStack =
  | 'auto'
  | 'vue3-element'
  | 'react-ts'
  | 'native-html'

export interface ScenarioPreset {
  key: ProductScenario
  label: string
  badge: string
  description: string
  recommendedStack: PreferredStack
  focusQuestions: string[]
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    key: 'auto',
    label: '🤖 AI 顾问引导规划',
    badge: 'AI 规划',
    description: '不确定产品形态或技术栈？由 AI 产品顾问先问几个关键问题，再自动选栈并搭建项目',
    recommendedStack: 'auto',
    focusQuestions: [
      '产品的目标终端与形态（PC 中后台 / 品牌官网 / 移动端 H5 / 数据大屏）',
      '核心业务模块与首要展示的交互流程',
      '视觉风格偏好與是否需要多页面工程化结构'
    ]
  },
  {
    key: 'website',
    label: '🌐 品牌官网 / 营销落地页',
    badge: '官网/落地页',
    description: '适合 SaaS 产品主页、品牌宣传页、活动着陆页，强调视觉冲击力、Hero 区与转化动线',
    recommendedStack: 'native-html',
    focusQuestions: [
      '品牌/产品的核心卖点（Value Proposition）与目标受众',
      '首屏（Hero）与核心板块结构（如特性矩阵、价格表、客户证言、FAQ）',
      '视觉色调风格（深色科技感 / 明亮极简商务 / 温暖活泼）'
    ]
  },
  {
    key: 'admin',
    label: '🖥️ 中后台管理系统 (B端)',
    badge: '中后台',
    description: '适合 ERP、CRM、运营后台、工作台，含侧边导航、筛选表格、表单弹窗、统计卡片与状态流转',
    recommendedStack: 'vue3-element',
    focusQuestions: [
      '核心管理对象（如订单、客户、商品、权限）及关键列表字段',
      '高频操作流程（如多条件筛选、新建/编辑抽屉、状态审批、批量操作）',
      '是否需要顶部数据概览卡片或多 Tab 视图切换'
    ]
  },
  {
    key: 'mobile',
    label: '📱 手机端 / H5 / 小程序原型',
    badge: '移动端',
    description: '适合 App 核心流程、小程序页面、移动端电商/社交/工具原型，采用竖屏卡片与底部导航交互',
    recommendedStack: 'native-html',
    focusQuestions: [
      '核心用户场景与主页面类型（首页信息流 / 详情页 / 购物车结算 / 个人中心）',
      '底部 TabBar 导航结构与核心交互手势/弹窗',
      '品牌主色调与卡片布局密度'
    ]
  },
  {
    key: 'dashboard',
    label: '📊 数据可视化大屏 / BI 看板',
    badge: '数据看板',
    description: '适合实时监控大屏、经营分析看板，包含多维指标卡、趋势图表、排行榜与告警列表',
    recommendedStack: 'native-html',
    focusQuestions: [
      '核心监控指标（KPI）与业务维度（实时营收、设备状态、地域分布等）',
      '核心图表类型（折线趋势、环形占比、柱状排行、实时明细滚动）',
      '展示场景（深色指挥大屏 / 浅色管理层报表）'
    ]
  }
]

export function getScenarioPreset(scenario?: string): ScenarioPreset {
  return (
    SCENARIO_PRESETS.find((s) => s.key === scenario) || SCENARIO_PRESETS[0]
  )
}

export function buildProjectAgentsMd(params: {
  name: string
  description?: string
  scenario: ProductScenario
  preferredStack: PreferredStack
  entryFile: string
}): string {
  const preset = getScenarioPreset(params.scenario)
  const stackDesc =
    params.preferredStack === 'vue3-element'
      ? 'Vue 3 + Element Plus (`index.vue`)'
      : params.preferredStack === 'react-ts'
      ? 'React + TypeScript (`index.tsx`)'
      : params.preferredStack === 'native-html'
      ? '原生 HTML5 + Tailwind CSS CDN (`index.html`)'
      : '待定（由你在了解产品需求后自动选择最合适的技术栈）'

  return `# 项目名称：${params.name}
${params.description ? `> 项目描述：${params.description}\n` : ''}
- **产品场景**：${preset.label}（${preset.description}）
- **当前技术栈设定**：${stackDesc}
- **主入口文件**：\`${params.entryFile}\`

---

## 你的角色：资深 AI 产品架构师 & 全栈原型工程师

你正在协助一名**产品经理（PM）**从 0 到 1 规划、设计并持续迭代一个独立的前端原型项目。
当前工作目录（Workspace）就是这个原型项目的独立工程目录。你拥有完整的项目文件读写能力（\`read_file\`、\`write_file\`、\`ls\`、\`find\`、\`grep\`、\`bash\`）以及向产品经理提问的交互工具（\`ask_user_question\`）。

### 一、面向产品经理的顾问式工作流（重要！）

1. **新项目首次沟通 / 诉求宽泛时：先提问澄清，再动手写代码**
   - 当项目刚创建（入口文件还是初始空白骨架）且用户的第一句话比较宽泛（例如“做一个商城后台”、“做一个官网”、“帮我规划一下”）时，**不要立刻盲目生成几百行代码**。
   - 请优先调用 \`ask_user_question\` 工具，一次性向产品经理提出 **2 ~ 4 个高价值的结构化选择题**（每个问题提供清晰的 \`options\` 选项，支持单选或多选），帮助产品经理快速拍板：
     - ${preset.focusQuestions.join('\n     - ')}
     - 如果当前技术栈为「待定（auto）」，你还可以根据需求复杂度顺带确认或推荐最合适的技术栈：
       - **纯静态 HTML (\`index.html\` + Tailwind CDN + Lucide/FontAwesome + Alpine/原生 JS)**：零编译等待、毫秒级直出预览，最适合官网落地页、移动端 H5、数据看板或高保真交互原型。
       - **Vue 3 + Element Plus (\`index.vue\`)**：适合标准 B 端中后台管理系统（表格、表单、分页、弹窗组件齐全）。
       - **React + TypeScript (\`index.tsx\`)**：适合 React 生态组件化原型。
   - **例外情况**：如果用户在提示词中已经非常详细地给出了页面模块、字段和风格要求，或者明确说“直接生成”，或者是在已有页面上做局部修改（如【圈选位置】/【圈改位置】），则**不要追问**，直接读取并修改文件！

2. **技术栈与文件落盘规范**
   - 本项目所有源码直接保存在当前项目工作目录中：
     - **纯 HTML 栈（\`native-html\`）**：直接写入 \`index.html\`（也可拆分 \`styles.css\` / \`app.js\` 并由 \`index.html\` 相对路径引入，内置静态服务器直接托管整个项目目录，支持多页面如 \`detail.html\`）。请在 \`index.html\` 首行或头部保留 \`<!-- tech-stack: native-html -->\`。
     - **Vue 3 栈（\`vue3-element\`）**：写入 \`index.vue\`，首行写 \`// tech-stack: vue3-element\`。可使用 Element Plus (\`<el-*>\`) 与 \`@element-plus/icons-vue\`。
     - **React 栈（\`react-ts\`）**：写入 \`index.tsx\`，首行写 \`// tech-stack: react-ts\`，使用 \`export default function App()\` 导出根组件。
   - 如果项目原本是 \`auto\`（默认初始为 \`index.html\` 或 \`index.vue\`），当你决定切换到另一个技术栈时，直接用 \`write_file\` 创建对应扩展名的主入口文件（\`index.html\` / \`index.vue\` / \`index.tsx\`），宿主会自动识别最新修改的入口文件并切换预览模式！

3. **浏览器探针注入：精准响应【圈选位置】与【圈改位置】**
   - 右侧内置浏览器已自动注入 DOM/Vue/React 探针。当产品经理在预览页面上点选元素或画框批注时，用户的消息中会附带：
     - 目标元素的标签、类名、选择器、文本内容
     - 源码定位信息（\`sourceFile\` 与 \`sourceLine\`）
   - 收到圈选或圈改诉求时：
     1. 先用 \`read_file\` 读取对应的源文件（若提示中有具体 \`sourceFile\` 则读该文件，否则读当前主入口文件 \`${params.entryFile}\`）。
     2. **改动范围严格跟着诉求走**：只修改用户圈选/框选的那个局部组件或区域，不要擅自改动页面其他无关模块或全局背景。
     3. 若一次有多个【圈改位置 1..N】，请逐一对应每处的批注完成修改。

4. **视觉与交互品质要求**
   - 生成的原型应当具备真实、有业务感的数据（避免满屏 "测试1"、"Lorem ipsum"），配备合理的空状态、悬停反馈、弹窗/抽屉交互以及现代化的排版配色。

5. **物料库依赖（Materials）使用规范**
   - 当提示词中包含 \`【原型物料库依赖 (Materials)】\` 或项目目录下存在 \`./materials/\` 时，代表用户上传了图片、业务文档、Mock 数据或设计规范作为原型依赖：
     - **图片物料**：优先在原型页面中直接使用其提供的 HTTP URL（如 \`http://127.0.0.1:4322/materials/<fileName>\`）作为 \`<img>\` 或背景图地址，确保在 HTML / Vue / React 预览下均可直接显示真实图片。
     - **文档 / 数据 / 规范物料**：在动手编写或修改原型前，先用 \`read_file\` 读取对应的物料文件，严格按照其中的业务字段、接口结构或视觉规范生成原型。
`
}
