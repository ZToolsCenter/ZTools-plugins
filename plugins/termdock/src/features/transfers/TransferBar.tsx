import type { TransferTask } from '@termdock/core'
import { runningTransfers } from '../../app/app-utils'
import { t } from '../../i18n'

export function TransferBar({
  activeCount,
  fullWidth = false,
  isPending,
  onOpen,
  transfers
}: {
  activeCount: number
  fullWidth?: boolean
  isPending: boolean
  onOpen(): void
  transfers: TransferTask[]
}) {
  const runningCount = activeCount || runningTransfers(transfers)

  return (
    <footer className={`transfer-strip ${fullWidth ? 'full-width' : ''}`}>
      <strong>{t.transferTasks}</strong>
      <button className="transfer-summary-button" onClick={onOpen} type="button">
        {runningCount > 0 ? `${runningCount} ${t.runningTasks}` : isPending ? t.updating : `0 ${t.runningTasks}`}
      </button>
    </footer>
  )
}
