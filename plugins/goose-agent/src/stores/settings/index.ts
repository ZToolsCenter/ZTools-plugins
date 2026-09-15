import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { applyAppearanceFonts } from "@/lib/appearance/applyAppearance";
import { applyWindowHeight } from "@/lib/platform/windowHeight";
import { createAISlice, type AISlice } from "./aiSlice";
import {
  createAppearanceSlice,
  normalizeAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSlice,
} from "./appearanceSlice";
import {
  createPersonaSlice,
  normalizePersonaSettings,
  type PersonaSettings,
  type PersonaSlice,
} from "./personaSlice";
import { gaStateStorage } from "./gaStorage";
import { normalizeAISettings, type AISettings } from "./types";

export type SettingsState = AISlice &
  PersonaSlice &
  AppearanceSlice & {
    _hasHydrated: boolean;
  };

/**
 * 持久化名 `settings` → 实际存储键 `ga:settings`（见 gaStorage / preload）。
 * 不读、不写 goose-note / gn: / goose-note-settings。
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...createAISlice(set as Parameters<typeof createAISlice>[0]),
      ...createPersonaSlice(set as Parameters<typeof createPersonaSlice>[0]),
      ...createAppearanceSlice(
        set as Parameters<typeof createAppearanceSlice>[0],
      ),
      _hasHydrated: false,
    }),
    {
      name: "settings",
      version: 1,
      storage: createJSONStorage(() => gaStateStorage),
      partialize: (state) => ({
        ai: state.ai,
        persona: state.persona,
        appearance: state.appearance,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as {
                ai?: Partial<AISettings>;
                persona?: Partial<PersonaSettings>;
                appearance?: Partial<AppearanceSettings>;
              })
            : {};
        return {
          ...current,
          ai: normalizeAISettings(raw.ai),
          persona: normalizePersonaSettings(raw.persona),
          appearance: normalizeAppearanceSettings(raw.appearance),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const appearance = normalizeAppearanceSettings(state.appearance);
        useSettings.setState({
          ai: normalizeAISettings(state.ai),
          persona: normalizePersonaSettings(state.persona),
          appearance,
          _hasHydrated: true,
        });
        // belt-and-suspenders：rehydrate 后再 apply 一次（early apply 已先跑）
        applyAppearanceFonts(appearance);
        applyWindowHeight(appearance.windowHeight);
      },
    },
  ),
);

export type { AISettings } from "./types";
export {
  normalizeAISettings,
  normalizeAIModelOptions,
  normalizeAIBaseURL,
  normalizeAIApiKey,
  normalizeAIReasoningLevel,
  normalizeAIAuthMode,
  normalizeAIOAuthSession,
  type AIAuthMode,
  type AIOAuthSession,
} from "./types";
export { AI_INITIAL_STATE } from "./aiSlice";
export type { PersonaSettings } from "./personaSlice";
export {
  PERSONA_INITIAL_STATE,
  normalizePersonaSettings,
} from "./personaSlice";
export type { AppearanceSettings } from "./appearanceSlice";
export {
  APPEARANCE_INITIAL_STATE,
  normalizeAppearanceSettings,
} from "./appearanceSlice";
