<template>
  <n-drawer :show="visible" :width="'40%'" placement="right" @update:show="handleShowUpdate">
    <n-drawer-content title="Java与MySQL类型映射配置">
      <div class="type-mapping-drawer">
        <div class="mapping-header">
          <n-space :size="8">
            <n-button type="primary" size="small" @click="addMapping">添加映射</n-button>
            <n-popconfirm @positive-click="resetToDefault">
              <template #trigger>
                <n-button size="small">恢复默认</n-button>
              </template>
              确定要恢复默认映射吗？这将覆盖所有自定义配置。
            </n-popconfirm>
          </n-space>
        </div>

        <div class="table-container">
          <vxe-table :data="typeMappings" border height="100%">
            <vxe-column field="mysqlType" title="MySQL类型">
              <template #default="{ row }">
                <n-input v-if="row.editing" v-model:value="row.mysqlType" size="small" />
                <span v-else>{{ row.mysqlType }}</span>
              </template>
            </vxe-column>
            <vxe-column field="javaType" title="Java类型">
              <template #default="{ row }">
                <n-select v-if="row.editing" v-model:value="row.javaType" size="small" :options="flatJavaTypeOptions" placeholder="请选择Java类型" />
                <span v-else>{{ row.javaType }}</span>
              </template>
            </vxe-column>
            <vxe-column field="description" title="描述">
              <template #default="{ row }">
                <n-input v-if="row.editing" v-model:value="row.description" size="small" />
                <span v-else>{{ row.description }}</span>
              </template>
            </vxe-column>
            <vxe-column title="操作" width="100">
              <template #default="{ row, $rowIndex }">
                <n-space :size="4">
                  <n-button v-if="!row.editing" type="primary" size="tiny" @click="editMapping($rowIndex)">编辑</n-button>
                  <n-button v-if="row.editing" type="success" size="tiny" @click="saveMapping($rowIndex)">保存</n-button>
                  <n-button v-if="row.editing" size="tiny" @click="cancelEdit($rowIndex)">取消</n-button>
                  <n-popconfirm v-if="!row.editing" @positive-click="deleteMapping($rowIndex)">
                    <template #trigger>
                      <n-button type="error" size="tiny">删除</n-button>
                    </template>
                    确定要删除这个映射吗？
                  </n-popconfirm>
                </n-space>
              </template>
            </vxe-column>
          </vxe-table>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import NotifyUtil from '@/utils/notifyUtil.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible', 'saved'])

const typeMappings = ref([])
const originalMappings = ref([])

const javaTypeGroups = [
  { label: '数值类型', options: [{ value: 'Integer', label: 'Integer' }, { value: 'Long', label: 'Long' }, { value: 'Float', label: 'Float' }, { value: 'Double', label: 'Double' }, { value: 'BigDecimal', label: 'BigDecimal' }, { value: 'Short', label: 'Short' }, { value: 'Byte', label: 'Byte' }] },
  { label: '字符串类型', options: [{ value: 'String', label: 'String' }, { value: 'Character', label: 'Character' }] },
  { label: '日期时间类型', options: [{ value: 'Date', label: 'Date' }, { value: 'LocalDate', label: 'LocalDate' }, { value: 'LocalDateTime', label: 'LocalDateTime' }, { value: 'LocalTime', label: 'LocalTime' }, { value: 'Timestamp', label: 'Timestamp' }, { value: 'Calendar', label: 'Calendar' }] },
  { label: '布尔类型', options: [{ value: 'Boolean', label: 'Boolean' }] },
  { label: '二进制类型', options: [{ value: 'byte[]', label: 'byte[]' }, { value: 'Blob', label: 'Blob' }] },
  { label: '其他类型', options: [{ value: 'Object', label: 'Object' }, { value: 'Map', label: 'Map' }, { value: 'List', label: 'List' }] }
]

const flatJavaTypeOptions = computed(() => {
  return javaTypeGroups.flatMap(group => group.options)
})

const defaultTypeMappings = [
  { mysqlType: 'int', javaType: 'Integer', description: '整数类型' },
  { mysqlType: 'tinyint', javaType: 'Integer', description: '微小整数类型' },
  { mysqlType: 'bigint', javaType: 'Long', description: '大整数类型' },
  { mysqlType: 'float', javaType: 'Float', description: '单精度浮点数' },
  { mysqlType: 'double', javaType: 'Double', description: '双精度浮点数' },
  { mysqlType: 'decimal', javaType: 'BigDecimal', description: '高精度小数' },
  { mysqlType: 'varchar', javaType: 'String', description: '可变长度字符串' },
  { mysqlType: 'char', javaType: 'String', description: '固定长度字符串' },
  { mysqlType: 'text', javaType: 'String', description: '长文本' },
  { mysqlType: 'longtext', javaType: 'String', description: '超长文本' },
  { mysqlType: 'date', javaType: 'LocalDate', description: '日期类型' },
  { mysqlType: 'datetime', javaType: 'LocalDateTime', description: '日期时间类型' },
  { mysqlType: 'timestamp', javaType: 'LocalDateTime', description: '时间戳类型' }
]

watch(() => props.visible, (newVal) => {
  if (newVal) loadMappings()
})

function handleShowUpdate(val) {
  emit('update:visible', val)
}

function loadMappings() {
  const savedMappings = localStorage.getItem('typeMappings')
  if (savedMappings) {
    try { typeMappings.value = JSON.parse(savedMappings) } catch (e) { typeMappings.value = [...defaultTypeMappings] }
  } else {
    typeMappings.value = [...defaultTypeMappings]
  }
  originalMappings.value = JSON.parse(JSON.stringify(typeMappings.value))
}

function addMapping() {
  typeMappings.value.push({ mysqlType: '', javaType: '', description: '', editing: true })
}

function editMapping(index) {
  typeMappings.value[index].editing = true
  typeMappings.value[index].originalValue = { mysqlType: typeMappings.value[index].mysqlType, javaType: typeMappings.value[index].javaType, description: typeMappings.value[index].description }
}

function saveMapping(index) {
  if (!typeMappings.value[index].mysqlType || !typeMappings.value[index].javaType) {
    NotifyUtil.error('错误', 'MySQL类型和Java类型不能为空')
    return
  }
  delete typeMappings.value[index].editing
  delete typeMappings.value[index].originalValue
  saveCurrentMappings()
}

function cancelEdit(index) {
  if (typeMappings.value[index].originalValue) {
    Object.assign(typeMappings.value[index], typeMappings.value[index].originalValue)
    delete typeMappings.value[index].originalValue
  } else {
    typeMappings.value.splice(index, 1)
  }
  delete typeMappings.value[index].editing
}

function deleteMapping(index) {
  typeMappings.value.splice(index, 1)
  NotifyUtil.success('删除成功')
  saveCurrentMappings()
}

function resetToDefault() {
  typeMappings.value = [...defaultTypeMappings]
  saveCurrentMappings()
  NotifyUtil.success('已恢复默认映射')
}

function saveCurrentMappings() {
  for (let i = 0; i < typeMappings.value.length; i++) {
    if (!typeMappings.value[i].mysqlType || !typeMappings.value[i].javaType) {
      NotifyUtil.error('错误', `第 ${i + 1} 行的MySQL类型和Java类型不能为空`)
      return false
    }
  }
  localStorage.setItem('typeMappings', JSON.stringify(typeMappings.value))
  originalMappings.value = JSON.parse(JSON.stringify(typeMappings.value))
  emit('saved', typeMappings.value)
  NotifyUtil.success('保存成功')
  return true
}
</script>

<style scoped>
.type-mapping-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mapping-header {
  margin-bottom: 10px;
}

.table-container {
  flex: 1;
  overflow: hidden;
}
</style>
