<template>
  <aside class="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 select-none">
    <!-- 1. 工作区切换与项目导入顶栏 -->
    <div class="p-2.5 border-b border-slate-800 bg-slate-900/60 flex flex-col gap-2 shrink-0">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <span>📁</span>
          <span>工作空间</span>
        </span>
        <el-dropdown trigger="click" @command="handleImportCommand">
          <button class="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium flex items-center gap-1 transition shadow">
            <span>+ 导入</span>
            <span class="text-[9px]">▼</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="directory">
                📂 导入本地工程目录...
              </el-dropdown-item>
              <el-dropdown-item command="url">
                🔗 导入现有服务 URL...
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- 工作区选择器 -->
      <select
        v-model="activeWorkspaceId"
        @change="handleSwitchWorkspace"
        class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none hover:border-slate-600 cursor-pointer"
      >
        <option
          v-for="ws in workspaces"
          :key="ws.id"
          :value="ws.id"
        >
          {{ ws.name }} ({{ getFrameworkBadge(ws.framework) }})
        </option>
      </select>
    </div>

    <!-- 2. 原型方案列表 (当前处于内置原型工程时展现) -->
    <template v-if="isDefaultWorkspace">
      <div class="h-10 px-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/30">
        <div class="flex items-center space-x-1.5">
          <span class="text-[11px] font-semibold text-slate-300">原型方案列表</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
            {{ prototypes.length }}
          </span>
        </div>
        <button
          class="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium flex items-center space-x-1 shadow transition-colors"
          @click="showCreateModal = true"
        >
          <span>+ 新建方案</span>
        </button>
      </div>

      <!-- 列表展示 -->
      <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
        <div
          v-for="item in prototypes"
          :key="item.id"
          class="p-2.5 rounded-lg border text-xs cursor-pointer transition-all group relative"
          :class="activeId === item.id 
            ? 'bg-indigo-950/70 border-indigo-500/80 shadow-md text-white' 
            : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700 text-slate-300'"
          @click="emit('select', item.id)"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold truncate max-w-[140px] text-xs">
              {{ item.name }}
            </span>
            <span class="text-[10px] text-slate-500 font-mono">
              {{ formatTime(item.updatedAt) }}
            </span>
          </div>

          <p class="text-[11px] text-slate-400 line-clamp-1 mb-2">
            {{ item.description || '暂无描述' }}
          </p>

          <!-- 底部快捷操作 -->
          <div class="flex items-center justify-between pt-1 border-t border-slate-800/50 text-[10px] text-slate-500">
            <span>{{ item.vueCode ? item.vueCode.split('\n').length : 0 }} 行代码</span>
            <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                class="text-indigo-400 hover:text-indigo-300"
                title="复制副本"
                @click.stop="emit('clone', item)"
              >
                复制
              </button>
              <button
                v-if="prototypes.length > 1"
                class="text-rose-400 hover:text-rose-300"
                title="删除"
                @click.stop="emit('delete', item.id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 3. 外部工程工作区信息展示 -->
    <template v-else>
      <div class="flex-1 overflow-y-auto p-3 text-xs space-y-3">
        <div class="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
          <div class="font-semibold text-sky-400 flex items-center justify-between">
            <span>{{ currentWorkspace?.name }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 font-mono">
              {{ currentWorkspace?.framework }}
            </span>
          </div>
          <div class="text-[11px] text-slate-400 break-all font-mono">
            {{ currentWorkspace?.rootPath || currentWorkspace?.url }}
          </div>
          <div v-if="currentWorkspace?.uiLibrary" class="text-[11px] text-emerald-400">
            组件库: {{ currentWorkspace.uiLibrary }}
          </div>
        </div>

        <div class="p-2.5 rounded border border-slate-800 bg-slate-900/40 text-[11px] text-slate-400 leading-relaxed">
          💡 <b class="text-slate-300">通用圈选与逆向就绪:</b>
          在右侧内置浏览器中打开该项目的任何页面，点击顶部“🎯 圈选”或“✏️ 圈改”，探针即可自动提取真实的框架组件、层级及源码位置！
        </div>
      </div>
    </template>

    <!-- 新建原型模态框 -->
    <el-dialog
      v-model="showCreateModal"
      title="新建原型页面"
      width="420px"
      append-to-body
    >
      <el-form label-position="top" class="mt-2">
        <el-form-item label="原型名称" required>
          <el-input
            v-model="newForm.name"
            placeholder="如：订单履约中心 / 财务结算审批"
            maxlength="20"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="原型简要描述">
          <el-input
            v-model="newForm.description"
            type="textarea"
            rows="2"
            placeholder="描述该原型的核心业务诉求与关键组件"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showCreateModal = false">取消</el-button>
          <el-button type="primary" :disabled="!newForm.name.trim()" @click="handleCreate">确定创建</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 导入 URL 模态框 -->
    <el-dialog
      v-model="showUrlImportModal"
      title="导入现有服务 / 网页 URL"
      width="420px"
      append-to-body
    >
      <el-form label-position="top" class="mt-2">
        <el-form-item label="项目或系统名称">
          <el-input
            v-model="urlForm.name"
            placeholder="如：商户后台本地开发服务 / 线上管理系统"
          />
        </el-form-item>
        <el-form-item label="服务访问 URL" required>
          <el-input
            v-model="urlForm.url"
            placeholder="如：http://localhost:3000 或 https://example.com"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showUrlImportModal = false">取消</el-button>
          <el-button type="primary" :disabled="!urlForm.url.trim()" @click="handleConfirmImportUrl">确定导入</el-button>
        </span>
      </template>
    </el-dialog>
  </aside>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PrototypeItem } from '../stores/prototypeStore'

defineProps<{
  prototypes: PrototypeItem[]
  activeId: string
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create', data: { name: string; description: string }): void
  (e: 'clone', item: PrototypeItem): void
  (e: 'delete', id: string): void
  (e: 'workspace-changed', ws: any): void
}>()

const showCreateModal = ref(false)
const showUrlImportModal = ref(false)
const activeWorkspaceId = ref('default-host')
const workspaces = ref<any[]>([])

const newForm = reactive({
  name: '',
  description: ''
})

const urlForm = reactive({
  name: '',
  url: ''
})

const currentWorkspace = computed(() => {
  return workspaces.value.find((w) => w.id === activeWorkspaceId.value) || workspaces.value[0]
})

const isDefaultWorkspace = computed(() => {
  return activeWorkspaceId.value === 'default-host'
})

onMounted(async () => {
  await loadWorkspaces()
})

async function loadWorkspaces() {
  if (window.project?.listWorkspaces) {
    workspaces.value = await window.project.listWorkspaces()
    const cur = await window.project.getCurrentWorkspace()
    if (cur) activeWorkspaceId.value = cur.id
  }
}

function getFrameworkBadge(fw: string) {
  if (fw === 'vue3') return 'Vue 3'
  if (fw === 'vue2') return 'Vue 2'
  if (fw === 'react') return 'React'
  if (fw === 'native-dom') return 'Web'
  return '工程'
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function handleCreate() {
  if (!newForm.name.trim()) return
  emit('create', {
    name: newForm.name.trim(),
    description: newForm.description.trim()
  })
  newForm.name = ''
  newForm.description = ''
  showCreateModal.value = false
}

async function handleImportCommand(cmd: string) {
  if (cmd === 'directory') {
    if (window.project?.importDirectory) {
      const ws = await window.project.importDirectory()
      if (ws) {
        await loadWorkspaces()
        activeWorkspaceId.value = ws.id
        emit('workspace-changed', ws)
        ElMessage.success(`已导入项目【${ws.name}】(${ws.framework})`)
      }
    }
  } else if (cmd === 'url') {
    urlForm.name = ''
    urlForm.url = 'http://localhost:3000'
    showUrlImportModal.value = true
  }
}

async function handleConfirmImportUrl() {
  if (!urlForm.url.trim()) return
  if (window.project?.importUrl) {
    const ws = await window.project.importUrl({
      url: urlForm.url.trim(),
      name: urlForm.name.trim() || undefined
    })
    await loadWorkspaces()
    activeWorkspaceId.value = ws.id
    emit('workspace-changed', ws)
    ElMessage.success(`已导入 URL【${ws.name}】`)
    showUrlImportModal.value = false
  }
}

async function handleSwitchWorkspace() {
  if (window.project?.switchWorkspace) {
    const ws = await window.project.switchWorkspace(activeWorkspaceId.value)
    if (ws) {
      emit('workspace-changed', ws)
      ElMessage.info(`切换至工作区【${ws.name}】`)
    }
  }
}
</script>
