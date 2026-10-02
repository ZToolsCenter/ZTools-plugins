import type { FeedKind, TopicBundle, TopicDetail, TopicReply, TopicSummary } from './types'

function getServices() {
  if (!window.services) throw new Error('V2EX 网络服务尚未加载，请在 ZTools 中重新打开插件。')
  return window.services
}

export function fetchTopics(kind: FeedKind): Promise<TopicSummary[]> {
  return getServices().getV2exTopics(kind) as Promise<TopicSummary[]>
}

export async function fetchTopic(topicId: number): Promise<TopicDetail> {
  const topics = (await getServices().getV2exTopic(topicId)) as TopicDetail[]
  const topic = topics[0]
  if (!topic) {
    throw new Error('没有找到这篇帖子，它可能已经被删除。')
  }
  return topic
}

export function fetchReplies(topicId: number): Promise<TopicReply[]> {
  return getServices().getV2exReplies(topicId) as Promise<TopicReply[]>
}

export async function fetchTopicBundle(topicId: number): Promise<TopicBundle> {
  const [topic, replies] = await Promise.all([fetchTopic(topicId), fetchReplies(topicId)])
  return { topic, replies }
}
