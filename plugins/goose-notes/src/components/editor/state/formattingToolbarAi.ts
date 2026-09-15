import { create } from "zustand";

interface FormattingToolbarAiState {
  active: boolean;
  selection: { from: number; to: number } | null;
  activate: (selection: { from: number; to: number }) => void;
  reset: () => void;
}

export const useFormattingToolbarAi = create<FormattingToolbarAiState>((set) => ({
  active: false,
  selection: null,
  activate: (selection) => set({ active: true, selection }),
  reset: () => set({ active: false, selection: null }),
}));
