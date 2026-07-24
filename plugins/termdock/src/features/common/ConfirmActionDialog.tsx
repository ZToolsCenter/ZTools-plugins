import { t } from '../../i18n'

export function ConfirmActionDialog({
  cancelLabel = t.cancel,
  confirmLabel,
  description,
  isSubmitting = false,
  onClose,
  onConfirm,
  title
}: {
  cancelLabel?: string
  confirmLabel: string
  description: string
  isSubmitting?: boolean
  onClose(): void
  onConfirm(): void
  title: string
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card confirm-action-dialog">
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-button" disabled={isSubmitting} onClick={onClose} type="button">×</button>
        </div>
        <div className="confirm-action-dialog__description">{description}</div>
        <div className="form-actions confirm-action-dialog__actions">
          <button className="flat-button" disabled={isSubmitting} onClick={onClose} type="button">{cancelLabel}</button>
          <button className="flat-button danger" disabled={isSubmitting} onClick={onConfirm} type="button">
            {isSubmitting ? <span aria-hidden="true" className="button-spinner" /> : null}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
