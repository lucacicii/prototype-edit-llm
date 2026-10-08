<template>
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
  ElMessageBox.confirm(`确定要${targetText}商户【${row.name}】吗？`, '状态提示', {
    type: 'warning'
  }).then(() => {
    row.status = row.status === 1 ? 0 : 1
    ElMessage.success(`商户已成功${targetText}`)
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
</script>

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
</style>