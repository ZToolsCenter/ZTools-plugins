import { type Component } from 'vue'
import Identity from '../tools/Identity/index.vue'
import RandomPassword from '../tools/RandomPassword/index.vue'
import RandomNumber from '../tools/RandomNumber/index.vue'
import UUID from '../tools/UUID/index.vue'
import RandomColor from '../tools/RandomColor/index.vue'
import Signature from '../tools/Signature/index.vue'
import Pinyin from '../tools/Pinyin/index.vue'
import Qrcode from '../tools/Qrcode/index.vue'
import HTMLPreview from '../tools/HTMLPreview/index.vue'
import TimeConvert from '../tools/TimeConvert/index.vue'

export interface Tool {
  code: string
  explain: string
  icon: string
  component: Component
}

export interface Category {
  name: string
  code: string
  tools: Tool[]
}

export const categories: Category[] = [
  {
    name: '随机生成',
    code: 'random',
    tools: [
      { code: 'identity', explain: '随机身份', icon: '', component: Identity },
      { code: 'password', explain: '随机密码', icon: '', component: RandomPassword },
      { code: 'number', explain: '随机数字', icon: '', component: RandomNumber },
      { code: 'uuid', explain: 'UUID生成', icon: '', component: UUID },
      { code: 'color', explain: '随机颜色', icon: '', component: RandomColor },
    ]
  },
  {
    name: '编码转换',
    code: 'convert',
    tools: [
      { code: 'signature', explain: '加密签名', icon: '', component: Signature },
      { code: 'pinyin', explain: '中文转拼音', icon: '', component: Pinyin },
      { code: 'qrcode', explain: '二维码', icon: '', component: Qrcode },
      { code: 'timeconvert', explain: '时间转换', icon: '', component: TimeConvert },
    ]
  },
  {
    name: '开发工具',
    code: 'dev',
    tools: [
      { code: 'htmlpreview', explain: 'HTML预览', icon: '', component: HTMLPreview },
    ]
  }
]

// code -> tool 映射，用于快速查找
export const toolMap = new Map<string, Tool>()
for (const cat of categories) {
  for (const tool of cat.tools) {
    toolMap.set(tool.code, tool)
  }
}
