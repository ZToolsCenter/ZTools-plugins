<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

// ====== 数据 ======
const surnames = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕', '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎']

const nameChars = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '艳', '勇', '军', '杰', '涛', '明', '超', '华', '慧', '文', '建', '丹', '平', '辉', '玲', '鑫', '浩', '飞', '雪', '婷', '波', '荣', '利', '莉', '刚', '亮', '凯', '俊', '鹏', '翔', '宇', '峰', '龙', '彬', '旭', '宁', '博', '毅', '琳', '璐']

const provinces = ['云梦省', '苍梧省', '落霞省', '碧水省', '青川省', '紫阳省', '玄武省', '赤峰省', '墨兰省', '银霜省', '鹤鸣省', '星河省', '凤栖省', '龙渊省', '玉华省', '天澜省', '霜华省', '风岚省', '雾隐省', '霞光省', '竹溪省', '雪岭省', '云海省', '松涛省', '柳岸省', '梅林省', '桃源省', '桂香省', '梧桐省', '榆木省', '枫林省', '桃源市']

const streets = ['锦云路', '望舒路', '听泉路', '映月路', '临风路', '栖霞路', '揽星路', '拂晓路', '沐光路', '听雨路', '望岳路', '凌云路', '逐梦路', '知行路', '崇文路', '尚德路', '致远路', '明志路', '思源路', '承恩路']

const emailDomains = ['starlink.com', 'cloudway.net', 'skymail.com', 'bluewind.net', 'moonbeam.com', 'sunrise.net', 'deepsea.com', 'lightpath.net']

const companyChars1 = ['星', '云', '月', '风', '雨', '雪', '霞', '虹', '雷', '雾', '霜', '露', '光', '影', '海', '山', '林', '泉', '石', '梦', '思', '志', '远', '达', '通', '盛', '泰', '昌', '祥', '瑞', '吉', '源', '润', '和', '美', '佳', '宏', '广', '高', '新']
const companyChars2 = ['辰', '辉', '耀', '翔', '腾', '宇', '飞', '鸿', '鹏', '凯', '达', '丰', '隆', '鑫', '华', '永', '恒', '兴', '旺', '盛', '昌', '昌', '隆', '顺', '利', '富', '强', '安', '康', '乐', '雅', '优', '秀', '卓', '伟', '毅', '刚', '豪', '杰']
const companySuffixes = ['科技有限公司', '信息技术有限公司', '电子商务有限公司', '文化传媒有限公司', '贸易有限公司', '投资有限公司', '咨询有限公司', '软件开发有限公司', '教育科技有限公司', '智能科技有限公司']

const jobs = ['软件工程师', '产品经理', '设计师', '运营经理', '销售经理', '人力资源专员', '财务主管', '市场总监', '项目经理', '数据分析师', '前端开发', '后端开发', '测试工程师', '运维工程师', '行政主管', '法务专员', '采购经理', '客服主管', '文案策划', '架构师']

const educations = ['大专', '本科', '硕士', '博士']
const bloodTypes = ['A', 'B', 'O', 'AB']
const maritalStatuses = ['未婚', '已婚', '离异']

// ====== 类型 ======
interface IdentityInfo {
  name: string
  gender: string
  age: number
  idCard: string
  phone: string
  address: string
  bankCard: string
  company: string
  job: string
  education: string
  bloodType: string
  maritalStatus: string
  height: number
  weight: number
  qq: string
  email: string
}

// ====== 响应式状态 ======
const identities = ref<IdentityInfo[]>([])
const count = ref(1)

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

// ====== 工具函数 ======
function pick<T>(arr: T[]): T {
  const rand = new Uint32Array(1)
  crypto.getRandomValues(rand)
  return arr[rand[0] % arr.length]
}

function randInt(min: number, max: number): number {
  const rand = new Uint32Array(1)
  crypto.getRandomValues(rand)
  return Math.floor(rand[0] % (max - min + 1)) + min
}

function randBool(): boolean {
  const rand = new Uint32Array(1)
  crypto.getRandomValues(rand)
  return rand[0] % 2 === 1
}

// ====== 身份证校验码计算 ======
const WEIGHT = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

function calcCheckCode(id17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id17[i]) * WEIGHT[i]
  }
  return CHECK_CODES[sum % 11]
}

// ====== 生成函数 ======
function generateOne(): IdentityInfo {
  const surname = pick(surnames)
  const nameLen = randBool() ? 2 : 1
  let name = ''
  for (let i = 0; i < nameLen; i++) {
    name += pick(nameChars)
  }
  const fullName = surname + name

  const gender: string = randBool() ? '男' : '女'
  const age = randInt(18, 60)
  const currentYear = new Date().getFullYear()
  const birthYear = currentYear - age

  // 地区码：使用真实的6位行政区划代码（简化为主要省市）
  const areaCodes = [
    '110000', '110101', '110105', '110106', '110107', '110108', '110109', '110111',
    '310000', '310101', '310104', '310105', '310106', '310107', '310109', '310110', '310112', '310113', '310114', '310115', '310116', '310117', '310118', '310120',
    '440100', '440103', '440104', '440105', '440106', '440111', '440112', '440113', '440114', '440115', '440116', '440117', '440118', '440119',
    '510100', '510104', '510105', '510106', '510107', '510108', '510112', '510113', '510114', '510115', '510116', '510117', '510118', '510119',
    '320100', '320102', '320104', '320105', '320106', '320111', '320113', '320114', '320115', '320116', '320117', '320118', '320119',
    '330100', '330102', '330103', '330104', '330105', '330106', '330108', '330109', '330110', '330111', '330112', '330113', '330114', '330115', '330116', '330122',
    '370100', '370102', '370103', '370104', '370105', '370112', '370113', '370114', '370115', '370124', '370125', '370126', '370127', '370128',
    '420100', '420102', '420103', '420104', '420105', '420106', '420107', '420111', '420112', '420113', '420114', '420115', '420116', '420117', '420118', '420119',
    '500000', '500101', '500102', '500103', '500104', '500105', '500106', '500107', '500108', '500109', '500110', '500111', '500112', '500113', '500114', '500115', '500116', '500117',
    '610100', '610102', '610103', '610104', '610111', '610112', '610113', '610114', '610115', '610116', '610117', '610118', '610119', '610122', '610124', '610125', '610126', '610127', '610128', '610129', '610130', '610131', '610132', '610133', '610134',
    '130100', '130102', '130103', '130104', '130105', '130107', '130108', '130121', '130123', '130124', '130125', '130126', '130127', '130128', '130129', '130130', '130131', '130132', '130133', '130134', '130135', '130136', '130181', '130182', '130183', '130184', '130185',
    '410100', '410102', '410103', '410104', '410105', '410106', '410108', '410122', '410123', '410125', '410126', '410127', '410128', '410181', '410182', '410183', '410184', '410185', '410188',
    '210100', '210102', '210103', '210104', '210111', '210112', '210113', '210114', '210115', '210123', '210124', '210181', '210182', '210183', '210184', '210185', '210200', '210202', '210203', '210204', '210211', '210212', '210213', '210224', '210281', '210283', '210302', '210303', '210304', '210311',
    '440300', '440303', '440306', '440307', '440308', '440309', '440310', '440311', '440320', '440321', '440323', '440326', '440400', '440402', '440403', '440404', '440500', '440507', '440511', '440512', '440513', '440514', '440515', '440516', '440518', '440523',
    '350100', '350102', '350103', '350104', '350105', '350111', '350112', '350113', '350121', '350122', '350123', '350124', '350125', '350181', '350182', '350183', '350184', '350185',
  ]
  const areaCode = pick(areaCodes)

  // 出生日期：确保日期有效
  const month = randInt(1, 12)
  const maxDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  const day = randInt(1, (month === 2 && ((birthYear % 4 === 0 && birthYear % 100 !== 0) || birthYear % 400 === 0)) ? 29 : maxDay)
  const birthDate = String(birthYear) + String(month).padStart(2, '0') + String(day).padStart(2, '0')

  // 顺序码：奇数男，偶数女
  let seq = randInt(0, 999)
  if (gender === '男') {
    seq = seq % 2 === 0 ? seq + 1 : seq
  } else {
    seq = seq % 2 === 1 ? seq + 1 : seq
  }
  const seqCode = String(seq).padStart(3, '0')

  // 组装前17位并计算校验码
  const id17 = areaCode + birthDate + seqCode
  const checkCode = calcCheckCode(id17)
  const idCard = id17 + checkCode

  const fakePhonePrefixes = ['190', '191', '192', '193', '194', '195', '196', '199']
  const phone = pick(fakePhonePrefixes) + String(randInt(0, 99999999)).padStart(8, '0')

  const address = `${pick(provinces)}${randInt(1, 9)}号${pick(streets)}${randInt(1, 200)}号${randInt(101, 300)}室`

  let bankCard = '62'
  for (let i = 0; i < 14; i++) bankCard += randInt(0, 9)

  const prefixLen = randBool() ? 3 : 2
  let companyPrefix = ''
  for (let i = 0; i < prefixLen; i++) {
    companyPrefix += randBool() ? pick(companyChars1) : pick(companyChars2)
  }
  const company = companyPrefix + pick(companySuffixes)

  const job = pick(jobs)

  const height = gender === '男' ? randInt(165, 185) : randInt(155, 172)
  const weight = gender === '男' ? randInt(60, 85) : randInt(45, 65)

  const qq = String(randInt(1000000000, 9999999999))
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let ep = ''
  for (let i = 0; i < 4; i++) ep += letters[randInt(0, 25)]
  const email = `${ep}${randInt(1, 9999)}@${pick(emailDomains)}`

  return {
    name: fullName,
    gender,
    age,
    idCard,
    phone,
    address,
    bankCard,
    company,
    job,
    education: pick(educations),
    bloodType: pick(bloodTypes),
    maritalStatus: pick(maritalStatuses),
    height,
    weight,
    qq,
    email,
  }
}

function generate() {
  identities.value = []
  for (let i = 0; i < Math.min(count.value, 20); i++) {
    identities.value.push(generateOne())
  }
}

// ====== 复制 ======
function formatIdentity(info: IdentityInfo): string {
  return [
    `姓名：${info.name}`,
    `性别：${info.gender}`,
    `年龄：${info.age}岁`,
    `身高：${info.height}cm`,
    `体重：${info.weight}kg`,
    `血型：${info.bloodType}`,
    `学历：${info.education}`,
    `婚姻：${info.maritalStatus}`,
    `身份证号：${info.idCard}`,
    `手机号码：${info.phone}`,
    `银行卡号：${info.bankCard}`,
    `家庭住址：${info.address}`,
    `公司：${info.company}`,
    `职位：${info.job}`,
    `QQ号码：${info.qq}`,
    `电子邮箱：${info.email}`,
  ].join('\n')
}

function copyAll() {
  const text = identities.value.map(formatIdentity).join('\n\n---\n\n')
  copyText(text)
}

function copyJSON() {
  copyText(JSON.stringify(identities.value.length === 1 ? identities.value[0] : identities.value, null, 2))
}

// ====== 导出 ======
function exportJSON() {
  const blob = new Blob([JSON.stringify(identities.value, null, 2)], { type: 'application/json' })
  downloadBlob(blob, 'identity.json')
}

function exportCSV() {
  const headers = '姓名,性别,年龄,身高,体重,血型,学历,婚姻,身份证号,手机号码,银行卡号,家庭住址,公司,职位,QQ,邮箱'
  const rows = identities.value.map(i =>
    [i.name, i.gender, i.age, i.height, i.weight, i.bloodType, i.education, i.maritalStatus,
      i.idCard, i.phone, i.bankCard, i.address, i.company, i.job, i.qq, i.email]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  )
  const csv = '\uFEFF' + [headers, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, 'identity.csv')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ====== 字段定义 ======
const fields: { key: keyof IdentityInfo; label: string }[] = [
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'age', label: '年龄' },
  { key: 'height', label: '身高' },
  { key: 'weight', label: '体重' },
  { key: 'bloodType', label: '血型' },
  { key: 'education', label: '学历' },
  { key: 'maritalStatus', label: '婚姻' },
  { key: 'idCard', label: '身份证号' },
  { key: 'phone', label: '手机号码' },
  { key: 'bankCard', label: '银行卡号' },
  { key: 'address', label: '家庭住址' },
  { key: 'company', label: '公司' },
  { key: 'job', label: '职位' },
  { key: 'qq', label: 'QQ' },
  { key: 'email', label: '邮箱' },
]

function formatValue(key: keyof IdentityInfo, val: any): string {
  if (key === 'age') return `${val}岁`
  if (key === 'height') return `${val}cm`
  if (key === 'weight') return `${val}kg`
  return String(val)
}

onMounted(() => { generate() })
</script>

<template>
  <div class="identity">
    <h2>随机身份</h2>
    <p class="desc">随机生成虚拟身份信息（姓名、身份证号、手机号、地址等），支持批量和导出</p>

    <el-alert
      title="免责声明：以下所有信息均为随机生成的虚拟数据，仅用于软件测试等合法用途，请勿用于伪造身份、欺诈等任何违法行为。"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 10px"
    />

    <div class="toolbar">
      <div class="toolbar-left">
        <el-input-number v-model="count" :min="1" :max="20" size="small" />
        <el-button type="primary" size="small" @click="generate">生成</el-button>
      </div>
      <div class="toolbar-right" v-if="identities.length">
        <el-button size="small" @click="copyAll">复制全部</el-button>
        <el-button size="small" @click="copyJSON">复制 JSON</el-button>
        <el-button size="small" @click="exportJSON">导出 JSON</el-button>
        <el-button size="small" @click="exportCSV">导出 CSV</el-button>
      </div>
    </div>

    <div v-for="(info, idx) in identities" :key="idx" class="card" :class="{ 'card-multi': identities.length > 1 }">
      <div v-if="identities.length > 1" class="card-title">
        身份 #{{ idx + 1 }}
        <el-button type="primary" link size="small" @click="copyText(formatIdentity(info))">
          复制
        </el-button>
      </div>
      <div class="field-grid">
        <div
          v-for="f in fields"
          :key="f.key"
          class="field-row"
          @click="copyText(String(info[f.key]))"
        >
          <span class="field-label">{{ f.label }}</span>
          <span class="field-value">{{ formatValue(f.key, info[f.key]) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.identity {
  padding: 12px;
  max-width: 700px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 16px;
  font-size: 13px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card {
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
  background: var(--bg-card, #fff);
}

.card-title {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #888);
  background: var(--bg-title, #fafafa);
  border-bottom: 1px solid var(--border-color, #e5e5e5);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.field-row {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  gap: 8px;
}

.field-row:nth-child(odd) {
  border-right: 1px solid var(--border-color, #f0f0f0);
}

.field-row:hover {
  background: var(--bg-hover, #f5f7ff);
}

.field-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.field-value {
  font-size: 13px;
  color: var(--text-primary, #333);
  word-break: break-all;
  line-height: 1.4;
}

@media (prefers-color-scheme: dark) {
  .card {
    background: #2c2c2c;
    border-color: #444;
  }

  .card-title {
    background: #333;
    border-color: #444;
    color: #aaa;
  }

  .field-row {
    border-color: #3a3a3a;
  }

  .field-row:nth-child(odd) {
    border-color: #3a3a3a;
  }

  .field-row:hover {
    background: #363640;
  }

  .field-label {
    color: #999;
  }

  .field-value {
    color: #ddd;
  }

  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }
}
</style>
