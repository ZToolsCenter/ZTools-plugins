import type { TopicReply } from './types'

export interface ReplyThread {
  reply: TopicReply
  floor: number
  content: string
  children: ReplyThread[]
}

export function buildReplyThreads(replies: TopicReply[]): ReplyThread[] {
  const roots: ReplyThread[] = []
  const byFloor: ReplyThread[] = []
  const latestByAuthor = new Map<string, ReplyThread>()

  for (const [index, reply] of replies.entries()) {
    const node: ReplyThread = { reply, floor: index + 1, content: reply.content, children: [] }
    const mention = /^\s*@([a-zA-Z0-9_-]+)(?=$|[\s,:：，])[,，:：]?\s*/.exec(reply.content)
    const remainder = mention ? reply.content.slice(mention[0].length) : reply.content.trimStart()
    const floorReference = /^#(\d+)(?=$|[\s,:：，。.!！?？])/.exec(remainder)
    let parent: ReplyThread | undefined

    if (remainder.startsWith('#')) {
      // 明确指定楼层时只关联该楼层，不能退回最近同名用户而串错会话。
      parent = floorReference ? byFloor[Number(floorReference[1]) - 1] : undefined
      if (parent && mention && parent.reply.member.username.toLowerCase() !== mention[1].toLowerCase()) {
        parent = undefined
      }
    } else if (mention && !remainder.startsWith('@')) {
      parent = latestByAuthor.get(mention[1].toLowerCase())
    }

    if (parent) {
      if (mention && remainder.trim()) node.content = remainder
      parent.children.push(node)
    } else {
      roots.push(node)
    }
    byFloor.push(node)
    latestByAuthor.set(reply.member.username.toLowerCase(), node)
  }

  return roots
}
