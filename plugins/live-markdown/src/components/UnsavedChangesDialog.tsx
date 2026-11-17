import React from "react";

export interface UnsavedChangesDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({ open, onSave, onDiscard, onCancel }) => {
  if (!open) return null;
  return <div className="ty-modal-backdrop" onClick={onCancel}>
    <div className="ty-dialog-card" role="dialog" aria-modal="true" aria-labelledby="unsaved-title" onClick={(event) => event.stopPropagation()}>
      <div className="ty-dialog-header"><div id="unsaved-title" className="ty-dialog-title">保存未完成的修改？</div></div>
      <div style={{ padding: "16px", color: "var(--text-secondary, #666)" }}>当前文档尚未保存。切换前请选择如何处理。</div>
      <div className="ty-dialog-footer">
        <button type="button" className="ty-btn-secondary" onClick={onCancel}>取消</button>
        <button type="button" className="ty-btn-secondary" onClick={onDiscard}>不保存</button>
        <button type="button" className="ty-btn-primary" onClick={onSave}>保存</button>
      </div>
    </div>
  </div>;
};
