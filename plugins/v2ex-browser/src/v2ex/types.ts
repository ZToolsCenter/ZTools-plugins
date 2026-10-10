export type FeedKind = 'hot' | 'latest'

export interface V2exMember {
  username: string
  avatar_normal: string
}

export interface V2exNode {
  name: string
  title: string
}

export interface TopicSummary {
  id: number
  title: string
  url: string
  content: string
  content_rendered: string
  replies: number
  created: number
  node: V2exNode
  member: V2exMember
}

export interface TopicDetail extends TopicSummary {
  created: number
  last_modified: number
}

export interface TopicReply {
  id: number
  content: string
  content_rendered: string
  created: number
  member: V2exMember
}

export interface TopicBundle {
  topic: TopicDetail
  replies: TopicReply[]
}
