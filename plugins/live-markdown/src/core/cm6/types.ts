import { TyporaPreferences } from "../../types/typora";

export interface CM6LivePreviewEditorProps {
  markdown: string;
  preferences: TyporaPreferences;
  docPath: string | null;
  readingMode?: boolean;
  typewriterMode?: boolean;
  searchHighlight?: string;
  onChangeFullMarkdown: (nextMarkdown: string) => void;
  onOpenLink?: (url: string) => void;
  onContextMenuRequest?: (e: React.MouseEvent, pos: number | null) => void;
  onJumpToHeading?: (headingText: string) => void;
}

export type EditorEngineType = "cm6" | "block";
