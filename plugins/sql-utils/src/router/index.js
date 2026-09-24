import { createRouter, createWebHashHistory } from 'vue-router'

import textJoint from '../views/textJoint.vue'
import excelToSql from '../views/excelToSql.vue'
import generateTestData from '../views/generateTestData.vue'
import codeGenerator from '../views/codeGenerator/codeGenerator.vue'
import gitCommit from '../views/gitCommit.vue'

const routes = [
  {
    path: '/',
    redirect: '/textJoint'
  },
  {
    path: '/textJoint',
    name: 'textJoint',
    component: textJoint
  },
  {
    path: '/excelToSql',
    name: 'excelToSql',
    component: excelToSql
  },
  {
    path: '/generateTestData',
    name: 'generateTestData',
    component: generateTestData
  },
  {
    path: '/codeGenerator',
    name: 'codeGenerator',
    component: codeGenerator
  },
  {
    path: '/gitCommit',
    name: 'gitCommit',
    component: gitCommit
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
