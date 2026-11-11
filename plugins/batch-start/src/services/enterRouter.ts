export type EnterAction =
  | { type: 'manage' }
  | { type: 'launch-group'; groupId: string }

export function routePluginEnter(code: string | undefined): EnterAction {
  if (!code || code === 'manage') return { type: 'manage' }
  if (code.startsWith('group:')) return { type: 'launch-group', groupId: code }
  return { type: 'manage' }
}
