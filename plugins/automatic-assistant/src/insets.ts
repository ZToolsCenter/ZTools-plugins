import type { Cmd } from './types'

// 内置自动化脚本注册表（脚本源码在 public/preload/scripts/*.js_）
// 定义逐字段取自原版 bundle，勿手改。
// 原版「网页自动化」整组依赖 ZTools 未提供的内嵌浏览器自动化能力，已整体移除。
export interface InsetScript {
  id: string
  title: string
  explain: string
  cmds: Cmd[]
  platform: string[]
  category: 'system' | 'input'
  // 进入插件时先隐藏主窗口（与原版 feature.mainHide 一致）
  mainHide?: boolean
}

// 分组 key/标题与原版一致
export const INSET_CATEGORIES = [
  { id: 'system', name: '本地系统' },
  { id: 'input', name: '文本处理' }
] as const

export const INSET_SCRIPTS: InsetScript[] = [
  {
    id: "wifi-password",
    title: "WiFi 密码",
    explain: "获取当前网络已连接的 WiFi 密码",
    cmds: [
      "WiFi 密码"
    ],
    platform: ["win32","darwin"],
    category: "system"
  },
  {
    id: "ping",
    title: "Ping 一下",
    explain: "Ping 一下 IP 地址或域名",
    cmds: [
      {
        type: "regex",
        match: "/^(?:ping\\s*)?(?:(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3})|(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))\\.?)$/i",
        label: "Ping 一下"
      }
    ],
    platform: ["win32","darwin"],
    category: "system",
    mainHide: true
  },
  {
    id: "input-today",
    title: "今天",
    explain: "输入今天日期",
    cmds: [
      "今天"
    ],
    platform: ["win32","darwin","linux"],
    category: "input",
    mainHide: true
  },
  {
    id: "english-upper-case",
    title: "英文大写",
    explain: "英文字母全部转大写",
    cmds: [
      {
        type: "over",
        exclude: "/[^\\x00-\\x7F]/",
        label: "英文大写"
      }
    ],
    platform: ["win32","darwin","linux"],
    category: "input",
    mainHide: true
  },
  {
    id: "english-lower-case",
    title: "英文小写",
    explain: "英文字母全部转小写",
    cmds: [
      {
        type: "over",
        exclude: "/[^\\x00-\\x7F]/",
        label: "英文小写"
      }
    ],
    platform: ["win32","darwin","linux"],
    category: "input",
    mainHide: true
  },
  {
    id: "english-first-upper-case",
    title: "首字母大写",
    explain: "英文首字母大写",
    cmds: [
      {
        type: "over",
        exclude: "/[^\\x00-\\x7F]/",
        label: "首字母大写"
      }
    ],
    platform: ["win32","darwin","linux"],
    category: "input",
    mainHide: true
  },
  {
    id: 'lan-ip',
    title: '内网 IP',
    explain: '获取本机内网 IP 地址（按默认路由选出口网卡）',
    cmds: ['内网 IP'],
    platform: ['win32', 'darwin', 'linux'],
    category: 'system',
    mainHide: true
  }
]
