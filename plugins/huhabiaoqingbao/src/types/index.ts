export type EmoticonSource = 'local' | 'qq' | 'wechat' | 'feishu'

export interface Emoticon {
  id: string
  name: string
  url: string
  type: string
  favorite: boolean
  source?: EmoticonSource
  createdAt: number
  createTime: number
  updateTime: number
  tags: string[]
}

export interface Tag {
  name: string
  count: number
}

export interface SearchResult {
  id: string
  url: string
  title: string
  source: string
  originalUrl?: string
}

export type SearchSource = 'baidu' | 'bing' | 'sougou' | 'fabiaoqing' | 'dou'

// 视频分类相关类型
export interface VideoCategory {
  id: string
  name: string
  description?: string
  icon?: string
}

// 视频API响应类型
export interface VideoApiResponse {
  code?: number
  msg?: string
  data?: {
    video: string
  }
}

// 视频分类枚举
export type VideoCategoryId = 
  | 'jk'                      // JK类型视频
  | 'YuMeng'                  // 欲梦视频
  | 'NvDa'                    // 女大视频
  | 'NvGao'                   // 女高视频
  | 'ReWu'                    // 热舞类型视频
  | 'QingCun'                 // 清纯类型视频
  | 'YuZu'                    // 玉足类型视频
  | 'SheJie'                  // 蛇姐类型视频
  | 'ChuanDa'                 // 穿搭类型视频
  | 'GaoZhiLiangXiaoJieJie'   // 高质量小姐姐视频
  | 'HanFu'                   // 汉服类型视频
  | 'HeiSi'                   // 黑丝类型视频
  | 'BianZhuang'              // 变装类型视频
  | 'LuoLi'                   // 萝莉类型视频
  | 'TianMei'                 // 甜妹类型视频
  | 'BaiSi'                   // 白丝类型视频 