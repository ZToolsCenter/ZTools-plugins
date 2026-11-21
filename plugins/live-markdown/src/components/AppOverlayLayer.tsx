import React from "react";
import {
  EditorContextMenu,
  FloatingSelectionToolbar,
  PreferencesModal,
  PromptDialogModal,
  QuickOpenModal,
  TableInsertModal
} from "./FloatingPanels";
import { FileHistoryModal } from "./FileHistoryModal";

export interface AppOverlayLayerProps {
  quickOpen: React.ComponentProps<typeof QuickOpenModal>;
  tableInsert: React.ComponentProps<typeof TableInsertModal>;
  selectionToolbar: React.ComponentProps<typeof FloatingSelectionToolbar>;
  contextMenu: React.ComponentProps<typeof EditorContextMenu>;
  preferences: React.ComponentProps<typeof PreferencesModal>;
  promptDialog: React.ComponentProps<typeof PromptDialogModal>;
  history: React.ComponentProps<typeof FileHistoryModal> | null;
}

export const AppOverlayLayer: React.FC<AppOverlayLayerProps> = ({
  quickOpen, tableInsert, selectionToolbar, contextMenu, preferences, promptDialog, history
}) => (
  <>
    <QuickOpenModal {...quickOpen} />
    <TableInsertModal {...tableInsert} />
    <FloatingSelectionToolbar {...selectionToolbar} />
    <EditorContextMenu {...contextMenu} />
    <PreferencesModal {...preferences} />
    <PromptDialogModal {...promptDialog} />
    {history && <FileHistoryModal {...history} />}
  </>
);
