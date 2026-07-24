<template>
  <div class="template-manager">
    <div class="template-description">
      <div class="template-description-content">
        <h4 class="description-title">模板使用说明</h4>
        <p><strong>1. 模板语法：</strong>本系统使用 Handlebars 模板引擎，支持条件判断、循环等功能。详细文档请参考：<a href="https://handlebarsjs.com/zh/guide/" target="_blank" style="color: #2080f0">Handlebars 中文指南</a></p>
        <p><strong>2. 数据存储：</strong>自定义模板保存在浏览器的本地存储中（localStorage）。</p>
        <p><strong>3. 数据清除：</strong>清除浏览器缓存或本地存储数据会导致自定义模板丢失。系统默认模板不受影响，会自动重新加载。</p>
      </div>
    </div>

    <div class="template-type-selector">
      <n-tabs v-model:value="activeTemplateType" type="line" @update:value="handleTemplateTypeChange">
        <n-tab v-for="template in templateTypes" :key="template.key" :name="template.key" :tab="template.name" />
      </n-tabs>
    </div>

    <div class="template-list">
      <div class="list-header">
        <n-space>
          <n-button text type="primary" @click="exportTemplates">导出模板</n-button>
          <n-button text type="primary" @click="importTemplates">导入模板</n-button>
        </n-space>
      </div>

      <div class="template-table-wrapper">
        <vxe-table ref="versionTableRef" :data="currentTemplateVersions" size="mini" height="100%">
          <vxe-column field="name" title="版本名称" width="250" />
          <vxe-column field="createTime" title="创建时间" width="200">
            <template #default="{ row }">{{ row.isSystemDefault ? '' : row.createTime }}</template>
          </vxe-column>
          <vxe-column title="操作" min-width="220">
            <template #default="{ row }">
              <n-space :size="8">
                <n-button v-if="!row.isSystemDefault" text type="primary" size="small" @click="editTemplate(row, true)">编辑</n-button>
                <n-button v-if="row.isSystemDefault" text type="primary" size="small" @click="editTemplate(row, false)">查看</n-button>
                <n-popconfirm
                  :show-icon="false"
                  @positive-click="copyTemplate(row)"
                  @update:show="show => handleCopyPopconfirmShow(show, row)"
                >
                  <template #trigger>
                    <n-button text type="primary" size="small">复制</n-button>
                  </template>
                  <div class="copy-template-popover">
                    <div class="copy-template-label">请输入新版本名称</div>
                    <n-input v-model:value="copyTemplateName" size="small" @keydown.enter.prevent="copyTemplate(row)" />
                  </div>
                </n-popconfirm>
                <n-popconfirm v-if="!row.isSystemDefault" @positive-click="deleteTemplate(row)">
                  <template #trigger>
                    <n-button text type="error" size="small">删除</n-button>
                  </template>
                  确定要删除这个模板版本吗？
                </n-popconfirm>
              </n-space>
            </template>
          </vxe-column>
        </vxe-table>
      </div>
    </div>

    <TemplateEditor v-model:visible="dialogVisible" :template="currentTemplate" :is-edit="isEditMode" :editor-mode="editorMode" @save="saveTemplate" @close="dialogVisible = false" />

    <n-modal v-model:show="importDialogVisible" title="导入模板" preset="card" style="width: 400px">
      <n-upload ref="uploadRef" :default-upload="false" :max="1" accept=".json" @change="handleFileChange" directory-dnd>
        <n-upload-dragger>
          <n-text>点击或者拖动文件到该区域来上传</n-text>
          <n-p depth="3">只能上传JSON文件，且只能上传一个文件</n-p>
        </n-upload-dragger>
      </n-upload>
      <template #footer>
        <n-space>
          <n-button @click="importDialogVisible = false">取消</n-button>
          <n-button type="primary" :loading="importLoading" @click="confirmImport">确定</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import TemplateEditor from './TemplateEditor.vue'
import NotifyUtil from '@/utils/notifyUtil.js'
import { templateConfigs } from '@/config/templateConfig'
import templateLoader from '@/utils/TemplateLoader'
import simpleTemplateManager, {
  SYSTEM_TEMPLATE_PREFIX,
  TEMPLATE_VERSIONS_STORAGE_KEY
} from '@/utils/SimpleTemplateManager'

const emit = defineEmits(['template-updated'])

const activeTemplateType = ref('javaBean')
const templateTypes = templateConfigs
const templateVersionsByType = reactive({})
const currentTemplate = ref({ id: '', name: '', description: '', content: '' })
const dialogVisible = ref(false)
const editorMode = ref('handlebars')
const isEditMode = ref(false)
const importDialogVisible = ref(false)
const importLoading = ref(false)
const importFileList = ref([])
const versionTableRef = ref(null)
const uploadRef = ref(null)
const copyTemplateName = ref('')
let importFileData = null

const currentTemplateVersions = computed(() => {
  return templateVersionsByType[activeTemplateType.value] || []
})

async function initTemplateVersions() {
  const savedVersions = localStorage.getItem(TEMPLATE_VERSIONS_STORAGE_KEY)
  let customVersionsByType = {}
  if (savedVersions) {
    try {
      const parsedVersions = JSON.parse(savedVersions)
      Object.keys(parsedVersions).forEach(type => {
        customVersionsByType[type] = parsedVersions[type].map(version => ({ ...version, isSystemDefault: false }))
      })
    } catch (error) {
      console.error('解析模板版本失败:', error)
    }
  }

  for (const type of templateTypes) {
    const systemDefaultVersion = {
      id: SYSTEM_TEMPLATE_PREFIX + type.key,
      name: '默认',
      description: '系统默认模板，不可删除',
      isSystemDefault: true,
      createTime: new Date().toLocaleString(),
      content: getSystemTemplateContent(type.key)
    }
    const customVersions = customVersionsByType[type.key] || []
    templateVersionsByType[type.key] = [systemDefaultVersion, ...customVersions]
  }
}

function getSystemTemplateContent(templateType) {
  try {
    return templateLoader.getTemplate(templateType)
  } catch (error) {
    console.error(`获取模板文件内容失败:`, error)
    return `// 模板加载失败`
  }
}

function handleTemplateTypeChange() {}

function editTemplate(template, isEdit) {
  const versions = templateVersionsByType[activeTemplateType.value]
  const latestTemplate = versions.find(v => v.id === template.id)
  currentTemplate.value = { ...(latestTemplate || template) }
  isEditMode.value = isEdit
  dialogVisible.value = true
}

function saveTemplate(template) {
  if (!template.name) {
    NotifyUtil.warning('提示', '请输入版本名称')
    return
  }
  const success = simpleTemplateManager.upsertTemplateVersion(activeTemplateType.value, template)
  if (!success) {
    NotifyUtil.error('保存失败', '模板版本保存失败')
    return
  }
  initTemplateVersions()
  dialogVisible.value = false
  NotifyUtil.success('成功', '模板保存成功')
  emit('template-updated')
}

function deleteTemplate(template) {
  if (template.isSystemDefault) {
    NotifyUtil.warning('提示', '系统默认模板不能删除')
    return
  }
  const success = simpleTemplateManager.deleteTemplateVersion(activeTemplateType.value, template.id)
  if (!success) {
    NotifyUtil.error('删除失败', '模板版本删除失败')
    return
  }
  initTemplateVersions()
  NotifyUtil.success('成功', '模板删除成功')
}

function handleCopyPopconfirmShow(show, template) {
  if (show) {
    copyTemplateName.value = `${template.name} - 副本`
  }
}

function copyTemplate(template) {
  const newName = copyTemplateName.value.trim()
  if (!newName) return
  const newVersion = {
    id: 'custom_' + Date.now(),
    name: newName,
    description: '',
    isSystemDefault: false,
    createTime: new Date().toLocaleString(),
    content: template.content
  }
  const success = simpleTemplateManager.upsertTemplateVersion(activeTemplateType.value, newVersion)
  if (!success) {
    NotifyUtil.error('保存失败', '模板版本保存失败')
    return
  }
  initTemplateVersions()
  copyTemplateName.value = ''
  NotifyUtil.success('成功', '新版本创建成功')
}

function exportTemplates() {
  try {
    let hasCustomTemplates = false
    const exportData = {}
    for (let type in templateVersionsByType) {
      const versions = templateVersionsByType[type]
      const customVersions = versions.filter(version => !version.isSystemDefault)
      if (customVersions.length > 0) {
        hasCustomTemplates = true
        exportData[type] = customVersions.map(version => {
          const { isSystemDefault, ...exportVersion } = version
          return exportVersion
        })
      }
    }
    if (!hasCustomTemplates) {
      NotifyUtil.info('提示', '当前没有可导出的自定义模板')
      return
    }
    const exportObj = { version: '1.0', exportTime: new Date().toISOString(), templates: exportData }
    const jsonData = JSON.stringify(exportObj, null, 2)
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `templates-export-${new Date().getTime()}.json`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    NotifyUtil.success('成功', '模板导出成功')
  } catch (error) {
    console.error('导出模板失败:', error)
    NotifyUtil.error('导出失败', '模板导出时发生错误')
  }
}

function importTemplates() {
  importFileData = null
  importDialogVisible.value = true
}

function handleFileChange({ file }) {
  if (file && file.file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        importFileData = JSON.parse(e.target.result)
      } catch (error) {
        NotifyUtil.error('错误', '文件格式不正确，请上传有效的JSON文件')
      }
    }
    reader.readAsText(file.file)
  }
}

function confirmImport() {
  if (!importFileData) {
    NotifyUtil.warning('提示', '请先选择要导入的文件')
    return
  }
  importLoading.value = true
  try {
    if (importFileData.templates) {
      for (const type in importFileData.templates) {
        const versions = importFileData.templates[type]
        versions.forEach(version => {
          version.isSystemDefault = false
          version.id = version.id || 'custom_' + Date.now() + Math.random()
          simpleTemplateManager.upsertTemplateVersion(type, version)
        })
      }
    }
    initTemplateVersions()
    importDialogVisible.value = false
    NotifyUtil.success('成功', '模板导入成功')
  } catch (error) {
    console.error('导入模板失败:', error)
    NotifyUtil.error('导入失败', '模板导入时发生错误')
  } finally {
    importLoading.value = false
  }
}

onMounted(async () => {
  await templateLoader.loadAllTemplates()
  await initTemplateVersions()
})

defineExpose({ initTemplateVersions })
</script>

<style scoped>
.template-description {
  margin-bottom: 15px;
}

.template-description-content {
  padding: 10px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  font-size: 13px;
}

.description-title {
  margin: 0 0 8px;
  font-size: 14px;
}

.template-description-content p {
  margin: 4px 0;
}

.template-type-selector {
  margin-bottom: 10px;
}

.template-list {
  margin-top: 10px;
}

.list-header {
  margin-bottom: 10px;
}

.template-table-wrapper {
  height: 400px;
}

.copy-template-popover {
  width: 220px;
}

.copy-template-label {
  margin-bottom: 8px;
  font-size: 13px;
}
</style>
