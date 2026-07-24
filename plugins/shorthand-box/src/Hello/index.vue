<script setup>
import { ref } from 'vue'
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NButton, NInput, NSpace, NDivider, NDataTable, NIcon, NTag } from 'naive-ui'
import { Home, Settings, DocumentText } from '@vicons/ionicons5'

// 模拟数据
const data = [
  { id: 1, name: '终端命令', description: '在终端执行的命令', order: 1 },
  { id: 2, name: 'Swagger地址', description: 'Swagger地址', order: 2 },
  { id: 3, name: '使用方法描述', description: '使用方法描述', order: 3 },
  { id: 4, name: '快捷键', description: '快捷键', order: 4 },
  { id: 5, name: '后端服务地址', description: '后端服务地址', order: 5 },
  { id: 6, name: '项目杂记', description: '项目杂记', order: 6 },
  { id: 7, name: '数据生成', description: '数据生成', order: 7 }
]

const columns = [
  {
    title: '序号',
    key: 'id',
    width: 80
  },
  {
    title: '数据类型名称',
    key: 'name'
  },
  {
    title: '数据类型描述',
    key: 'description'
  },
  {
    title: '排序',
    key: 'order',
    width: 80
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row) {
      return (
        <NSpace size={8}>
          <NButton size="small" type="primary" quaternary>
            编辑
          </NButton>
          <NButton size="small" type="error" quaternary>
            删除
          </NButton>
        </NSpace>
      )
    }
  }
]

const activeKey = ref('1')
</script>

<template>
  <NLayout style="height: 100vh">
    <NLayoutSider
      width={240}
      style="background-color: #fff"
      bordered
    >
      <NMenu
        :items="[
          {
            key: '1',
            label: '数据管理',
            icon: () => <NIcon><Home /></NIcon>
          },
          {
            key: '2',
            label: '项目管理',
            icon: () => <NIcon><DocumentText /></NIcon>
          },
          {
            key: '3',
            label: '数据类型',
            icon: () => <NIcon><Settings /></NIcon>
          }
        ]"
        :value="activeKey"
        @update:value="activeKey = $event"
        mode="vertical"
        style="height: 100%"
      />
    </NLayoutSider>
    <NLayoutContent style="padding: 24px; overflow: auto; background-color: #f5f5f5">
      <div style="background-color: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08)">
        <NSpace justify="space-between" align="center" style="margin-bottom: 24px">
          <h1 style="margin: 0; font-size: 18px; font-weight: 600;">
            数据类型
            <NTag size="small" type="info" style="margin-left: 8px">共17条</NTag>
          </h1>
          <NSpace>
            <NButton type="primary" secondary>
              <template #icon>
                <NIcon>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
                    <path fill-rule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
                  </svg>
                </NIcon>
              </template>
              添加
            </NButton>
            <NButton>
              <template #icon>
                <NIcon>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
                    <path fill-rule="evenodd" d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" clip-rule="evenodd" />
                  </svg>
                </NIcon>
              </template>
              反转排序
            </NButton>
          </NSpace>
        </NSpace>
        
        <NSpace style="margin-bottom: 24px">
          <div>
            <label style="margin-right: 8px">数据类型名称</label>
            <NInput placeholder="按数据类型名称关键字" style="width: 200px" />
          </div>
          <div>
            <label style="margin-right: 8px">数据类型描述</label>
            <NInput placeholder="按数据类型描述关键字" style="width: 200px" />
          </div>
        </NSpace>
        
        <NDivider style="margin-bottom: 24px" />
        
        <NDataTable
          :columns="columns"
          :data="data"
          bordered
          pagination
          :pagination-options="{
            pageSize: 10,
            showSizePicker: true,
            pageSizes: [10, 20, 50]
          }"
        />
      </div>
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.n-layout {
  overflow: hidden;
}
</style>