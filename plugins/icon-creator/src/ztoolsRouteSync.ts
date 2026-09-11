import type { Router } from 'vue-router'
import { ICON_CREATOR_ROUTE_NAME } from '@/router'

export function syncZtoolsRoute(router: Router) {
  window.ztools.onPluginEnter((action) => {
    router.replace({
      name: ICON_CREATOR_ROUTE_NAME,
      state: { action }
    })
  })

  window.ztools.onPluginOut(() => {
    router.replace({ name: ICON_CREATOR_ROUTE_NAME })
  })
}
