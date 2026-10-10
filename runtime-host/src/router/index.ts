import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import MainLayout from '../layout/MainLayout.vue'

/**
 * 预览路由：/prototypes/:id 是动态段，实际组件按当前栈切换。
 *
 * 栈标记（../.prototype-stack）由主进程写，Vite 启动时读一次。
 * 切换栈时主进程会改写标记并整页刷新预览 —— 浏览器重新拉
 * /src/main.ts 模块图，路由这里重新求值，动态 import 才指向
 * 新扩展名的文件。dev server 不需要重启。
 *
 * 读标记的逻辑与 vite.config.ts 的 readPrototypeStack 保持一致；
 * 这里不 import 它，避免把 Node 的 fs 引进浏览器模块图。
 */
type Stack = 'vue3-element' | 'react-ts' | 'native-html'

const stack: Stack = (() => {
  try {
    // import.meta.url 在 dev 下是 /src/router/index.ts，仓库根在两级之上
    const root = new URL('../../', import.meta.url)
    // 标记文件随源码服务，直接 fetch（dev only）
    // 用同步 XHR 之外没有别的办法——路由模块必须同步给出 component。
    // 失败一律退回 vue3-element（存量快照都是它）。
    const xhr = new XMLHttpRequest()
    xhr.open('GET', new URL('.prototype-stack', root).href, false)
    xhr.send(null)
    const raw = xhr.status === 200 ? xhr.responseText.trim() : ''
    if (raw === 'react-ts' || raw === 'native-html') return raw
  } catch {
    /* 同上 */
  }
  return 'vue3-element'
})()

const prototypeComponent = (): Promise<any> => {
  switch (stack) {
    case 'react-ts':
      // React 组件包一层 Vue 壳渲染：runtime-host 的布局（侧边栏/
      // 顶栏）是 Vue 的，页面主体是 LLM 生成的 React 根组件。
      return import('../views/prototypes/react-host.vue').then(m => m.default)
    case 'native-html':
      // 原生 HTML 文档直接进 iframe：不经过任何框架转换，
      // LLM 写的 <script> 原样执行。
      return import('../views/prototypes/html-host.vue').then(m => m.default)
    default:
      return import('../views/prototypes/active.vue').then(m => m.default)
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      redirect: '/prototypes/blank-prototype',
      children: [
        {
          path: '/prototypes/:id',
          name: 'Prototype',
          component: prototypeComponent,
          meta: { title: '原型预览', stack }
        }
      ]
    }
  ] as RouteRecordRaw[]
})
