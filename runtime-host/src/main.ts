import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

import { WbTable } from '@wb-ui/WbTable'
import { WbButton } from '@wb-ui/WbButton'
import { WbFilterForm } from '@wb-ui/WbFilterForm'
import { WbDialog } from '@wb-ui/WbDialog'
import { WbDialogWrapper } from '@wb-ui/WbDialogWrapper'

import { initInspectorClient } from './inspector-client'

const app = createApp(App)

app.use(router)
app.use(ElementPlus, { locale: zhCn })

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.component('WbTable', WbTable)
app.component('wb-table', WbTable)
app.component('WbButton', WbButton)
app.component('wb-button', WbButton)
app.component('WbFilterForm', WbFilterForm)
app.component('wb-filter-form', WbFilterForm)
app.component('WbDialog', WbDialog)
app.component('wb-dialog', WbDialog)
app.component('WbDialogWrapper', WbDialogWrapper)
app.component('wb-dialog-wrapper', WbDialogWrapper)

app.mount('#app')

// 启动圈画探针
initInspectorClient()
