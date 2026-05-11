import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'data-management',
    component: () => import('@/views/data-management/index.vue')
  },
    {
    path: '/project-management',
    name: 'project-management',
    component: () => import('@/views/project-management/index.vue')
  },
    {
    path: '/data-type',
    name: 'data-type',
    component: () => import('@/views/data-type/index.vue')
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
