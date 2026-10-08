import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PrototypeItem {
  id: string
  name: string
  description: string
  vueCode: string
  chatMessages: {
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    inspectContext?: {
      tagName: string
      text?: string
    }
  }[]
  updatedAt: number
}

const DEFAULT_MERCHANT_CODE = `<template>
  <div class="page-card">
    <div class="filter-wrapper">
      <wb-filter-form
        ref="filterFormRef"
        :form-items="filterItems"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="table-wrapper">
      <wb-table
        ref="tableRef"
        :columns="columns"
        :request-func="getTableData"
        :show-pagination="true"
      >
        <template #tableTopOpt>
          <wb-button type="primary" @click="handleCreate">
            <el-icon style="margin-right: 4px;"><Plus /></el-icon>
            新增商户
          </wb-button>
          <wb-button plain @click="handleExport">批量导出</wb-button>
        </template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'">
            {{ row.status === 1 ? '正常合作' : '已冻结' }}
          </el-tag>
        </template>

        <template #operation="{ row }">
          <el-button link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button link :type="row.status === 1 ? 'danger' : 'success'" size="small" @click="handleToggleStatus(row)">
            {{ row.status === 1 ? '冻结' : '解冻' }}
          </el-button>
        </template>
      </wb-table>
    </div>

    <wb-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑商户' : '新增商户'"
      width="560px"
      @confirm="handleSubmit"
    >
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px" style="padding-top: 10px;">
        <el-form-item label="商户名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入商户全称" />
        </el-form-item>
        <el-form-item label="联系电话" prop="phone">
          <el-input v-model="formData.phone" placeholder="请输入联系电话" />
        </el-form-item>
        <el-form-item label="商户类型" prop="type">
          <el-select v-model="formData.type" placeholder="请选择" style="width: 100%;">
            <el-option label="核心直供商" value="DIRECT" />
            <el-option label="渠道分销商" value="CHANNEL" />
          </el-select>
        </el-form-item>
        <el-form-item label="合作状态" prop="status">
          <el-radio-group v-model="formData.status">
            <el-radio :label="1">正常合作</el-radio>
            <el-radio :label="0">暂时冻结</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </wb-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const filterFormRef = ref()
const tableRef = ref()
const formRef = ref()

const dialogVisible = ref(false)
const isEdit = ref(false)

const filterItems = ref([
  { formItemType: 'input', label: '商户名称', prop: 'name', placeholder: '搜索商户名称' },
  {
    formItemType: 'select',
    label: '合作状态',
    prop: 'status',
    options: [
      { label: '正常合作', value: 1 },
      { label: '已冻结', value: 0 }
    ]
  }
])

const columns = ref([
  { prop: 'id', label: '商户编号', width: '120px' },
  { prop: 'name', label: '商户全称', minWidth: '180px' },
  { prop: 'type', label: '商户类型', width: '130px' },
  { prop: 'phone', label: '联系人电话', width: '140px' },
  { prop: 'status', label: '合作状态', width: '110px', slotName: 'status' },
  { prop: 'createdAt', label: '创建时间', width: '160px' },
  { label: '操作', width: '140px', fixed: 'right', slotName: 'operation' }
])

const formData = reactive({
  id: '',
  name: '',
  phone: '',
  type: 'DIRECT',
  status: 1
})

const rules = {
  name: [{ required: true, message: '请输入商户全称', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }]
}

function getTableData() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        data: [
          { id: 'M-1001', name: '山东华信实业有限公司', type: '核心直供商', phone: '13800138000', status: 1, createdAt: '2025-01-15' },
          { id: 'M-1002', name: '济南卓越供应链管理部', type: '渠道分销商', phone: '13911223344', status: 1, createdAt: '2025-02-01' },
          { id: 'M-1003', name: '青岛海运恒达贸易', type: '核心直供商', phone: '13788990011', status: 0, createdAt: '2025-02-18' }
        ],
        total: 3
      })
    }, 150)
  })
}

function handleSearch() {
  tableRef.value?.fetchData?.()
}

function handleReset() {
  tableRef.value?.fetchData?.()
}

function handleCreate() {
  isEdit.value = false
  formData.id = ''
  formData.name = ''
  formData.phone = ''
  formData.type = 'DIRECT'
  formData.status = 1
  dialogVisible.value = true
}

function handleEdit(row: any) {
  isEdit.value = true
  Object.assign(formData, row)
  dialogVisible.value = true
}

function handleToggleStatus(row: any) {
  const targetText = row.status === 1 ? '冻结' : '恢复'
  ElMessageBox.confirm(\`确定要\${targetText}商户【\${row.name}】吗？\`, '状态提示', {
    type: 'warning'
  }).then(() => {
    row.status = row.status === 1 ? 0 : 1
    ElMessage.success(\`商户已成功\${targetText}\`)
  })
}

function handleExport() {
  ElMessage.info('触发数据批量导出')
}

function handleSubmit() {
  formRef.value?.validate((valid: boolean) => {
    if (valid) {
      ElMessage.success(isEdit.value ? '修改成功' : '新增商户成功')
      dialogVisible.value = false
      tableRef.value?.fetchData?.()
    }
  })
}
<\/script>

<style scoped>
.page-card {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.filter-wrapper {
  margin-bottom: 12px;
}
.table-wrapper {
  min-height: 400px;
}
</style>`

const DEFAULT_MATERIAL_CODE = `<template>
  <div class="page-card">
    <div class="filter-wrapper">
      <wb-filter-form
        ref="filterFormRef"
        :form-items="filterItems"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="table-wrapper">
      <wb-table
        ref="tableRef"
        :columns="columns"
        :request-func="getTableData"
        :show-pagination="true"
      >
        <template #tableTopOpt>
          <wb-button type="primary" @click="handleCreate">
            <el-icon style="margin-right: 4px;"><Plus /></el-icon>
            新建物料项
          </wb-button>
          <wb-button plain @click="handleExport">导出台账</wb-button>
        </template>

        <template #stock="{ row }">
          <span :style="{ color: row.stock < 10 ? '#ef4444' : '#10b981', fontWeight: 600 }">
            {{ row.stock }} {{ row.unit }}
          </span>
        </template>

        <template #operation="{ row }">
          <el-button link type="primary" size="small" @click="handleEdit(row)">调整库存</el-button>
        </template>
      </wb-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const filterFormRef = ref()
const tableRef = ref()

const filterItems = ref([
  { formItemType: 'input', label: '物料名称', prop: 'name', placeholder: '搜索物料品名/编码' }
])

const columns = ref([
  { prop: 'sku', label: '物料编码', width: '130px' },
  { prop: 'name', label: '物料品名', minWidth: '180px' },
  { prop: 'stock', label: '现存库存', width: '130px', slotName: 'stock' },
  { label: '操作', width: '120px', fixed: 'right', slotName: 'operation' }
])

function getTableData() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        data: [
          { sku: 'SKU-001', name: '冷轧板 (SPCC 1.2mm)', stock: 120, unit: '吨' },
          { sku: 'SKU-002', name: '镀锌卷板 (DX51D 0.8mm)', stock: 8, unit: '吨' }
        ],
        total: 2
      })
    }, 150)
  })
}

function handleSearch() { tableRef.value?.fetchData?.() }
function handleReset() { tableRef.value?.fetchData?.() }
function handleCreate() { ElMessage.info('新建物料') }
function handleEdit(row: any) { ElMessage.info('调整库存: ' + row.sku) }
function handleExport() { ElMessage.info('导出台账') }
<\/script>

<style scoped>
.page-card {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 16px;
}
.filter-wrapper { margin-bottom: 12px; }
.table-wrapper { min-height: 400px; }
</style>`

export const usePrototypeStore = defineStore('prototypes', () => {
  const activeId = ref<string>('merchant-mgmt')

  const prototypes = ref<PrototypeItem[]>([
    {
      id: 'merchant-mgmt',
      name: '客户与商户管理',
      description: '标准企业级商户管理，包含动态筛选项、WbTable 操作列与 WbDialog 弹窗',
      vueCode: DEFAULT_MERCHANT_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: '已加载【客户与商户管理】真实工程页面。你可以使用顶部“🎯 圈画编辑”选择元素并提出修改意见。',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    },
    {
      id: 'material-mgmt',
      name: '企业商品与物料管理',
      description: '商品台账盘点、分类过滤与库存警报展示',
      vueCode: DEFAULT_MATERIAL_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: '已加载【企业商品与物料管理】原型页面。',
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
  ])

  const currentPrototype = computed(() => {
    return prototypes.value.find((p) => p.id === activeId.value) || prototypes.value[0]
  })

  function setActive(id: string) {
    activeId.value = id
  }

  function createPrototype(name: string, description: string): PrototypeItem {
    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name,
      description,
      vueCode: DEFAULT_MERCHANT_CODE,
      chatMessages: [
        {
          role: 'assistant',
          content: `原型【${name}】已创建！现在可以在左侧描述你的需求或从右侧圈画。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function clonePrototype(sourceId: string): PrototypeItem | null {
    const source = prototypes.value.find((p) => p.id === sourceId)
    if (!source) return null

    const id = `proto-${Date.now().toString(36)}`
    const newItem: PrototypeItem = {
      id,
      name: `${source.name} (副本)`,
      description: source.description,
      vueCode: source.vueCode,
      chatMessages: [
        {
          role: 'assistant',
          content: `已从【${source.name}】复制新原型副本。`,
          timestamp: Date.now()
        }
      ],
      updatedAt: Date.now()
    }
    prototypes.value.unshift(newItem)
    activeId.value = id
    return newItem
  }

  function deletePrototype(id: string) {
    if (prototypes.value.length <= 1) return
    const index = prototypes.value.findIndex((p) => p.id === id)
    if (index > -1) {
      prototypes.value.splice(index, 1)
      if (activeId.value === id) {
        activeId.value = prototypes.value[0].id
      }
    }
  }

  function updateCode(id: string, code: string) {
    const p = prototypes.value.find((item) => item.id === id)
    if (p) {
      p.vueCode = code
      p.updatedAt = Date.now()
    }
  }

  return {
    prototypes,
    activeId,
    currentPrototype,
    setActive,
    createPrototype,
    clonePrototype,
    deletePrototype,
    updateCode
  }
})
