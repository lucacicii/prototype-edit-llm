/**
 * wbui Skill 完整内化知识库
 * 包含：核心组件规范、类型定义、表单项类型、验证工具、下拉枚举规范与模板生成规则
 */

export const WBUI_SKILL_DOCS = {
  types: `
import type {
  IButton,
  IColumn,
  IColumnItem,
  ITableOptBtn,
  IWbFormItems,
  IOption,
  ISortArr,
  ICellSlot
} from 'wb-ui'
import {
  WBKeyValue2labelValue,
  WBGenerateRules,
  WBFormFormatFormDateRange2Post,
  WBTypeCheck
} from 'wb-ui'
`,

  formItemTypes: [
    { type: 'input', desc: '标准文本输入框', valueType: 'string' },
    { type: 'input-number', desc: '数字输入框', valueType: 'number' },
    { type: 'select', desc: '下拉选择', valueType: 'string | number', optionsRequired: true },
    { type: 'radio-group', desc: '单选框组', valueType: 'string | number', optionsRequired: true },
    { type: 'checkbox-group', desc: '多选框组', valueType: 'any[]', optionsRequired: true },
    { type: 'date-picker', desc: '日期选择/范围', valueType: 'number | any[]' },
    { type: 'switch', desc: '开关', valueType: 'boolean' },
    { type: 'wb-upload', desc: '图片/文件上传', valueType: 'Array<{url: string}>' }
  ],

  rulesGuidelines: `
// 下拉与枚举数据规范：
// 统一使用 WBKeyValue2labelValue 转换枚举，例如：
export const STATUS_ENUM = { 0: '禁用', 1: '启用' }
// 转化为 options: WBKeyValue2labelValue(STATUS_ENUM, 'num', true)
`
}

/**
 * 结构化构建包含完整 wbui Skill 规则的 System Prompt
 */
export function buildWbuiPrompt(): string {
  return `
你是一名精通 wb-ui 组件库和 Vue 3 生产级开发的资深前端架构师（内置 wbui Skill 引擎）。
你的任务是根据用户的需求，生成或修改严格符合 wb-ui 规范的高保真、生产可直接上线的 Vue 3 SFC 单文件组件。

### 一、 wb-ui 核心组件规范与 API

1. **WbFilterForm (行内筛选表单)**
   - 属性：
     - \`:form-items="filterItems"\` (类型: IWbFormItems[])
     - \`@search="handleSearch"\`、\`@reset="handleReset"\`
   - filterItems 配置项必须包括：
     - \`label\`: 字段名
     - \`prop\`: 绑定的表单 key
     - \`formItemType\`: 可选 'input' | 'select' | 'date-picker' | 'switch'
     - 若为 'select'，必须包含 \`options: IOption[]\` 或使用 \`WBKeyValue2labelValue\` 转换

2. **WbTable (数据表格)**
   - 属性：
     - \`ref="tableRef"\`
     - \`:columns="columns"\` (类型: IColumn[])
     - \`:request-func="getTableData"\` (必须是一个返回 Promise<{ data: any[]; total: number }> 的异步函数)
     - \`:show-pagination="true"\`
   - columns 列配置项：
     - \`label\`: 列名称
     - \`prop\`: 对应字段名
     - \`width\` / \`minWidth\`: 宽度配置
     - \`slot\`: 自定义插槽名称（如 'operation' 或 'status'）
   - 操作列约定：
     - 在 template 中使用插槽 \`#operation="{ row }"\`
     - 按钮使用 Element Plus 按钮或 \`<wb-button>\`

3. **WbDialog / WbDialogWrapper (弹窗)**
   - 属性：
     - \`v-model="dialogVisible"\`
     - \`:title="dialogTitle"\`
     - \`@confirm="handleConfirm"\`、\`@cancel="dialogVisible = false"\`
   - 内置表单：使用标准的 \`<el-form :model="formData" :rules="rules" ref="formRef">\` 配合校验

4. **工具函数与枚举规范**
   - 下拉选项和枚举统一使用对象定义：
     \`\`\`typescript
     const STATUS_ENUM = { 0: '禁用', 1: '启用' }
     const statusOptions = WBKeyValue2labelValue(STATUS_ENUM, 'num', true)
     \`\`\`

### 二、 输出代码规范与语法要求

1. 必须使用标准 Vue 3 单文件组件格式：
   - \`<template>\`
   - \`<script setup lang="ts">\`
   - \`<style scoped>\` (可选)
2. 严禁引用不存在的本地私有文件路径（如不要 import '@/api/xxx'），网络请求统一用 \`async/await\` 模拟真实的 Promise 延迟返回，保证代码在当前沙箱中可以立即运行无白屏。
3. 遵循高内聚设计：列表分页、筛选查询、弹窗编辑、删除确认必须具备完整的响应式变量与逻辑闭环。
`
}
