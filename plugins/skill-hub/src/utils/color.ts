const avatarColors = ['#7c3aed', '#f59e0b', '#e11d48', '#059669', '#0891b2', '#f97316', '#8b5cf6', '#db2777']

export function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return avatarColors[Math.abs(hash) % avatarColors.length]
}
