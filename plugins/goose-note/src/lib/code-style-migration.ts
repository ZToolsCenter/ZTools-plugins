import { uToolsStorage } from "@/lib/storage";
import type { CodeStyle } from "@/stores/useSettings";

const SETTINGS_STORAGE_KEY = "goose-note-settings";
const MIGRATION_MARK_KEY = "goose-note:code-style-migration:2026-hot-pack:v1";

const LEGACY_CODE_STYLE_MAP: Record<string, CodeStyle> = {
  default: "github",
};

const KNOWN_CODE_STYLE_SET = new Set<CodeStyle>([
  "default",
  "github",
  "catppuccin",
  "modern",
  "night",
  "dracula",
  "nord",
  "nord-light",
]);

interface PersistedSettingsState {
  state?: {
    codeStyle?: string;
  };
  version?: number;
}

function hasMigrationMark(): boolean {
  try {
    return uToolsStorage.getItem(MIGRATION_MARK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMigrationMark(): void {
  try {
    uToolsStorage.setItem(MIGRATION_MARK_KEY, "1");
  } catch {
    // Ignore write failures and keep migration logic idempotent.
  }
}

export function migrateCodeStyleTo2026(
  codeStyle: string | null | undefined,
): CodeStyle {
  if (typeof codeStyle === "string" && codeStyle in LEGACY_CODE_STYLE_MAP) {
    return LEGACY_CODE_STYLE_MAP[codeStyle];
  }

  if (
    typeof codeStyle === "string" &&
    KNOWN_CODE_STYLE_SET.has(codeStyle as CodeStyle)
  ) {
    return codeStyle as CodeStyle;
  }

  return "github";
}

export async function runCodeStyleMigration2026(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hasMigrationMark()) return;

  try {
    const raw = await Promise.resolve(
      uToolsStorage.getItem(SETTINGS_STORAGE_KEY),
    );
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedSettingsState;
      const before = parsed?.state?.codeStyle;
      const after = migrateCodeStyleTo2026(before);

      if (parsed?.state && before !== after) {
        parsed.state.codeStyle = after;
        await Promise.resolve(
          uToolsStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed)),
        );
      }
    }

    writeMigrationMark();
  } catch (error) {
    console.error("[code-style-migration] failed to migrate code style", error);
  }
}
