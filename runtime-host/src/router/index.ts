import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '../layout/MainLayout.vue'

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
          component: () => import('../views/prototypes/active.vue'),
          meta: { title: '原型预览' }
        }
      ]
    }
  ]
})
