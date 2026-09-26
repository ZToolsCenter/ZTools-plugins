export default function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="cd-toast">{message}</div>
}
