const defaultCode = `<template>
  <div class="page-container">
    <wb-filter-form
      ref="formEl"
      v-model="queryForm"
      :form-items="formItems"
      @on-search="handleSearch"
    />

    <wb-table
      ref="tableEl"
      :header-opt="headerOpt"
      :request-func="getTableData"
      :column="column"
      :sort-arr="sortArr"
      :use-pagination="true"
    >
      <template #statusSlot="{ row }">
        <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
          {{ row.status === 'active' ? '正常营业' : '已暂停' }}
        </el-tag>
      </template>
    </wb-table>

    <wb-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      :footer="true"
      @confirm="handleDialogConfirm"
      @cancel="dialogVisible = false"
    >
      <div style="padding: 10px;">
        <p>确认对当前商户执行该操作吗？</p>
      </div>
    </wb-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'

// 1. 筛选条件 (web-ums-password-template 规范)
const queryForm = reactive({
  name: '',
  status: 'all'
})

const formItems = reactive({
  name: {
    label: '商户名称',
    formItemType: 'input',
    placeholder: '请输入商户关键字',
    span: 8
  },
  status: {
    label: '商户状态',
    formItemType: 'radio-button',
    options: [
      { label: '全部', value: 'all' },
      { label: '营业中', value: 'active' },
      { label: '已停业', value: 'inactive' }
    ],
    span: 12
  }
})

// 2. 表格操作栏
const headerOpt = computed(() => {
  return [
    {
      label: '新增商户',
      type: 'primary',
      click: () => {
        dialogTitle.value = '新增商户'
        dialogVisible.value = true
      }
    }
  ]
})

const sortArr = computed(() => {
  return [
    { label: '创建时间', value: 'createTime', default: 'DESC' }
  ]
})

// 3. 表格列配置
const column = [
  { label: '商户编号', name: 'merchantNo', width: '160px' },
  { label: '商户名称', name: 'merchantName', width: '220px' },
  { label: '联系人', name: 'contact', width: '140px' },
  { label: '联系电话', name: 'phone', width: '160px' },
  { label: '状态', name: 'status', width: '120px', slot: 'statusSlot' },
  {
    label: '操作',
    fixed: 'right',
    width: '180px',
    operator: [
      {
        label: '查看详情',
        type: 'primary',
        click: (row: any) => {
          ElMessage.info(\`查看商户: \${row.merchantName}\`)
        }
      },
      {
        label: '状态切换',
        type: 'danger',
        click: (row: any) => {
          dialogTitle.value = \`变更商户状态 (\${row.merchantName})\`
          dialogVisible.value = true
        }
      }
    ]
  }
]

// 4. 数据获取逻辑
function getTableData(params: any) {
  console.log('触发查询参数:', params)
  const mockData = [
    { merchantNo: 'M1001', merchantName: '星巴克烘焙坊', contact: '张店长', phone: '13800000001', status: 'active' },
    { merchantNo: 'M1002', merchantName: '瑞幸咖啡中心店', contact: '李主管', phone: '13800000002', status: 'active' },
    { merchantNo: 'M1003', merchantName: '喜茶万象城店', contact: '王店员', phone: '13800000003', status: 'inactive' },
    { merchantNo: 'M1004', merchantName: '奈雪的茶旗舰店', contact: '赵经理', phone: '13800000004', status: 'active' }
  ]

  return Promise.resolve({
    content: mockData,
    totalElements: mockData.length
  })
}

// 5. 交互与弹窗
const tableEl = ref<any>()
const dialogVisible = ref(false)
const dialogTitle = ref('操作')

function handleSearch(params: any) {
  tableEl.value?.fetchData(params)
}

function handleDialogConfirm() {
  ElMessage.success('操作已执行成功')
  dialogVisible.value = false
}
<\/script>

<style scoped>
.page-container {
  padding: 16px;
  background-color: #fff;
  border-radius: 4px;
}
</style>
`

export default defaultCode
