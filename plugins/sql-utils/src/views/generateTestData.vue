<template>
  <div class="app">
    <div class="gtdTop">
      <n-space :size="8" :wrap="true">
        <n-button-group v-for="category in fieldTypes" :key="category.type">
          <n-button size="small" disabled>{{ category.type }}</n-button>
          <n-button v-for="field in category.fields" :key="field.label" size="small" @click="addField(field)">
            {{ field.label }}
          </n-button>
        </n-button-group>
      </n-space>
    </div>

    <div class="gtdMiddle">
      <n-space :size="8" align="center" style="margin-top: 10px">
        <span>生成数量</span>
        <n-input-number v-model:value="form.count" :min="1" :max="2000" size="small" />
        <n-button type="primary" size="small" @click="generateData">生成</n-button>
        <n-button v-if="activeTab === 'table'" type="primary" size="small" @click="copyAsTVS">
          复制
          <n-tooltip trigger="hover" placement="bottom">
            <template #trigger>
              <n-icon class="copy-header-icon" @click.stop="toggleIncludeHeader">
                <Icon :icon="includeHeaderInCopy ? 'icon-park-outline:check-one' : 'icon-park-outline:close-one'" />
              </n-icon>
            </template>
            {{ includeHeaderInCopy ? '复制结果包含表头（点击切换）' : '复制结果不含表头（点击切换）' }}
          </n-tooltip>
        </n-button>
        <n-button v-if="activeTab === 'table'" type="primary" size="small" @click="copyAsSQL">复制为SQL</n-button>
        <n-button v-if="activeTab === 'table'" type="primary" size="small" @click="copyAsJSON">复制为JSON</n-button>
        <n-button size="small" @click="clearData">清空</n-button>
      </n-space>
    </div>

    <div class="gtdBottom" ref="gtdBottomRef">
      <n-tabs v-if="form.fields.length > 0" v-model:value="activeTab" type="line" class="content-tabs">
        <n-tab-pane name="config" tab="字段配置">
          <div class="field-cards-container">
            <div class="field-list">
              <n-card v-for="(field, index) in form.fields" :key="field.id" size="small" class="field-card">
                <template #header>
                  <div class="field-header">
                    <div class="field-info">
                      <span class="field-index">{{ index + 1 }}.</span>
                      <n-tag size="small" :bordered="false">{{ field.type }}</n-tag>
                    </div>
                    <n-input v-model:value="field.name" size="small" :placeholder="`[${field.type}]请输入字段名`" class="field-name-input" />
                    <n-button text type="error" size="small" @click="removeField(field.id)">
                      <template #icon><n-icon><Icon icon="icon-park-outline:close" /></n-icon></template>
                    </n-button>
                  </div>
                </template>
                <div class="field-card-body">
                  <div v-if="field.configs && (showConfigButtonTypes.includes(field.type) || field.type === '图片' || field.type === '头像')" class="field-configs">
                    <div v-if="field.type === '整数' || field.type === '小数'" class="config-row">
                      <div class="config-item">
                        <label>最小值</label>
                        <n-input-number v-model:value="field.configs.min" size="small" :controls="false" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>最大值</label>
                        <n-input-number v-model:value="field.configs.max" size="small" :controls="false" style="width: 100%" />
                      </div>
                      <div v-if="field.type === '小数'" class="config-item">
                        <label>小数位</label>
                        <n-input-number v-model:value="field.configs.fractionDigits" size="small" :controls="false" :min="0" :max="10" style="width: 100%" />
                      </div>
                    </div>

                    <div v-if="field.type === '文字'" class="config-row">
                      <div class="config-item">
                        <label>最少字数</label>
                        <n-input-number v-model:value="field.configs.minLength" size="small" :controls="false" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>最大字数</label>
                        <n-input-number v-model:value="field.configs.maxLength" size="small" :controls="false" style="width: 100%" />
                      </div>
                    </div>

                    <div v-if="['日期','时间戳'].includes(field.type)" class="config-row">
                      <div class="config-item full-width">
                        <label>类型</label>
                        <n-radio-group v-model:value="field.configs.dateType" size="small">
                          <n-radio-button value="date">日期</n-radio-button>
                          <n-radio-button value="datetime">日期时间</n-radio-button>
                        </n-radio-group>
                      </div>
                      <div class="config-item full-width">
                        <label>开始日期</label>
                        <n-date-picker v-model:formatted-value="field.configs.startDate" :type="field.configs.dateType === 'date' ? 'date' : 'datetime'" size="small" style="width: 100%" :format="field.configs.dateType === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss'" value-format="yyyy-MM-dd HH:mm:ss" clearable />
                      </div>
                      <div class="config-item full-width">
                        <label>结束日期</label>
                        <n-date-picker v-model:formatted-value="field.configs.endDate" :type="field.configs.dateType === 'date' ? 'date' : 'datetime'" size="small" style="width: 100%" :format="field.configs.dateType === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss'" value-format="yyyy-MM-dd HH:mm:ss" clearable />
                      </div>
                    </div>

                    <div v-if="field.type === '编码'" class="config-row">
                      <div class="config-item">
                        <label>前缀</label>
                        <n-input v-model:value="field.configs.prefix" size="small" placeholder="前缀" />
                      </div>
                      <div class="config-item">
                        <label>起始值</label>
                        <n-input-number v-model:value="field.configs.initVal" size="small" :controls="false" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>步长</label>
                        <n-input-number v-model:value="field.configs.step" size="small" :controls="false" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>序号长度</label>
                        <n-input-number v-model:value="field.configs.sequenceLength" size="small" :controls="false" :min="1" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>日期格式</label>
                        <n-select v-model:value="field.configs.dateFormat" size="small" :options="[{label:'无日期',value:''},{label:'yyyyMM',value:'yyyyMM'},{label:'yyyyMMdd',value:'yyyyMMdd'}]" style="width: 100%" />
                      </div>
                      <div class="config-item">
                        <label>分隔符</label>
                        <n-select v-model:value="field.configs.delimiter" size="small" :options="[{label:'无分隔符',value:''},{label:'-',value:'-'},{label:'_',value:'_'},{label:'/',value:'/'},{label:'.',value:'.'}]" style="width: 100%" />
                      </div>
                    </div>

                    <div v-if="field.type === '枚举'" class="config-row">
                      <div class="config-item full-width">
                        <label>枚举值</label>
                        <n-input v-model:value="field.configs.enumValues" type="textarea" :rows="3" size="small" placeholder="多个枚举值用英文逗号隔开，每行一个或多个" />
                      </div>
                    </div>

                    <div v-if="field.type === 'UUID'" class="config-row">
                      <div class="config-item">
                        <n-checkbox v-model:checked="field.configs.uppercase">大写</n-checkbox>
                      </div>
                      <div class="config-item">
                        <n-checkbox v-model:checked="field.configs.delimiter">保留分隔符</n-checkbox>
                      </div>
                    </div>

                    <div v-if="field.type === '随机字符'" class="config-row">
                      <div class="config-item">
                        <label>字符长度</label>
                        <n-input-number v-model:value="field.configs.length" size="small" :controls="false" :min="1" :max="50" style="width: 100%" />
                      </div>
                      <div class="config-item full-width">
                        <label>字符源</label>
                        <n-checkbox-group v-model:value="field.configs.strSource" size="small">
                          <n-space :size="8">
                            <n-checkbox value="digit">数字</n-checkbox>
                            <n-checkbox value="upperLetter">大写字母</n-checkbox>
                            <n-checkbox value="lowerLetter">小写字母</n-checkbox>
                            <n-checkbox value="punctuation">标点符号</n-checkbox>
                          </n-space>
                        </n-checkbox-group>
                      </div>
                      <div v-if="field.configs.strSource.includes('punctuation')" class="config-item full-width">
                        <label>标点符号字符</label>
                        <n-input v-model:value="field.configs.punctuationChars" size="small" placeholder="请输入标点符号" />
                      </div>
                    </div>

                    <div v-if="field.type === '图片' || field.type === '头像'" class="config-row">
                      <div class="config-item full-width">
                        <label>显示模式</label>
                        <n-radio-group v-model:value="field.configs.displayMode" size="small">
                          <n-radio-button value="URL">URL</n-radio-button>
                          <n-radio-button value="预览">预览</n-radio-button>
                        </n-radio-group>
                      </div>
                    </div>
                  </div>
                </div>
              </n-card>
            </div>
          </div>
        </n-tab-pane>
        <n-tab-pane name="table" tab="数据表格">
          <div class="table-wrapper">
            <div class="table-container">
              <vxe-table
                ref="dataTableRef"
                border
                :data="pagedData"
                size="mini"
                height="100%"
                :column-config="{ drag: true }"
                :seq-config="{ startIndex: (currentPage - 1) * pageSize }"
                @column-dragend="handleColumnDragend"
              >
                <vxe-column type="seq" title="#" width="50" fixed="left"></vxe-column>
                <vxe-column v-for="field in form.fields" :key="field.id" :field="field.id" :title="field.name">
                  <template #default="{ row }">
                    <div v-if="(field.type === '图片' || field.type === '头像') && field.configs && field.configs.displayMode !== 'URL'">
                      <n-image width="100" height="100" :src="row[field.id]" />
                    </div>
                    <div v-else>{{ row[field.id] }}</div>
                  </template>
                </vxe-column>
              </vxe-table>
            </div>
            <n-pagination
              size="small"
              :page="currentPage"
              :page-size="pageSize"
              :page-sizes="[20, 50, 100, 200]"
              :item-count="generatedData.length"
              show-size-picker
              @update:page="currentPage = $event"
              @update:page-size="handleSizeChange"
            >
              <template #prefix="{ itemCount }">共 {{ itemCount }} 条</template>
            </n-pagination>
          </div>
        </n-tab-pane>
      </n-tabs>

      <div v-if="form.fields.length === 0" class="field-cards-container">
        <div class="empty-state">
          <n-icon size="48"><Icon icon="icon-park-outline:info" /></n-icon>
          <p>请在上方选择字段，配置完成后点击「生成」按钮生成测试数据</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { fakerZH_CN as faker } from '@faker-js/faker'
import dayjs from 'dayjs'
import { Icon } from '@iconify/vue'
import NotifyUtil from '@/utils/notifyUtil.js'
import * as dateTimeUtil from '@/utils/dateTimeUtil.js'
import * as randomData from '@/utils/getRandomData.js'

const gtdBottomRef = ref(null)
const dataTableRef = ref(null)
const activeTab = ref('config')
const includeHeaderInCopy = ref(true)
const currentPage = ref(1)
const pageSize = ref(50)
const generatedData = ref([])

const form = reactive({
  fields: [],
  count: 1
})

const showConfigButtonTypes = ['整数', '小数', '日期', '编码', '枚举', '时间戳', '文字', 'UUID', '随机字符']

const fieldTypes = [
  {
    type: '常规',
    fields: [
      { label: '编码', configs: { prefix: 'NO', initVal: 1, step: 1, sequenceLength: 3, dateFormat: '', delimiter: '' } },
      { label: '整数', configs: { min: 1, max: 99999 } },
      { label: '小数', configs: { min: 1, max: 99999, fractionDigits: 2 } },
      { label: '日期', configs: { dateType: 'date', startDate: dayjs().hour(0).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss'), endDate: dayjs().add(7, 'day').hour(23).minute(59).second(59).format('YYYY-MM-DD HH:mm:ss') } },
      { label: '时间戳', configs: { dateType: 'date', startDate: dayjs().hour(0).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss'), endDate: dayjs().add(7, 'day').hour(23).minute(59).second(59).format('YYYY-MM-DD HH:mm:ss') } },
      { label: '枚举', configs: { enumValues: '' } },
      { label: '文字', configs: { minLength: 15, maxLength: 50 } },
      { label: '随机字符', configs: { length: 8, strSource: ['digit', 'upperLetter', 'lowerLetter', 'punctuation'], punctuationChars: '!@#$' } },
      { label: 'UUID', configs: { uppercase: true, delimiter: true } },
      { label: '分布式ID', configs: {} }
    ]
  },
  {
    type: '人员',
    fields: [
      { label: '姓名', configs: {} },
      { label: '身份证', configs: {} },
      { label: '手机号', configs: {} },
      { label: '邮箱', configs: {} }
    ]
  },
  {
    type: '位置',
    fields: [
      { label: '省份', configs: {} },
      { label: '城市', configs: {} },
      { label: '区县', configs: {} },
      { label: '地址', configs: {} }
    ]
  },
  {
    type: '图像',
    fields: [
      { label: '图片', configs: { displayMode: 'URL' } },
      { label: '头像', configs: { displayMode: 'URL' } }
    ]
  },
  {
    type: '网络',
    fields: [
      { label: 'ip地址', configs: {} },
      { label: '网址', configs: {} },
      { label: '密码', configs: {} },
      { label: 'emoji', configs: {} }
    ]
  },
  {
    type: '商业',
    fields: [
      { label: '公司名称', configs: {} },
      { label: '商品品类', configs: {} },
      { label: '商品名', configs: {} },
      { label: '商品标题', configs: {} },
      { label: '货币代码', configs: {} },
      { label: '信用代码', configs: {} }
    ]
  }
]

const pagedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return generatedData.value.slice(start, end)
})

function addField(field) {
  const newField = {
    id: `field_${Date.now()}`,
    name: field.label,
    type: field.label,
    configs: field.configs ? JSON.parse(JSON.stringify(field.configs)) : undefined
  }
  form.fields.push(newField)
  if (activeTab.value === 'table') activeTab.value = 'config'
}

function removeField(id) {
  const idx = form.fields.findIndex(f => f.id === id)
  if (idx !== -1) form.fields.splice(idx, 1)
  if (form.fields.length === 0) {
    activeTab.value = 'config'
    generatedData.value = []
  }
}

function generateDataForField(field, index, rowContext = {}) {
  switch (field.type) {
    case '编码': return randomData.getCode(field.configs.prefix, field.configs.initVal, field.configs.step, field.configs.dateFormat, field.configs.delimiter, field.configs.sequenceLength, index)
    case '整数': return randomData.getNumber(field.configs.min, field.configs.max)
    case '小数': return randomData.getDecimal(field.configs.min, field.configs.max, field.configs.fractionDigits)
    case '日期': return dateTimeUtil.randomDate(field.configs.startDate, field.configs.endDate, field.configs.dateType === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss')
    case '时间戳': return dateTimeUtil.randomTimestamp(field.configs.startDate, field.configs.endDate)
    case '枚举': return randomData.getEnumValue(field.configs.enumValues)
    case '文字': return randomData.getChineseParagrap(field.configs.minLength, field.configs.maxLength)
    case '随机字符': return randomData.getStrByArrConfig(field.configs.length, field.configs.strSource, field.configs.punctuationChars)
    case 'UUID': return randomData.getUUID(field.configs.uppercase, field.configs.delimiter)
    case '分布式ID': return randomData.getDistributedId()
    case '姓名': return randomData.getPersonName()
    case '身份证': return randomData.getIdCard()
    case '手机号': return randomData.getChineseMobile()
    case '邮箱': return randomData.getEmail()
    case '省份': return rowContext.location?.province ?? randomData.getProvince()
    case '城市': return rowContext.location?.city ?? randomData.getCity()
    case '区县': return rowContext.location?.area ?? randomData.getArea()
    case '地址': return rowContext.location?.address ?? randomData.getAddress()
    case '图片': return randomData.getImageUrl()
    case '头像': return randomData.getAvatarUrl()
    case 'ip地址': return faker.internet.ipv4()
    case '网址': return faker.internet.url()
    case '密码': return faker.internet.password()
    case 'emoji': return faker.internet.emoji()
    case '公司名称': return faker.company.name()
    case '商品品类': return faker.commerce.department()
    case '商品名': return faker.commerce.productName()
    case '商品标题': return faker.commerce.productDescription()
    case '货币代码': return faker.finance.currencyCode()
    case '信用代码': return randomData.getCreditCode()
    default: return ''
  }
}

async function generateData() {
  if (!form.fields.length) {
    NotifyUtil.warning('请先添加字段')
    return
  }
  const hasImageField = form.fields.some(field => field.type === '图片')
  if (hasImageField) {
    await randomData.getImageUrlAsync()
  }
  generatedData.value = []
  currentPage.value = 1
  for (let i = 0; i < form.count; i++) {
    const row = {}
    const hasLocationField = form.fields.some(field => ['省份', '城市', '区县', '地址'].includes(field.type))
    const rowContext = {
      location: hasLocationField ? randomData.getLocationContext() : undefined
    }
    form.fields.forEach(field => {
      row[field.id] = generateDataForField(field, i, rowContext)
    })
    generatedData.value.push(row)
  }
  activeTab.value = 'table'
}

function copyAsTVS() {
  const csvRows = []
  const currentFields = form.fields
  if (includeHeaderInCopy.value) {
    csvRows.push(currentFields.map(field => field.name).join('\t'))
  }
  generatedData.value.forEach(row => {
    csvRows.push(currentFields.map(field => row[field.id]).join('\t'))
  })
  copyToClipboard(csvRows.join('\n'))
}

function toSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function copyAsSQL() {
  const tableName = 'tableName'
  const currentFields = form.fields
  const cols = currentFields.map(field => field.name).join(', ')
  const batchSize = 500
  const sqlStatements = []
  for (let i = 0; i < generatedData.value.length; i += batchSize) {
    const batch = generatedData.value.slice(i, i + batchSize)
    const valuesList = batch.map(row => {
      const values = currentFields.map(field => toSqlString(row[field.id])).join(', ')
      return `(${values})`
    })
    sqlStatements.push(`INSERT INTO ${tableName} (${cols}) VALUES\n${valuesList.join(',\n')};`)
  }
  copyToClipboard(sqlStatements.join('\n'))
}

function copyAsJSON() {
  const jsonData = generatedData.value.map(row => {
    const jsonObject = {}
    form.fields.forEach(field => { jsonObject[field.name] = row[field.id] })
    return jsonObject
  })
  copyToClipboard(JSON.stringify(jsonData, null, 2))
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    NotifyUtil.success('内容已复制到剪贴板')
  }).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    NotifyUtil.success('内容已复制到剪贴板')
  })
}

function handleColumnDragend() {
  const $table = dataTableRef.value
  if (!$table) return
  const { collectColumn } = $table.getTableColumn()
  const fieldIds = collectColumn
    .filter(col => col.field)
    .map(col => col.field)
  const reordered = []
  fieldIds.forEach(id => {
    const field = form.fields.find(f => f.id === id)
    if (field) reordered.push(field)
  })
  if (reordered.length === form.fields.length) {
    form.fields.splice(0, form.fields.length, ...reordered)
  }
}

function clearData() {
  form.fields = []
  generatedData.value = []
  currentPage.value = 1
  activeTab.value = 'config'
}

function toggleIncludeHeader() {
  includeHeaderInCopy.value = !includeHeaderInCopy.value
}

function handleSizeChange(val) {
  pageSize.value = val
  currentPage.value = 1
}
</script>

<style scoped>
.gtdTop {
  position: relative;
}

.gtdMiddle {
  flex: 0 0 auto;
}

.gtdBottom {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.field-cards-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.field-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
  gap: 15px;
  min-height: 100px;
  width: 100%;
}

.field-card {
  min-width: 0;
  word-wrap: break-word;
  transition: all 0.3s ease;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.field-info {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.field-index {
  font-weight: 600;
  color: #606266;
  font-size: 12px;
  min-width: 18px;
}

.field-name-input {
  flex: 1;
}

.field-card-body {
  min-height: 0;
  overflow: visible;
}

.config-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  grid-column: 1 / -1;
  margin-bottom: 8px;
}

.config-row:last-child {
  margin-bottom: 0;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.config-item label {
  font-size: 12px;
  color: #606266;
  font-weight: 500;
}

.config-item.full-width {
  grid-column: 1 / -1;
}

.content-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.table-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 10px;
}

.table-container {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
}

.empty-state p {
  margin: 16px 0 0;
  font-size: 14px;
}

.copy-header-icon {
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  transform-origin: center;
  margin-left: 3px;
}

.copy-header-icon:hover {
  transform: scale(1.5);
}
</style>
