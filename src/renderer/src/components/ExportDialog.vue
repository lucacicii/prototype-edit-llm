<template>
  <el-dialog
    v-model="visible"
    title="导出代码至本地业务工程 (web-ums-password-template)"
    width="620px"
    destroy-on-close
    :close-on-click-modal="false"
    @closed="emit('closed')"
  >
    <el-form label-position="top">
      <el-form-item label="目标工程目录 (Workspace / Project Path)">
        <div class="dir-selector">
          <el-input
            v-model="targetDir"
            placeholder="例如: /Users/lucas/wb/refactoring/wb-tools/packages/web-ums-password-template"
            clearable
          />
          <el-button type="primary" plain @click="handleSelectDir">
            浏览目录...
          </el-button>
        </div>
        <div class="form-tip">
          默认为 <code>web-ums-password-template</code> 工程根目录
        </div>
      </el-form-item>

      <el-form-item label="相对页面文件路径 (Relative File Path)">
        <el-input
          v-model="relativeFilePath"
          placeholder="例如: src/views/prototype/index.vue"
        />
        <div class="form-tip">
          支持自动创建多级未存在的目录，默认后缀随当前技术栈
          （<code>.vue</code> / <code>.tsx</code> / <code>.html</code>）
        </div>
      </el-form-item>

      <el-form-item label="路由同步模式 (Router Mode)">
        <el-radio-group v-model="routerExportMode">
          <el-radio label="static">直接配置到本地静态路由 (src/router/local_router.ts)</el-radio>
          <el-radio label="none">仅导出页面代码 (自行配置)</el-radio>
        </el-radio-group>
        <div class="form-tip">
          选择静态路由模式时，页面无需服务端下发即可在左侧菜单栏直接展示并可点击访问。
        </div>
      </el-form-item>

      <div class="full-path-preview" v-if="targetDir">
        <span class="preview-label">完整落盘路径：</span>
        <code class="preview-path">{{ computedFullPath }}</code>
      </div>

      <el-alert
        v-if="fileExists"
        title="注意：目标文件已存在，确认导出将直接覆盖该文件！"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
      />
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="exporting"
          :disabled="!targetDir || !relativeFilePath"
          @click="handleConfirmExport"
        >
          立即导出
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps<{
  visible: boolean
  code: string
  /** 当前原型的技术栈：决定默认导出后缀与提示文案。 */
  techStack?: 'vue3-element' | 'react-ts' | 'native-html'
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'success', path: string): void
  (e: 'closed'): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const defaultPasswordTemplateDir = '/Users/lucas/wb/refactoring/wb-tools/packages/web-ums-password-template'
const targetDir = ref(localStorage.getItem('wb_prototype_export_dir') || defaultPasswordTemplateDir)
// 默认后缀跟栈走：.vue / .tsx / .html（与落盘、版本快照同口径）
const defaultRelPath = computed(() => {
  const ext = props.techStack === 'react-ts' ? 'tsx' : props.techStack === 'native-html' ? 'html' : 'vue'
  return `src/views/prototype-demo/index.${ext}`
})
const relativeFilePath = ref(defaultRelPath.value)
const routerExportMode = ref<'static' | 'none'>('static')
const fileExists = ref(false)
const exporting = ref(false)

// 栈切换时同步默认路径（用户已改过路径则不动）
watch(defaultRelPath, (p) => {
  const curExt = relativeFilePath.value.split('.').pop()
  if (['vue', 'tsx', 'html'].includes(curExt ?? '') && p.endsWith(`.${curExt}`) === false) {
    relativeFilePath.value = p
  }
})

const computedFullPath = computed(() => {
  if (!targetDir.value) return ''
  const dir = targetDir.value.replace(/\/+$/, '')
  const rel = relativeFilePath.value.replace(/^\/+/, '')
  return `${dir}/${rel}`
})

watch(
  computedFullPath,
  async (newPath) => {
    if (!newPath || !window.project) {
      fileExists.value = false
      return
    }
    const res = await window.project.checkFileExists(newPath)
    fileExists.value = res.exists
  },
  { immediate: true }
)

const handleSelectDir = async () => {
  if (!window.project) return
  const dir = await window.project.selectDirectory()
  if (dir) {
    targetDir.value = dir
    localStorage.setItem('wb_prototype_export_dir', dir)
  }
}

const handleConfirmExport = async () => {
  if (!window.project) {
    ElMessage.warning('当前运行在纯浏览器模式下，无法使用桌面落盘功能')
    return
  }

  if (fileExists.value) {
    try {
      await ElMessageBox.confirm('目标文件已存在，确认覆盖现有代码吗？', '覆盖确认', {
        type: 'warning',
        confirmButtonText: '覆盖并导出',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
  }

  exporting.value = true
  try {
    const res = await window.project.saveCode({
      filePath: computedFullPath.value,
      content: props.code
    })

    if (res.success) {
      ElMessage.success(`代码已成功导出到: ${res.savedPath}`)
      emit('success', res.savedPath || computedFullPath.value)
      visible.value = false
    } else {
      ElMessage.error(`导出失败: ${res.error}`)
    }
  } catch (err: any) {
    ElMessage.error(`导出异常: ${err.message || String(err)}`)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.dir-selector {
  display: flex;
  gap: 8px;
  width: 100%;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.form-tip code {
  color: #409eff;
  background-color: #ecf5ff;
  padding: 2px 4px;
  border-radius: 4px;
}

.full-path-preview {
  margin-top: 14px;
  padding: 10px 12px;
  background-color: #f4f4f5;
  border-radius: 4px;
  font-size: 12px;
  word-break: break-all;
}

.preview-label {
  color: #606266;
  font-weight: 500;
}

.preview-path {
  color: #67c23a;
  font-weight: 600;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
