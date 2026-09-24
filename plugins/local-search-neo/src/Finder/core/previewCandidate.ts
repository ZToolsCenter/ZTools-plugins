import { formatBytes } from "./formatters";

export interface PreviewCandidate {
  name: string;
  extension?: string;
  size?: number;
  isDirectory?: boolean;
}

const IMAGE_PREVIEW_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
]);

const VIDEO_PREVIEW_EXTENSIONS = new Set(["mp4", "webm", "ogv", "mov", "m4v", "mkv", "avi"]);

const AUDIO_PREVIEW_EXTENSIONS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"]);

const PDF_PREVIEW_EXTENSIONS = new Set(["pdf"]);

const ARCHIVE_TREE_PREVIEW_EXTENSIONS = new Set(["zip", "tar", "tgz", "gz"]);

const MARKDOWN_PREVIEW_EXTENSIONS = new Set(["md", "markdown", "mdown"]);

const CODE_PREVIEW_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bat: "bat",
  c: "c",
  cmd: "bat",
  conf: "properties",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  ps1: "powershell",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const LOG_PREVIEW_EXTENSIONS = new Set(["log"]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "bat",
  "c",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "ps1",
  "py",
  "rs",
  "sh",
  "sql",
  "text",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

const MAX_TEXT_PREVIEW_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TAR_ARCHIVE_TREE_PREVIEW_FILE_SIZE = 100 * 1024 * 1024;

export function isImagePreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return IMAGE_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function isVideoPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return VIDEO_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function isAudioPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return AUDIO_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function isPdfPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return PDF_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function isArchiveTreePreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return isArchiveTreePreviewSupported(file) && !getArchiveTreePreviewBlockedReason(file);
}

export function getArchiveTreePreviewBlockedReason(file: PreviewCandidate): string | undefined {
  if (file.isDirectory || !isArchiveTreePreviewSupported(file)) return undefined;
  if (isTarArchive(file) && (file.size ?? 0) > MAX_TAR_ARCHIVE_TREE_PREVIEW_FILE_SIZE) {
    return `压缩包超过 ${formatBytes(MAX_TAR_ARCHIVE_TREE_PREVIEW_FILE_SIZE)}，不提供预览`;
  }
  return undefined;
}

export function isMarkdownPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return MARKDOWN_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function getCodePreviewLanguage(file: PreviewCandidate): string | undefined {
  if (file.isDirectory) return undefined;
  return CODE_PREVIEW_LANGUAGE_BY_EXTENSION[getResultExtension(file)];
}

export function isCodePreviewCandidate(file: PreviewCandidate): boolean {
  return getCodePreviewLanguage(file) !== undefined;
}

export function isLogPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  return LOG_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

export function isTextPreviewCandidate(file: PreviewCandidate): boolean {
  if (file.isDirectory) return false;
  if ((file.size ?? 0) > MAX_TEXT_PREVIEW_FILE_SIZE) return false;

  return TEXT_PREVIEW_EXTENSIONS.has(getResultExtension(file));
}

function isArchiveTreePreviewSupported(file: PreviewCandidate): boolean {
  const ext = getResultExtension(file);
  return ARCHIVE_TREE_PREVIEW_EXTENSIONS.has(ext) || file.name.toLowerCase().endsWith(".tar.gz");
}

function isTarArchive(file: PreviewCandidate): boolean {
  const ext = getResultExtension(file);
  const normalizedName = file.name.toLowerCase();
  return ext === "tar" || ext === "tgz" || normalizedName.endsWith(".tar.gz");
}

function getResultExtension(file: PreviewCandidate): string {
  return (file.extension || getExtension(file.name)).toLowerCase();
}

function getExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}
