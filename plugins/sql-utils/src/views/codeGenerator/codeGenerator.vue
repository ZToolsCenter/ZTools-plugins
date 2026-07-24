<template>
  <div class="app">
    <div class="cgLeft">
      <div class="cgLeftTop">
        <CodeEditor ref="ddlEditorRef" mode="sql" v-model="ddl" :autofocus="true" placeholder="请输入DDL建表语句"
                    @change="ddlChange"/>
      </div>
      <div class="cgLeftBottom">
        <n-data-table
            class="ddl-field-table"
            :columns="ddlFieldColumns"
            :data="tableInfo.fields"
            :bordered="true"
            :single-line="false"
            flex-height
            size="small"
        />
      </div>
    </div>

    <div class="cgRight">
      <div class="cgRightTop">
        <n-space :size="8">
          <n-button type="primary" size="small" @click="showTypeMapping">类型映射</n-button>
          <n-button type="primary" size="small" @click="showGenerationConfig">生成配置</n-button>
          <n-button type="primary" size="small" @click="showTemplateManager">模板管理</n-button>
          <n-popconfirm @positive-click="performClearCache">
            <template #trigger>
              <n-button type="error" size="small">清除缓存</n-button>
            </template>
            {{ getClearTemplateCacheConfirmContent() }}
          </n-popconfirm>
        </n-space>
      </div>
      <div class="cgRightBottom">
        <n-tabs v-model:value="genType" type="line" placement="left" class="left-tabs">
          <n-tab-pane v-for="template in templates" :key="template.key" :name="template.key" :tab="template.name">
            <div class="template-container">
              <TemplateOptions :options="template.options" :model="templateData[template.key]"
                               @change="onTemplateOptionsChange"/>

              <div v-if="templateVersions && templateVersions.length > 0" class="template-version-selector">
                <div class="template-version-buttons">
                  <n-button-group size="small">
                    <n-button
                        v-for="version in templateVersions"
                        :key="version.id"
                        :type="activeTemplateVersion === version.id ? 'primary' : 'default'"
                        @click="handleVersionChange(version.id)"
                    >
                      {{ version.name }}
                      <n-icon v-if="!simpleTemplateManager.isSystemDefaultVersion(version.id)" style="margin-left: 4px"
                              @click.stop="editTemplateVersion(version)">
                        <Icon icon="icon-park-outline:edit"/>
                      </n-icon>
                    </n-button>
                  </n-button-group>
                </div>

                <div class="template-content">
                  <CodeEditor ref="resultCodeEditorRef" mode="text/x-java"
                              v-model="templateData[template.key].genResult"/>
                </div>
              </div>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </div>

    <TypeMappingDrawer v-model:visible="typeMappingVisible" @saved="onTypeMappingSaved"/>
    <GenerationConfigDrawer v-model:visible="generationConfigVisible" @saved="onGenerationConfigSaved"/>

    <n-drawer v-model:show="templateManagerVisible" :width="'90%'" placement="right">
      <n-drawer-content title="模板管理">
        <TemplateManager ref="templateManagerRef" @template-updated="onTemplateUpdated"/>
      </n-drawer-content>
    </n-drawer>

    <TemplateEditor v-model:visible="templateEditVisible" :template="currentEditingTemplate"
                    :is-edit="templateEditIsEditable" @save="saveTemplateVersion" @close="templateEditVisible = false"/>
  </div>
</template>

<script setup>
import {ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick} from 'vue'
import {Icon} from '@iconify/vue'
import debounce from 'lodash/debounce'
import CodeEditor from '@/components/CodeEditor.vue'
import TemplateOptions from './TemplateOptions.vue'
import TypeMappingDrawer from './TypeMappingDrawer.vue'
import GenerationConfigDrawer from './GenerationConfigDrawer.vue'
import TemplateManager from './TemplateManager.vue'
import TemplateEditor from './TemplateEditor.vue'
import NotifyUtil from '@/utils/notifyUtil.js'
import * as ddlParser from '@/utils/DDLParser.js'
import * as handlebarsUtil from '@/utils/handlebarsUtil.js'
import * as strUtil from '@/utils/strUtil.js'
import simpleTemplateManager, {
  ACTIVE_TEMPLATE_VERSION_PREFIX,
  SYSTEM_TEMPLATE_PREFIX,
  TEMPLATE_VERSIONS_STORAGE_KEY
} from '@/utils/SimpleTemplateManager'

const ddl = ref('')
const tableTitle = ref('输入DDL建表语句自动解析')
const tableInfo = reactive({tableName: '', tableComment: '', fields: [], imports: ''})
const ddlFieldColumns = computed(() => [
  {
    title: tableTitle.value,
    key: 'tableTitle',
    children: [
      {title: '字段名', key: 'fieldName'},
      {title: '数据类型', key: 'fieldType'},
      {title: 'Java类型', key: 'javaType'},
      {title: '字段说明', key: 'comment', ellipsis: {tooltip: true}}
    ]
  }
])

const genType = ref('javaBean')
const templates = ref([])
const templateData = reactive({})
const typeMappingVisible = ref(false)
const generationConfigVisible = ref(false)
const templateManagerVisible = ref(false)
const templateVersions = ref([])
const activeTemplateVersion = ref('')
const templateEditVisible = ref(false)
const templateEditIsEditable = ref(false)
const currentEditingTemplate = ref(null)
const ddlEditorRef = ref(null)
const templateManagerRef = ref(null)
const resultCodeEditorRef = ref(null)

const generationConfig = reactive({
  basePackage: 'com.example.demo',
  author: 'Developer',
  subPackages: {}
})

const debouncedNotify = debounce(() => {
  NotifyUtil.error('DDL解析失败', '请检查语句是否正确')
}, 500)

const debouncedConvertFromInput = debounce(() => {
  convert({notifyOnError: false})
}, 600)

watch(genType, () => {
  convert()
  initTemplateVersions()
})

async function initSimpleTemplateManager() {
  try {
    simpleTemplateManager.setUtils(handlebarsUtil, strUtil)
    await simpleTemplateManager.initSystemTemplates()
    templates.value = simpleTemplateManager.getAllTemplateConfigs()
    initTemplateData()
  } catch (error) {
    console.error('初始化简化版模板管理器失败:', error)
    NotifyUtil.error('初始化失败', '模板管理器初始化失败，请刷新页面重试')
  }
}

function initTemplateData() {
  templates.value.forEach(template => {
    if (!templateData[template.key]) templateData[template.key] = {}
    template.options.forEach(option => {
      if (option.type === 'checkbox') {
        templateData[template.key][option.key] = option.default !== undefined ? option.default : false
      } else if (option.type === 'input') {
        templateData[template.key][option.key] = option.default !== undefined ? option.default : ''
      }
    })
    templateData[template.key].genResult = ''
  })
}

async function initTemplateVersions() {
  try {
    templateVersions.value = simpleTemplateManager.getTemplateVersions(genType.value)
    activeTemplateVersion.value = simpleTemplateManager.getActiveTemplateVersion(genType.value)
    if (!activeTemplateVersion.value && templateVersions.value.length > 0) {
      activeTemplateVersion.value = templateVersions.value[0].id
    }
    if (activeTemplateVersion.value) {
      simpleTemplateManager.switchTemplateVersion(genType.value, activeTemplateVersion.value)
    } else if (templateVersions.value.length > 0) {
      activeTemplateVersion.value = templateVersions.value[0].id
      simpleTemplateManager.switchTemplateVersion(genType.value, activeTemplateVersion.value)
    }
  } catch (error) {
    console.error('初始化模板版本数据失败:', error)
  }
}

function onTemplateOptionsChange() {
  convert()
}

function handleVersionChange(versionId) {
  const success = simpleTemplateManager.switchTemplateVersion(genType.value, versionId)
  if (success) {
    activeTemplateVersion.value = versionId
    convert()
  }
}

function ddlChange(val) {
  ddl.value = val
  debouncedNotify.cancel()
  if (ddl.value === '') {
    debouncedConvertFromInput.cancel()
    tableTitle.value = '输入DDL建表语句自动解析'
    Object.assign(tableInfo, {tableName: '', tableComment: '', fields: [], imports: ''})
    templates.value.forEach(template => {
      if (templateData[template.key]) templateData[template.key].genResult = ''
    })
  } else {
    debouncedConvertFromInput()
  }
}

function convert(options = {}) {
  const {notifyOnError = true} = options
  if (!ddl.value) return
  let parseResult = ddlParser.parseDDL(ddl.value, {silent: !notifyOnError})
  if (ddl.value && parseResult == null) {
    tableTitle.value = '输入DDL建表语句自动解析'
    Object.assign(tableInfo, {tableName: '', tableComment: '', fields: [], imports: ''})
    if (notifyOnError) debouncedNotify()
    return
  }
  debouncedNotify.cancel()
  Object.assign(tableInfo, parseResult)
  let tableComment = tableInfo.tableComment ? `(${tableInfo.tableComment})` : ''
  tableTitle.value = tableInfo.tableName + tableComment

  const currentTemplate = templates.value.find(t => t.key === genType.value)
  const currentSubPackage = generationConfig.subPackages && generationConfig.subPackages[genType.value]
      ? generationConfig.subPackages[genType.value]
      : (currentTemplate ? currentTemplate.subPackage : '')
  const fullPackageName = currentSubPackage ? `${generationConfig.basePackage}.${currentSubPackage}` : generationConfig.basePackage
  const entitySubPackage = generationConfig.subPackages && generationConfig.subPackages['javaBean'] ? generationConfig.subPackages['javaBean'] : 'entity'
  const entityPackageName = entitySubPackage ? `${generationConfig.basePackage}.${entitySubPackage}` : generationConfig.basePackage
  const mapperSubPackage = generationConfig.subPackages && generationConfig.subPackages['mapper'] ? generationConfig.subPackages['mapper'] : 'mapper'
  const mapperPackageName = mapperSubPackage ? `${generationConfig.basePackage}.${mapperSubPackage}` : generationConfig.basePackage
  const upperCamelTableName = strUtil.snakeToUpperCamel(tableInfo.tableName)
  const lowerCamelTableName = strUtil.snakeToCamel(tableInfo.tableName)
  const mapperFullName = `${mapperPackageName}.${upperCamelTableName}Mapper`
  const processedFields = tableInfo.fields.map(field => ({
    ...field,
    camelFieldName: strUtil.snakeToCamel(field.fieldName)
  }))

  const data = {
    ...JSON.parse(JSON.stringify({genType: genType.value})),
    ...templateData[genType.value],
    basePackage: generationConfig.basePackage,
    author: generationConfig.author,
    subPackage: currentSubPackage,
    fullPackage: fullPackageName,
    entityPackage: entityPackageName,
    mapperPackage: mapperPackageName,
    mapperFullName,
    upperCamelTableName,
    lowerCamelTableName,
    currentDate: new Date().toLocaleDateString(),
    genComment: templateData[genType.value]?.genComment === true,
    genLombok: templateData[genType.value]?.genLombok === true,
    genSwagger: templateData[genType.value]?.genSwagger === true,
    tableInfo: {...tableInfo, fields: processedFields}
  }

  try {
    const result = simpleTemplateManager.renderTemplate(genType.value, data)
    if (templateData[genType.value]) templateData[genType.value].genResult = result
  } catch (error) {
    console.error('模板渲染失败:', error)
    NotifyUtil.error('模板渲染失败', error.message)
  }
}

function showTypeMapping() {
  typeMappingVisible.value = true
}

function onTypeMappingSaved() {
  convert()
}

function showGenerationConfig() {
  generationConfigVisible.value = true
}

function onGenerationConfigSaved(config) {
  Object.assign(generationConfig, config)
  convert()
}

function loadGenerationConfig() {
  try {
    const savedConfig = localStorage.getItem('generationConfig')
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig)
      if (!parsedConfig.subPackages) parsedConfig.subPackages = {}
      Object.assign(generationConfig, parsedConfig)
    }
  } catch (error) {
    console.error('加载生成配置失败:', error)
  }
}

function showTemplateManager() {
  templateManagerVisible.value = true
  nextTick(() => {
    templateManagerRef.value?.initTemplateVersions()
  })
}

async function onTemplateUpdated() {
  await initSimpleTemplateManager()
  convert()
}

function editTemplateVersion(version) {
  const fullVersion = templateVersions.value.find(v => v.id === version.id)
  if (fullVersion) {
    currentEditingTemplate.value = {...fullVersion}
    templateEditIsEditable.value = !fullVersion.isSystemDefault
    templateEditVisible.value = true
  }
}

function saveTemplateVersion(template) {
  if (!template.name) {
    NotifyUtil.warning('提示', '请输入版本名称')
    return
  }
  const success = simpleTemplateManager.upsertTemplateVersion(genType.value, template)
  if (!success) {
    NotifyUtil.error('保存失败', '模板版本保存失败')
    return
  }
  initTemplateVersions()
  NotifyUtil.success('成功', '模板保存成功')
  if (activeTemplateVersion.value === template.id) {
    simpleTemplateManager.switchTemplateVersion(genType.value, template.id)
  }
  convert()
}

function getClearTemplateCacheConfirmContent() {
  const hasCustomTemplates = checkForCustomTemplates()
  let confirmContent = '确定要清除所有模板缓存数据吗？'
  if (hasCustomTemplates) confirmContent += ' 检测到您有自定义模板，建议先到模板管理页面导出备份后再执行此操作。'
  return confirmContent
}

function checkForCustomTemplates() {
  try {
    const savedVersions = localStorage.getItem('templateVersionsByType')
    if (savedVersions) {
      const templateVersions = JSON.parse(savedVersions)
      for (const templateType in templateVersions) {
        const versions = templateVersions[templateType]
        if (versions && versions.length > 0 && versions.some(v => v.id && !v.id.startsWith(SYSTEM_TEMPLATE_PREFIX))) return true
      }
    }
  } catch (error) {
    console.error('检查自定义模板失败:', error)
  }
  return false
}

function performClearCache() {
  try {
    localStorage.removeItem('templateVersionsByType')
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(ACTIVE_TEMPLATE_VERSION_PREFIX)) localStorage.removeItem(key)
    }
    initTemplateVersions()
    convert()
    NotifyUtil.success('成功', '模板缓存已清除')
  } catch (error) {
    console.error('清除缓存失败:', error)
    NotifyUtil.error('清除失败', '清除模板缓存时发生错误: ' + error.message)
  }
}

onMounted(async () => {
  await initSimpleTemplateManager()
  loadGenerationConfig()
  initTemplateVersions()
})

onBeforeUnmount(() => {
  debouncedNotify.cancel()
  debouncedConvertFromInput.cancel()
})
</script>

<style scoped>
@import '@/css/codeGenerator.scss';
</style>
