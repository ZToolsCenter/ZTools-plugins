import type { WorkspaceTab } from '@termdock/core'
import { t } from '../../i18n'
import { ContextMenu } from '../common/ContextMenu'

export function TabContextMenu({
  canConnectAll,
  canCloseAll,
  canCloseCurrent,
  canCloseOthers,
  isSessionTab,
  onAction,
  onClose,
  position,
  tabStatus
}: {
  canConnectAll: boolean
  canCloseAll: boolean
  canCloseCurrent: boolean
  canCloseOthers: boolean
  isSessionTab: boolean
  onAction(action: 'copyName' | 'copySession' | 'connect' | 'connectAll' | 'disconnect' | 'close' | 'closeOthers' | 'closeAll'): void
  onClose(): void
  position: { x: number; y: number }
  tabStatus: WorkspaceTab['status'] | null
}) {
  const canDisconnect = isSessionTab && tabStatus === 'connected'
  const canConnect = isSessionTab && (tabStatus === 'idle' || tabStatus === 'error' || tabStatus === 'closed')

  return (
    <ContextMenu
      className="tab-context-menu"
      items={[
        { label: t.copyTabName, action: () => onAction('copyName') },
        { label: t.copySession, disabled: !isSessionTab, action: () => onAction('copySession') },
        { separator: true },
        { label: t.connect, disabled: !canConnect, action: () => onAction('connect') },
        { label: t.connectAll, disabled: !isSessionTab || !canConnectAll, action: () => onAction('connectAll') },
        { separator: true },
        { label: t.disconnect, disabled: !canDisconnect, action: () => onAction('disconnect') },
        { separator: true },
        { label: t.closeTab, disabled: !canCloseCurrent, action: () => onAction('close') },
        { separator: true },
        { label: t.closeOthers, disabled: !canCloseOthers, action: () => onAction('closeOthers') },
        { label: t.closeAll, disabled: !canCloseAll, action: () => onAction('closeAll') }
      ]}
      onClose={onClose}
      position={position}
    />
  )
}
