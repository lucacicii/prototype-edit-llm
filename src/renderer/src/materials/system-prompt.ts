import type { InspectTarget } from '../utils/inspector'
import { buildWbuiPrompt } from './wb-ui-skill'

/**
 * 生产级业务页面标准 System Prompt (已完整内化 wbui Skill 规则)
 * 采用 Vue 3 + TypeScript + wb-ui + Element Plus 标准代码骨架
 */
export const WBUI_PROTOTYPE_SYSTEM_PROMPT = `${buildWbuiPrompt()}

【页面架构组织规范】
1. 整体三段式经典结构：
   - 顶部筛选栏：统一使用 <wb-filter-form ref="filterFormRef" :form-items="filterItems" @search="handleSearch" @reset="handleReset" />
   - 主体表格：统一使用 <wb-table ref="tableRef" :columns="columns" :request-func="getTableData" :show-pagination="true" />
   - 操作与业务弹窗：统一使用 <wb-dialog v-model="dialogVisible" :title="dialogTitle" @confirm="handleConfirm">
2. 表格数据请求函数规范 (getTableData)：
   - 必须是一个 Promise 异步函数，接收 { pageNum: number, pageSize: number, ...filterParams }。
   - 必须 resolve 返回标准格式：{ data: Array<any>, total: number }。在原型阶段，可以在函数内部构造 3~10 条逼真的模拟业务数据并直接 Promise.resolve 返回。
3. 表格列配置 (columns: IColumn[])：
   - 每列定义包含 prop, label, width/minWidth, align 等。
   - 状态列、字典列优先通过 #customSlot 或在 template 中使用插槽处理。
   - 操作列统一使用插槽 slot: 'operation'，并在 template 中使用 #operation="{ row }"，内放 <wb-button type="link"> 或 ElButton。
4. 筛选项配置 (filterItems: IWbFormItems[])：
   - 每一项包含：formItemType ('input' | 'select' | 'date-picker' | 'switch'), label, prop, placeholder, options 等。
5. 必须保持标准的 setup 组合式 API 语法：
   - 禁止在代码中 import 任何外部不存在的私有模块。
   - 当前沙箱全局已注册：Vue 核心 API、ElementPlus 全部组件、wb-ui 组件 (<wb-table>, <wb-filter-form>, <wb-dialog>, <wb-button> 等)。

【代码输出格式要求】
只输出标准的单个 \`\`\`vue ... \`\`\` 代码块，包含完整的 <template> 与 <script setup lang="ts">，不废话，不要输出代码外的多余文字。
`

/**
 * 通用初始示例页面代码 (采用经典的中立业务：客户/商户综合管理)
 */
export const INITIAL_GENERAL_PAGE_CODE = `<template>
  <div class="p-4 space-y-4 bg-gray-50 min-h-full">
    <!-- 1. 顶部检索区域 -->
    <div class="bg-white p-4 rounded-md shadow-sm border border-gray-100">
      <wb-filter-form
        ref="filterFormRef"
        :form-items="filterItems"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <!-- 2. 主体数据表格与操作栏 -->
    <div class="bg-white p-4 rounded-md shadow-sm border border-gray-100">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center space-x-2">
          <wb-button type="primary" @click="handleCreate">
            + 新增客户
          </wb-button>
          <wb-button @click="handleBatchExport">
            批量导出
          </wb-button>
        </div>
        <div class="text-xs text-gray-500">
          共 {{ totalCount }} 条记录
        </div>
      </div>

      <wb-table
        ref="tableRef"
        :columns="columns"
        :request-func="getTableData"
        :show-pagination="true"
        border
      >
        <!-- 自定义状态列 -->
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : row.status === 0 ? 'warning' : 'danger'" size="small">
            {{ row.status === 1 ? '正常合作' : row.status === 0 ? '审核中' : '已冻结' }}
          </el-tag>
        </template>

        <!-- 表格操作列 -->
        <template #operation="{ row }">
          <wb-button type="link" size="small" @click="handleEdit(row)">编辑</wb-button>
          <wb-button type="link" size="small" @click="handleToggleStatus(row)">
            {{ row.status === 1 ? '冻结' : '启用' }}
          </wb-button>
          <wb-button type="link" size="small" class="!text-red-500" @click="handleDelete(row)">删除</wb-button>
        </template>
      </wb-table>
    </div>

    <!-- 3. 新增/编辑客户弹窗 -->
    <wb-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="540px"
      @confirm="handleSubmitForm"
    >
      <el-form :model="formData" label-width="90px" class="py-2">
        <el-form-item label="客户名称" required>
          <el-input v-model="formData.name" placeholder="请输入客户企业全称" />
        </el-form-item>
        <el-form-item label="客户类型" required>
          <el-select v-model="formData.type" placeholder="请选择类型" class="w-full">
            <el-option label="重点企业" value="VIP" />
            <el-option label="普通商户" value="NORMAL" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="formData.phone" placeholder="请输入手机或座机" />
        </el-form-item>
        <el-form-item label="详细经营地址">
          <el-input v-model="formData.address" placeholder="选填" />
        </el-form-item>
      </el-form>
    </wb-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const totalCount = ref(3)
const tableRef = ref()
const dialogVisible = ref(false)
const dialogTitle = ref('新增客户')

const formData = reactive({
  name: '',
  type: 'NORMAL',
  phone: '',
  address: ''
})

// 筛选表单配置
const filterItems = [
  {
    label: '客户名称',
    prop: 'name',
    formItemType: 'input',
    placeholder: '输入名称关键字'
  },
  {
    label: '合作状态',
    prop: 'status',
    formItemType: 'select',
    placeholder: '选择状态',
    options: [
      { label: '正常合作', value: 1 },
      { label: '审核中', value: 0 },
      { label: '已冻结', value: -1 }
    ]
  }
]

// 表格列配置
const columns = [
  { prop: 'code', label: '客户编号', width: '130px' },
  { prop: 'name', label: '客户名称', minWidth: '180px' },
  { prop: 'type', label: '类型', width: '120px' },
  { prop: 'status', label: '合作状态', width: '120px', slot: 'status' },
  { prop: 'createdAt', label: '建档时间', width: '160px' },
  { prop: 'operation', label: '操作', width: '190px', fixed: 'right', slot: 'operation' }
]

const getTableData = async (params: any) => {
  return Promise.resolve({
    data: [
      { id: 1, code: 'CUST-202401', name: '山东华源供应链管理有限公司', type: '重点企业', status: 1, createdAt: '2024-03-01 10:20' },
      { id: 2, code: 'CUST-202402', name: '青岛联合物流技术服务部', type: '普通商户', status: 0, createdAt: '2024-03-05 14:12' },
      { id: 3, code: 'CUST-202403', name: '济南齐鲁智运科技有限公司', type: '普通商户', status: -1, createdAt: '2024-03-08 09:30' }
    ],
    total: 3
  })
}

const handleSearch = () => {
  tableRef.value?.refresh?.()
}

const handleReset = () => {
  tableRef.value?.refresh?.()
}

const handleCreate = () => {
  dialogTitle.value = '新增客户'
  formData.name = ''
  formData.type = 'NORMAL'
  formData.phone = ''
  formData.address = ''
  dialogVisible.value = true
}

const handleEdit = (row: any) => {
  dialogTitle.value = '编辑客户'
  formData.name = row.name
  formData.type = row.type === '重点企业' ? 'VIP' : 'NORMAL'
  dialogVisible.value = true
}

const handleToggleStatus = (row: any) => {
  row.status = row.status === 1 ? -1 : 1
  ElMessage.success('状态变更成功')
}

const handleDelete = (row: any) => {
  ElMessageBox.confirm('确认删除客户【' + row.name + '】吗？', '警告', { type: 'warning' })
    .then(() => {
      ElMessage.success('删除成功')
    })
    .catch(() => {})
}

const handleBatchExport = () => {
  ElMessage.info('已触发导出')
}

const handleSubmitForm = () => {
  ElMessage.success('保存成功')
  dialogVisible.value = false
}
</script>
`

/**
 * 构造多轮迭代与增量修改 (Diff / Edit) 的 Prompt
 */
export function buildIterativePrompt(params: {
  currentCode: string
  userInstruction: string
  history?: Array<{ role: string; content: string }>
  inspectTarget?: InspectTarget | null
}): string {
  const { currentCode, userInstruction, inspectTarget } = params

  let inspectPromptBlock = ''
  if (inspectTarget) {
    const locInfo = inspectTarget.sourceFile
      ? `\n- 源文件路径: ${inspectTarget.sourceFile}${inspectTarget.sourceLine ? ` (第 ${inspectTarget.sourceLine} 行)` : ''}`
      : ''
    const fwInfo = inspectTarget.framework ? `\n- 所属框架: ${inspectTarget.framework}` : ''

    inspectPromptBlock = `
【🎯 关键圈选定位信息 (用户在页面上圈选了以下具体元素)】
- 圈选组件类型: <${inspectTarget.componentName || inspectTarget.tagName.toLowerCase()}>${fwInfo}${locInfo}
- 界面可视文本: "${inspectTarget.innerText || inspectTarget.text || '无'}"
- 选择器层级: ${inspectTarget.selector || '无'}
- 预估对应源码行号: 第 ${inspectTarget.lineNumber || inspectTarget.sourceLine || '未知'} 行附近
- 匹配到的源码/DOM片段:
\`\`\`vue
${inspectTarget.codeSnippet || inspectTarget.outerHTMLSnippet || ''}
\`\`\`
注意：用户此轮的修改诉求【极大概率是针对该圈选区域或其对应的数据项/列/表单】进行的，请重点分析并精确定位此位置！
`
  }

  return `
你是一名资深的前端代码重构专家（深度掌握 wbui 组件库规范）。
请根据用户的增量修改要求，对现有的 Vue 3 单文件组件进行精准修改。

【当前运行的代码】
\`\`\`vue
${currentCode}
\`\`\`

${inspectPromptBlock}

【用户的修改要求】
${userInstruction}

【修改与生成准则 (基于 wbui Skill)】
1. 精准理解用户的增量意图，严禁随意删除或破坏未提及的既有业务逻辑、表格列或已有表单。
2. 保持 Vue 3 Composition API (<script setup lang="ts">) 的代码结构风格。
3. 如果是添加/修改筛选项，确保在 \`filterItems\` 数组及对应 \`<wb-filter-form>\` 中生效（使用正确的 formItemType: input/select/date-picker 等）。
4. 如果是添加/修改表格列，确保在 \`columns\` 数组中补全定义，并在 \`<template>\` 中补充必要的自定义插槽（如 #operation 或字典项）。
5. 如果涉及弹窗，使用 \`<wb-dialog>\` 包装。
6. 严格只输出完整修改后的单一 \`\`\`vue ... \`\`\` 代码块，不要包含任何额外的解析文字。
`
}
