import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '../layout/MainLayout.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      redirect: '/prototypes/merchant-mgmt',
      children: [
        {
          path: '/prototypes/merchant-mgmt',
          name: 'MerchantMgmt',
          component: () => import('../views/prototypes/merchant-mgmt.vue'),
          meta: { title: '客户与商户管理' }
        },
        {
          path: '/prototypes/material-mgmt',
          name: 'MaterialMgmt',
          component: () => import('../views/prototypes/material-mgmt.vue'),
          meta: { title: '企业商品与物料管理' }
        }
      ]
    }
  ]
})
