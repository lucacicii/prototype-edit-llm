<template>
  <el-dialog
    v-model="visible"
    :title="`🕘 版本历史${prototypeName ? ' · ' + prototypeName : ''}`"
    width="600px"
    destroy-on-close
    :close-on-click-modal="false"
    @closed="emit('closed')"
  >
    <!-- 手动存一版：给眼下这份代码起个名字（不会被自动清理） -->
    <div class="flex items-center gap-2">
      <el-input
        v-model="newLabel"
        size="small"
        placeholder="版本名称（可留空）"
        clearable
        @keyup.enter="handleSaveCurrent"
      />
      <el-button type="primary" size="small" :loading="saving" @click="handleSaveCurrent">
        📌 保存当前版本
      </el-button>
    </div>
    <p class="mt-1.5 text-[11px] text-slate-500">
      模型每次改动都会自动留一版；这里保存的是眼下这一份代码，起个名字方便回头找。
      版本文件的扩展名跟随生成时的技术栈（列表里每行有标注）。
    </p>

    <div v-if="loading" class="py-8 text-center text-xs text-slate-500">读取中…</div>
    <div v-else-if="!versions.length" class="py-8 text-center text-xs text-slate-500">
      还没有版本记录。模型每次改动都会自动留一版。
    </div>
    <div v-else class="mt-3 max-h-[46vh] divide-y divide-slate-100 overflow-y-auto">
      <div v-for="v in ordered" :key="v.version" class="py-2">
        <div class="flex items-center gap-2 text-xs">
          <span class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
            v{{ v.version }}
          </span>
          <span class="font-mono text-slate-400">{{ formatClock(v.createdAt) }}</span>
          <span class="flex-1 truncate text-slate-700" :title="v.label">{{ v.label }}</span>
          <span
            v-if="v.version === latestVersion"
            class="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-sky-700"
          >
            最新
          </span>
          <span
            v-if="v.version === currentVersion"
            class="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
          >
            当前
          </span>
          <span
            v-if="v.pinned"
            class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700"
          >
            已命名
          </span>
        </div>
        <div class="mt-1 flex items-center gap-3 text-[11px]">
          <button class="text-sky-600 hover:underline" @click="toggleView(v.version)">
            {{ openVersion === v.version ? '收起' : '查看' }}
          </button>
          <!-- 版本文件的扩展名跟随生成时的技术栈，标出来免得
               用户以为历史全是 .vue -->
          <span v-if="fileExtOf(v.file)" class="font-mono text-slate-400">.{{ fileExtOf(v.file) }}</span>
          <button class="text-slate-500 hover:underline" @click="handleRename(v)">重命名</button>
          <button
            class="hover:underline"
            :class="
              v.version === currentVersion
                ? 'cursor-not-allowed text-slate-300'
                : 'text-amber-600'
            "
            :disabled="v.version === currentVersion"
            title="把代码回滚到这一版（当前代码会先自动存一版）"
            @click="handleRollbackClick(v)"
          >
            回滚
          </button>
          <span v-if="v.groupTag" class="ml-auto text-slate-400">{{ v.groupTag }}</span>
        </div>
        <pre
          v-if="openVersion === v.version"
          class="mt-1.5 max-h-64 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700"
        >{{ codes[v.version] ?? '读取中…' }}</pre>
      </div>
    </div>

    <template #footer>
      <el-button size="small" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 版本元数据；权威定义在 src/main/ipc/history-bridge.ts，这里只声明用得到的字段。
 * 列表不缓存进 store/localStorage —— 磁盘上的 .prototype-history 才是真相，
 * 每次打开对话框重新读（store 的 localStorage 镜像有 5MB 配额的老问题）。
 */
interface VersionItem {
  version: number
  createdAt: number
  label: string
  kind: string
  pinned: boolean
  bytes: number
  runId?: string
  /** 版本文件的文件名（含扩展名，跟随生成时的技术栈）。 */
  file?: string
}

const props = defineProps<{
  visible: boolean
  activePrototypeId: string
  prototypeName?: string
  currentCode: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'rollback', payload: { version: number; code: string; label: string }): void
  (e: 'closed'): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

/** 版本文件扩展名（vN 之后的 .vue/.tsx/.html）。 */
function fileExtOf(file?: string): string {
  if (!file) return ''
  const m = /\.([a-z]+)$/i.exec(file)
  return m ? m[1].toLowerCase() : ''
}

const versions = ref<VersionItem[]>([])
const currentVersion = ref<number | null>(null)
const latestVersion = ref<number | null>(null)
const loading = ref(false)
const saving = ref(false)
const newLabel = ref('')
const openVersion = ref<number | null>(null)
/** 看过的版本代码，按版本号缓存，避免反复读盘。 */
const codes = ref<Record<number, string>>({})

/**
 * 最新在上。同属一轮请求的多个版本（模型改完发现报错又改）会加一句归组说明 ——
 * 不然一次操作看起来就是凭空多了六七个版本。本轮最后一版才是这轮的结果。
 */
const ordered = computed(() => {
  const asc = [...versions.value].sort((a, b) => a.version - b.version)
  const groups = new Map<string, number[]>()
  for (const v of asc) {
    if (!v.runId) continue
    groups.set(v.runId, [...(groups.get(v.runId) ?? []), v.version])
  }
  return [...asc].reverse().map((v) => {
    const group = v.runId ? (groups.get(v.runId) ?? []) : []
    if (group.length < 2) return { ...v, groupTag: '' }
    const index = group.indexOf(v.version) + 1
    return {
      ...v,
      groupTag:
        index === group.length ? `本轮最终（共 ${group.length} 版）` : `本轮中间版 ${index}/${group.length}`
    }
  })
})

function formatClock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function refresh(): Promise<void> {
  if (!window.historyApi) {
    ElMessage.warning('当前运行在纯浏览器模式下，版本历史不可用')
    return
  }
  loading.value = true
  try {
    const res = await window.historyApi.list({
      prototypeId: props.activePrototypeId,
      currentCode: props.currentCode
    })
    if (!res?.ok) {
      ElMessage.warning(res?.error ?? '读取版本历史失败')
      return
    }
    versions.value = (res.versions ?? []) as VersionItem[]
    currentVersion.value = res.currentVersion ?? null
    latestVersion.value = res.latestVersion ?? null
    // 换了原型就把缓存清掉，别把上一个原型的代码留在面板上
    codes.value = {}
    openVersion.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.activePrototypeId] as const,
  ([open]) => {
    if (open) refresh()
  }
)

async function ensureCode(version: number): Promise<string | null> {
  const cached = codes.value[version]
  if (typeof cached === 'string') return cached
  const res = await window.historyApi?.read({ prototypeId: props.activePrototypeId, version })
  if (!res?.ok || typeof res.code !== 'string') {
    ElMessage.warning(res?.error ?? `读取 v${version} 失败`)
    return null
  }
  codes.value = { ...codes.value, [version]: res.code }
  return res.code
}

async function toggleView(version: number): Promise<void> {
  if (openVersion.value === version) {
    openVersion.value = null
    return
  }
  openVersion.value = version
  await ensureCode(version)
}

async function handleRollbackClick(v: VersionItem): Promise<void> {
  // 确认框留给 App.vue 弹：回滚要动 store、写盘、往对话里追记录，都归它管
  const code = await ensureCode(v.version)
  if (code === null) return
  emit('rollback', { version: v.version, code, label: v.label })
}

async function handleSaveCurrent(): Promise<void> {
  if (!window.historyApi) return
  saving.value = true
  try {
    const res = await window.historyApi.record({
      prototypeId: props.activePrototypeId,
      code: props.currentCode,
      label: newLabel.value,
      kind: 'manual',
      pinned: true
    })
    if (!res?.ok) {
      ElMessage.warning(res?.error ?? '保存版本失败')
      return
    }
    // 内容与最新版相同时主进程不会重复落盘，而是把那一版当成这次命名的对象
    if (res.unchanged) ElMessage.info(`当前代码已经是 v${res.version}`)
    else ElMessage.success(`已存为 v${res.version}`)
    newLabel.value = ''
    await refresh()
  } finally {
    saving.value = false
  }
}

async function handleRename(v: VersionItem): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '给这一版起个名字；命名过的版本不会被自动清理。',
      `重命名 v${v.version}`,
      { inputValue: v.label, confirmButtonText: '保存', cancelButtonText: '取消' }
    )
    const res = await window.historyApi?.rename({
      prototypeId: props.activePrototypeId,
      version: v.version,
      label: value ?? ''
    })
    if (res && !res.ok) {
      ElMessage.warning(res.error ?? '重命名失败')
      return
    }
    await refresh()
  } catch {
    /* 用户取消 */
  }
}
</script>
