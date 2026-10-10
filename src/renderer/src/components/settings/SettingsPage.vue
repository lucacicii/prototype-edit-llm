<template>
  <div v-if="visible" class="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
    <!-- 整窗覆盖会盖住 sidebar 那条 app-drag，所以拖拽栏要自带；traffic-light-inset
         给红绿灯让位（它们永远画在 web 内容之上，隐藏不了）。 -->
    <header class="settings-topbar app-drag traffic-light-inset">
      <el-button size="small" text @click="close">← 返回</el-button>
      <span class="settings-topbar-title">设置</span>
    </header>

    <div class="settings-layout">
      <nav class="settings-nav">
        <button
          v-for="item in SETTINGS_SECTIONS"
          :key="item.key"
          type="button"
          class="settings-nav-item"
          :class="{ active: section === item.key }"
          @click="section = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <section class="settings-main">
        <ProviderPane v-if="section === 'provider'" />
        <AgentPane v-else />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useAgentModelConfig } from '../../composables/useAgentModelConfig'
import { SETTINGS_SECTIONS, type SettingsSection } from './sections'
import ProviderPane from './panes/ProviderPane.vue'
import AgentPane from './panes/AgentPane.vue'
import './settings.css'

/**
 * 设置页：铺满整窗的覆盖层，左边菜单右边内容。
 *
 * 对外仍是 `visible` prop + `update:visible` / `saved` / `closed` 三个事件 —— 与它
 * 取代的那个 el-dialog 完全一致，所以 App.vue 那边只换了组件名，4 个开启入口和
 * browserSuspended 的挂起/释放逻辑一个字都不用动。
 *
 * 必须 `v-if`：常驻的 fixed inset-0 覆盖层会吃掉全应用点击，而它带 app-drag，
 * 还会把整个窗口变成拖拽区。
 */
const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', info: { configured: boolean }): void
  (e: 'closed'): void
}>()

const modelConfig = useAgentModelConfig()
const section = ref<SettingsSection['key']>('provider')

function close() {
  // 覆盖层盖住了整个窗口，App.vue 顶部那个模型角标在设置页开着时根本看不见，
  // 所以只要在关闭时通知一次、让它重读状态就够，不必为每次增删都往上报。
  emit('saved', { configured: modelConfig.configured.value })
  emit('update:visible', false)
}

// ModelSettingsDialog 的 watch(visible, { immediate: true }) 那条注释在这里依然成立：
// 父组件若在 visible 已是 true 时才挂载本组件，不 fire 的 watch 会让页面停在未加载。
// 另外 `closed` 只在「曾经开过、现在关了」时发 —— 首次 immediate 跑在 visible=false
// 上，那不是一次关闭。
let seenOpen = false
watch(
  () => props.visible,
  (open) => {
    if (open) {
      seenOpen = true
      void modelConfig.refresh()
      return
    }
    if (seenOpen) emit('closed')
  },
  { immediate: true }
)

/**
 * 有没有「真的开着」的 Element Plus 弹层。
 *
 * 不要自己去扫 `.el-overlay` 的 display：EP 把关闭过的弹窗/确认框的 overlay 留在
 * DOM 里，而且它们可能卡在过渡类上（HMR 之后尤其明显），于是「可见」的判断永远为真 ——
 * 症状是只要开过一次「添加服务商」，Esc 就再也关不掉设置页。`el-popup-parent--hidden`
 * 是 EP 自己为「当前有弹层」维护的类，随开随加、全关才去，这才是权威信号。
 */
function hasVisiblePopup(): boolean {
  return document.body.classList.contains('el-popup-parent--hidden')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.visible) return
  // 「添加服务商」/「添加模型」/确认框自己会处理 Esc（Element Plus 默认
  // close-on-press-escape），有它们在的时候别把整页也一起关掉。
  if (hasVisiblePopup()) return
  close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
