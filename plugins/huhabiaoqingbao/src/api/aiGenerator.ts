import axios from 'axios'
import { getCozeCredentials, hasCozeCredentials } from '@/config/credentials'

// 定义API响应类型
interface CozeApiResponse {
  response?: {
    content: string
    content_type: string
    attachments?: Array<{
      type: string
      url: string
    }>
  }
  data?: {
    id: string
    conversation_id: string
    bot_id: string
    created_at: number
    status: string
    events?: Array<{
      event: string
      data: {
        content?: string
        content_type?: string
        delta?: {
          content?: string
        }
      }
    }>
  }
  code: number
  msg: string
}

// 流式响应事件类型
interface StreamEvent {
  event: string
  data: string
}

// 消息类型
interface MessageData {
  id: string
  conversation_id: string
  bot_id: string
  role: string
  type: string
  content: string
  content_type: string
  chat_id: string
  section_id: string
  created_at: number
  updated_at?: number
}

// 生成表情包的函数
export const generateEmoticonWithAI = async (prompt: string): Promise<string[]> => {
  const credentials = await getCozeCredentials()
  if (!hasCozeCredentials(credentials)) {
    throw new Error('未配置 AI 生成服务，请先在「系统设置 - AI 生成」中填写 Coze Token 与 Bot ID')
  }

  try {
    console.log('开始生成表情包，提示词:', prompt)

    // 使用流式响应
    const response = await axios.post<string>(
      'https://api.coze.cn/v3/chat',
      {
        bot_id: credentials.botId,
        user_id: '123123000',
        stream: true, // 启用流式响应
        auto_save_history: true,
        additional_messages: [
          {
            role: 'user',
            content: `${prompt}`,
            content_type: 'text'
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        responseType: 'text',
        timeout: 60000 // 设置60秒超时
      }
    )

    // 处理流式响应
    const content = response.data
    console.log('流式响应原始内容:', content)
    
    // 解析流式响应
    const events = parseEventStream(content)
    console.log(`解析出 ${events.length} 个事件`)
    
    // 收集所有可能包含图片URL的消息
    const imageUrls: string[] = []
    
    for (const event of events) {
      // 只处理消息完成事件
      if (event.event === 'conversation.message.completed' || 
          event.event === 'conversation.message.delta') {
        try {
          const messageData = JSON.parse(event.data) as MessageData
          
          // 检查消息类型，tool_response和answer类型通常包含图片URL
          if (messageData.type === 'tool_response' || 
              messageData.type === 'answer') {
            
            console.log(`找到${messageData.type}类型消息:`, messageData.content)
            
            // 检查内容是否是URL
            if (messageData.content && 
                (messageData.content.startsWith('http://') || 
                 messageData.content.startsWith('https://'))) {
              
              // 添加到图片URL列表
              imageUrls.push(messageData.content)
            } else {
              // 尝试从内容中提取URL
              const extractedUrls = extractImageUrls(messageData.content)
              if (extractedUrls.length > 0) {
                imageUrls.push(...extractedUrls)
              }
            }
          }
        } catch (e) {
          console.error('解析消息数据失败:', e)
        }
      }
    }
    
    // 去重
    const uniqueUrls = [...new Set(imageUrls)]
    console.log('提取的图片URL:', uniqueUrls)
    
    return uniqueUrls
  } catch (error) {
    console.error('AI生成表情失败:', error)
    throw error
  }
}

// 解析事件流
const parseEventStream = (text: string): StreamEvent[] => {
  const events: StreamEvent[] = []
  const lines = text.split('\n')
  
  let currentEvent: Partial<StreamEvent> = {}
  
  for (const line of lines) {
    if (!line.trim()) {
      // 空行表示事件结束
      if (currentEvent.event && currentEvent.data) {
        events.push(currentEvent as StreamEvent)
      }
      currentEvent = {}
      continue
    }
    
    if (line.startsWith('event:')) {
      currentEvent.event = line.substring(6).trim()
    } else if (line.startsWith('data:')) {
      currentEvent.data = line.substring(5).trim()
    }
  }
  
  // 添加最后一个事件
  if (currentEvent.event && currentEvent.data) {
    events.push(currentEvent as StreamEvent)
  }
  
  return events
}

// 从文本中提取图片URL
const extractImageUrls = (text: string): string[] => {
  // 匹配markdown图片格式 ![alt](url)
  const markdownRegex = /!\[.*?\]\((https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif))\)/gi
  const markdownMatches = text.match(markdownRegex) || []
  const markdownUrls = markdownMatches.map(match => {
    const urlMatch = /\((https?:\/\/[^\s)]+)\)/.exec(match)
    return urlMatch ? urlMatch[1] : ''
  }).filter(url => url)
  
  // 匹配普通URL
  const urlRegex = /(https?:\/\/[^\s()<>]+\.(jpg|jpeg|png|gif))/gi
  const urlMatches = text.match(urlRegex) || []
  
  // 匹配Coze短链接
  const cozeRegex = /(https?:\/\/s\.coze\.cn\/t\/[a-zA-Z0-9]+)/gi
  const cozeMatches = text.match(cozeRegex) || []
  
  // 合并所有匹配结果并去重
  return [...new Set([...markdownUrls, ...urlMatches, ...cozeMatches])]
} 