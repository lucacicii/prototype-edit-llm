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
</script>

<style scoped>
.page-card {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 16px;
}
.filter-wrapper { margin-bottom: 12px; }
.table-wrapper { min-height: 400px; }
</style>