import { createRouter, createWebHashHistory } from 'vue-router'

export const ICON_CREATOR_ROUTE_NAME = 'icon-creator'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: ICON_CREATOR_ROUTE_NAME,
      component: () => import('@/views/home/index.vue')
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: ICON_CREATOR_ROUTE_NAME }
    }
  ]
})

export default router
