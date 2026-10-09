import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './assets/main.css'
import App from './App.vue'

// 只在 macOS 上给侧边栏标题行加红绿灯内缩：Windows/Linux 有原生标题栏，加了反而错位。
if (window.electron?.process?.platform === 'darwin') {
  document.documentElement.classList.add('is-macos')
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(ElementPlus)
app.mount('#app')
