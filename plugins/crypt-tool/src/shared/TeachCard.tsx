export default function TeachCard({ summary }: { summary: string }) {
  return (
    <div className="ct-teach">
      <strong>算法简要</strong>
      <div>{summary}</div>
    </div>
  )
}
