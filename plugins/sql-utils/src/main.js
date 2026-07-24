import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

import './css/dark-theme.scss'
import './css/sys.scss'

import '@/assets/iconfont/iconfont.css'

import VXETable from 'vxe-table'
import 'vxe-table/lib/style.css'

import * as strUtil from '@/utils/strUtil.js'
import * as randomData from '@/utils/getRandomData.js'
import * as ddlParser from '@/utils/DDLParser.js'
import * as handlebarsUtil from '@/utils/handlebarsUtil.js'
import * as dateTimeUtil from '@/utils/dateTimeUtil.js'
import NotifyUtil from '@/utils/notifyUtil.js'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(VXETable)

app.config.globalProperties.$strUtil = strUtil
app.config.globalProperties.$randomData = randomData
app.config.globalProperties.$ddlParser = ddlParser
app.config.globalProperties.$handlebarsUtil = handlebarsUtil
app.config.globalProperties.$dateTimeUtil = dateTimeUtil
app.config.globalProperties.$notifyUtil = {
  success: (title = '成功', msg) => NotifyUtil.success(title, msg),
  error: (title = '错误', msg) => NotifyUtil.error(title, msg),
  warning: (title = '警告', msg) => NotifyUtil.warning(title, msg),
  info: (title = '提示', msg) => NotifyUtil.info(title, msg)
}

app.mount('#app')
