export type SettingsTab = "general" | "appearance" | "privacy" | "sync";

export type SettingsTabItem = Readonly<{ id: SettingsTab; label: string }>;

export const settingsTabs: readonly SettingsTabItem[] = [
  { id: "general", label: "通用" },
  { id: "appearance", label: "外观" },
  { id: "privacy", label: "隐私" },
  { id: "sync", label: "同步" },
];
