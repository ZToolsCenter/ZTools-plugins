import type { LucideIcon } from "lucide-react";

export type SettingsTab = "general" | "shortcuts" | "local-folder" | "appearance" | "ai" | "data";

export interface SettingsTabConfig {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}
