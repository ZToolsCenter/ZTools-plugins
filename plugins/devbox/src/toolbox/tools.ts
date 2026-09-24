import { type Component } from 'vue'
import Identity from '../tools/Identity/index.vue'
import RandomPassword from '../tools/RandomPassword/index.vue'
import RandomNumber from '../tools/RandomNumber/index.vue'
import UUID from '../tools/UUID/index.vue'
import RandomColor from '../tools/RandomColor/index.vue'
import Signature from '../tools/Signature/index.vue'
import Base64 from '../tools/Base64/index.vue'
import UrlCodec from '../tools/UrlCodec/index.vue'
import Pinyin from '../tools/Pinyin/index.vue'
import Qrcode from '../tools/Qrcode/index.vue'
import HTMLPreview from '../tools/HTMLPreview/index.vue'
import TimeConvert from '../tools/TimeConvert/index.vue'
import TextCompress from '../tools/TextCompress/index.vue'
import TextTransform from '../tools/TextTransform/index.vue'
import JsonTool from '../tools/JsonTool/index.vue'

export interface Tool {
  code: string
  explain: string
  icon: string
  component: Component
  /** 触发指令，需与 public/plugin.json 中对应 feature 的 cmds 保持同步（用于区分真实触发与图标进入） */
  cmds: string[]
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
      {
        code: 'identity',
        explain: '随机身份',
        icon: '',
        component: Identity,
        cmds: ['identity', '身份证', '身份', '随机身份', '虚拟身份', '生成身份', '假身份'],
      },
      {
        code: 'password',
        explain: '随机密码',
        icon: '',
        component: RandomPassword,
        cmds: ['密码', '随机密码', 'password', '生成密码', '口令', 'pass'],
      },
      {
        code: 'number',
        explain: '随机数字',
        icon: '',
        component: RandomNumber,
        cmds: ['随机数字', '随机数', 'number', '生成数字', '范围数字', '随机整数'],
      },
      {
        code: 'uuid',
        explain: 'UUID生成',
        icon: '',
        component: UUID,
        cmds: ['uuid', 'UUID', '唯一标识', '生成uuid', 'guid'],
      },
      {
        code: 'color',
        explain: '随机颜色',
        icon: '',
        component: RandomColor,
        cmds: ['随机颜色', '颜色', 'color', '生成颜色', '调色', '配色', '色值'],
      },
    ],
  },
  {
    name: '编码转换',
    code: 'convert',
    tools: [
      {
        code: 'signature',
        explain: '加密签名',
        icon: '',
        component: Signature,
        cmds: ['加密', '签名', 'token', 'signature', 'hash', '加密签名', '哈希', '签名生成', 'md5', 'sha', 'hmac'],
      },
      {
        code: 'base64',
        explain: 'Base64 编解码',
        icon: '',
        component: Base64,
        cmds: ['base64', 'Base64', 'B64', 'base64编码', 'base64解码', 'b64编码', 'b64解码', '编解码'],
      },
      {
        code: 'urlcodec',
        explain: 'URL 编解码',
        icon: '',
        component: UrlCodec,
        cmds: ['url', 'URL', 'url编码', 'url解码', 'URL编码', 'URL解码', 'urlencode', 'urldecode', 'urlcodec', '百分号编码'],
      },
      {
        code: 'pinyin',
        explain: '中文转拼音',
        icon: '',
        component: Pinyin,
        cmds: ['拼音', 'pinyin', '中文转拼音', '命名', '驼峰', '下划线命名', '首字母'],
      },
      {
        code: 'qrcode',
        explain: '二维码',
        icon: '',
        component: Qrcode,
        cmds: ['二维码', 'qrcode', 'qr', '生成二维码', '解码二维码', '扫码', 'QR码'],
      },
      {
        code: 'timeconvert',
        explain: '时间转换',
        icon: '',
        component: TimeConvert,
        cmds: ['时间', '时间转换', 'time', 'timestamp', '时间戳', '日期转换', '格式化时间', 'timeconvert'],
      },
    ],
  },
  {
    name: '开发工具',
    code: 'dev',
    tools: [
      {
        code: 'htmlpreview',
        explain: 'HTML预览',
        icon: '',
        component: HTMLPreview,
        cmds: ['html', 'HTML', '预览', 'html预览', 'HTML预览', 'htmlpreview', '网页预览'],
      },
      {
        code: 'textcompress',
        explain: '压缩文本',
        icon: '',
        component: TextCompress,
        cmds: ['压缩文本', '文本压缩', 'compress', 'textcompress', '去换行', '压缩', 'sql压缩'],
      },
      {
        code: 'texttransform',
        explain: '文本转换',
        icon: '',
        component: TextTransform,
        cmds: ['文本转换', '多行转一行', '一行转多行', '合并行', '拆分行', 'texttransform', '加引号', '行转换'],
      },
      {
        code: 'jsontool',
        explain: 'JSON工具',
        icon: '',
        component: JsonTool,
        cmds: ['json', 'JSON', 'json工具', 'JSON工具', 'json格式化', 'json解析', '格式化json', 'json压缩', 'json转义', 'json校验'],
      },
    ],
  },
]

// code -> tool 映射，用于快速查找
export const toolMap = new Map<string, Tool>()
for (const cat of categories) {
  for (const tool of cat.tools) {
    toolMap.set(tool.code, tool)
  }
}