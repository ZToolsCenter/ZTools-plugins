import type { FeedKind, TopicSummary } from './types'

export function getInitialFeed(command = ''): FeedKind {
  return command.includes('最新') ? 'latest' : 'hot'
}

export function filterTopics(topics: TopicSummary[], keyword: string): TopicSummary[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return topics

  return topics.filter((topic) =>
    [topic.title, topic.node.name, topic.node.title, topic.member.username].some((value) =>
      value.toLocaleLowerCase().includes(query)
    )
  )
}

export function formatRelativeTime(epochSeconds: number, now = Date.now() / 1_000): string {
  const elapsed = Math.max(0, Math.floor(now - epochSeconds))
  if (elapsed < 60) return '刚刚'
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)} 分钟前`
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)} 小时前`
  if (elapsed < 2_592_000) return `${Math.floor(elapsed / 86_400)} 天前`
  return `${Math.floor(elapsed / 2_592_000)} 个月前`
}
