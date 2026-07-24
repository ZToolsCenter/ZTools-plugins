<template>
  <n-drawer :show="visible" :width="'85%'" placement="right" @update:show="handleShowUpdate">
    <n-drawer-content :title="drawerTitle">
      <div class="drawer-container" v-if="currentTemplate">
        <div class="drawer-header" v-if="!currentTemplate.isSystemDefault">
          <n-form :model="currentTemplate" label-placement="left" label-width="100">
            <n-form-item label="版本名称">
              <n-input v-model:value="currentTemplate.name" placeholder="请输入版本名称" :disabled="!isEditMode" />
            </n-form-item>
          </n-form>
        </div>

        <div class="drawer-content">
          <div class="editor-section">
            <div class="section-title">模板代码</div>
            <div class="template-editor">
              <CodeEditor ref="codeEditorRef" v-model="currentTemplate.content" :mode="editorMode" :readonly="!isEditMode" @change="onEditorInput" />
            </div>
          </div>

          <div class="help-section">
            <div class="section-title">可用变量说明</div>
            <div class="variables-table-container">
              <vxe-table :data="templateVariables" border height="100%" size="mini" :row-config="{ keyField: 'id' }" :tree-config="{ childrenField: 'children', expandAll: true }">
                <vxe-column field="variable" title="变量名" tree-node width="150"/>
                <vxe-column field="description" title="说明" />
                <vxe-column field="type" title="类型" />
                <vxe-column field="example" title="示例"  />
              </vxe-table>
            </div>
          </div>
        </div>

        <div class="drawer-footer">
          <n-space>
            <n-button v-if="!isEditMode" @click="closeDrawer">关闭</n-button>
            <template v-else>
              <n-button type="primary" @click="saveTemplate">保存</n-button>
              <n-button @click="closeDrawer">取消</n-button>
            </template>
          </n-space>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  template: { type: Object, default: () => ({}) },
  isEdit: { type: Boolean, default: false },
  editorMode: { type: String, default: 'handlebars' }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

const currentTemplate = ref(null)
const codeEditorRef = ref(null)

const drawerTitle = computed(() => props.isEdit ? '编辑模板版本' : '查看模板版本')
const isEditMode = computed(() => props.isEdit)

const templateVariables = [
  {
    id: 'package', variable: '包名相关', description: '包名相关变量', type: 'Object', example: '',
    children: [
      { id: 'package.fullPackage', variable: '{{fullPackage}}', description: '完整包名', type: 'String', example: 'com.example.system' },
      { id: 'package.basePackage', variable: '{{basePackage}}', description: '基础包名', type: 'String', example: 'com.example' },
      { id: 'package.subPackage', variable: '{{subPackage}}', description: '二级包名', type: 'String', example: 'system' }
    ]
  },
  {
    id: 'table', variable: 'tableInfo', description: '表信息对象', type: 'Object', example: '',
    children: [
      { id: 'table.tableName', variable: '{{tableName}}', description: '数据库表名', type: 'String', example: 'user_info' },
      { id: 'table.tableComment', variable: '{{tableComment}}', description: '表注释', type: 'String', example: '用户信息表' },
      { id: 'table.imports', variable: '{{imports}}', description: '导入语句', type: 'String', example: 'import java.util.Date;' },
      {
        id: 'table.fields', variable: '{{fields}}', description: '字段列表数组', type: 'Array', example: '字段对象数组',
        children: [
          { id: 'field.fieldName', variable: '{{fieldName}}', description: '数据库字段名', type: 'String', example: 'user_name' },
          { id: 'field.camelFieldName', variable: '{{camelFieldName}}', description: '驼峰命名字段名', type: 'String', example: 'userName' },
          { id: 'field.comment', variable: '{{comment}}', description: '字段注释', type: 'String', example: '这是注释' },
          { id: 'field.javaType', variable: '{{javaType}}', description: 'Java字段类型', type: 'String', example: 'String' },
          { id: 'field.isPrimaryKey', variable: '{{isPrimaryKey}}', description: '是否为主键字段', type: 'Boolean', example: 'true/false' }
        ]
      }
    ]
  },
  {
    id: 'common', variable: '通用变量', description: '通用变量', type: 'Object', example: '',
    children: [
      { id: 'common.upperCamelTableName', variable: '{{upperCamelTableName}}', description: '大驼峰表名', type: 'String', example: 'UserInfo' },
      { id: 'common.lowerCamelTableName', variable: '{{lowerCamelTableName}}', description: '小驼峰表名', type: 'String', example: 'userInfo' },
      { id: 'common.author', variable: '{{author}}', description: '作者信息', type: 'String', example: '张三' },
      { id: 'common.currentDate', variable: '{{currentDate}}', description: '当前日期', type: 'String', example: '2024/1/1' },
      { id: 'common.mapperFullName', variable: '{{mapperFullName}}', description: 'Mapper类完整名', type: 'String', example: 'com.example.mapper.UserInfoMapper' }
    ]
  },
  {
    id: 'options', variable: '生成选项', description: '代码生成选项', type: 'Object', example: '',
    children: [
      { id: 'options.genComment', variable: '{{genComment}}', description: '是否生成注释', type: 'Boolean', example: 'true/false' },
      { id: 'options.genLombok', variable: '{{genLombok}}', description: '是否生成Lombok注解', type: 'Boolean', example: 'true/false' },
      { id: 'options.genSwagger', variable: '{{genSwagger}}', description: '是否生成Swagger注解', type: 'Boolean', example: 'true/false' }
    ]
  }
]

watch(() => props.template, (newVal) => {
  if (newVal) currentTemplate.value = { ...newVal }
}, { immediate: true, deep: true })

function handleShowUpdate(val) {
  emit('update:visible', val)
}

function closeDrawer() {
  emit('update:visible', false)
  emit('close')
}

function saveTemplate() {
  if (!currentTemplate.value.name) {
    return
  }
  emit('save', { ...currentTemplate.value })
}

function onEditorInput(value) {
  if (currentTemplate.value) currentTemplate.value.content = value
}
</script>

<style scoped>
.drawer-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drawer-content {
  flex: 1;
  display: flex;
  padding: 20px;
  gap: 20px;
  overflow: hidden;
}

.editor-section {
  flex: 5.5;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.help-section {
  flex: 4.5;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.template-editor {
  flex: 1;
  border-radius: 4px;
  overflow: hidden;
}

.variables-table-container {
  flex: 1;
  border-radius: 4px;
  overflow: hidden;
}

.drawer-footer {
  padding: 10px;
  text-align: left;
}
</style>
