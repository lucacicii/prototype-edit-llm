import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 预览路由：/prototypes/:id 是动态段，实际组件按当前栈切换（完全干净的纯壳，不包裹假后台菜单栏）。
 */
type Stack = 'vue3-element' | 'react-ts' | 'native-html'

const stack: Stack = (() => {
  try {
    const root = new URL('../../', import.meta.url)
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
      return import('../views/prototypes/react-host.vue').then(m => m.default)
    case 'native-html':
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
      redirect: '/prototypes/blank-prototype'
    },
    {
      path: '/prototypes/:id',
      name: 'Prototype',
      component: prototypeComponent,
      meta: { title: '原型预览', stack }
    }
  ] as RouteRecordRaw[]
})
