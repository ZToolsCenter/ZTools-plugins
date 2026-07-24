export type ImageFormat = "jpeg" | "png" | "webp" | "avif" | "heif" | "tiff" | "gif";

export type WatermarkPosition =
  | "northwest"
  | "north"
  | "northeast"
  | "west"
  | "center"
  | "east"
  | "southwest"
  | "south"
  | "southeast";

export interface SourceFile {
  path: string;
  name: string;
  type: "image" | "pdf" | "directory" | "unknown";
  size: number;
  width?: number;
  height?: number;
  format?: string;
}

export interface OutputSettings {
  directory: string;
  namingPattern: string;
  overwrite: boolean;
}

export interface FormatSettings {
  type: ImageFormat;
  quality?: number;
  effort?: number;
  lossless?: boolean;
  keepMetadata?: boolean;
}

export interface ResizeSettings {
  mode: "fit" | "cover" | "contain" | "exact" | "long-edge" | "short-edge";
  width?: number;
  height?: number;
  background?: string;
  withoutEnlargement?: boolean;
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RelativeCropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BorderSettings {
  enabled: boolean;
  width: number;
  color: string;
}

export interface RoundedSettings {
  enabled: boolean;
  radius: number;
  background?: string;
}

export interface WatermarkSettings {
  enabled: boolean;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  position: WatermarkPosition;
  opacity: number;
  fontSize: number;
  color: string;
  margin: number;
  rotation: number;
}

export interface ImageJobSettings {
  output: OutputSettings;
  format?: FormatSettings;
  resize?: ResizeSettings;
  crop?: CropBox;
  cropRelative?: RelativeCropBox;
  rotate?: number;
  flip?: "horizontal" | "vertical" | "both";
  border?: BorderSettings;
  rounded?: RoundedSettings;
  watermark?: WatermarkSettings;
  compression?: {
    quality?: number;
    keepMetadata?: boolean;
  };
}

export interface ProcessResult {
  inputPath: string;
  outputPath: string;
  ok: boolean;
  width?: number;
  height?: number;
  inputBytes?: number;
  outputBytes?: number;
  error?: string;
}

export interface MergeImagesOptions {
  layout: "vertical" | "horizontal" | "grid";
  columns?: number;
  gap: number;
  background: string;
}

export interface GifOptions {
  width: number;
  height: number;
  delayMs: number;
  loop: number;
  background?: string;
}

export interface OutputPathInput {
  inputPath: string;
  outputDirectory: string;
  targetFormat: ImageFormat | string;
  namingPattern: string;
  index: number;
  width?: number;
  height?: number;
  existingPaths?: Set<string>;
  overwrite?: boolean;
}
