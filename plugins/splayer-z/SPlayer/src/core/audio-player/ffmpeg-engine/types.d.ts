/// <reference types="@types/emscripten" />

export type PlayerState = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

export interface AudioErrorDetail {
  originalEvent: Event;
  errorCode: number;
}

export interface AudioMetadata {
  sampleRate: number;
  channels: number;
  duration: number;
  metadata: Record<string, string>;
  encoding: string;
  coverUrl?: string | undefined;
  bitsPerSample: number;
}

export type WorkerRequest =
  | { type: "INIT"; id: number; file: File; chunkSize: number }
  | { type: "PAUSE"; id: number }
  | { type: "RESUME"; id: number }
  | { type: "SEEK"; id: number; seekTime: number };

export type WorkerResponse =
  | { type: "ERROR"; id: number; error: string }
  | {
      type: "METADATA";
      id: number;
      sampleRate: number;
      channels: number;
      duration: number;
      metadata: Record<string, string>;
      encoding: string;
      coverUrl?: string | undefined;
      bitsPerSample: number;
    }
  | {
      type: "CHUNK";
      id: number;
      data: Float32Array;
      time?: number;
      startTime: number;
    }
  | { type: "EOF"; id: number }
  | { type: "SEEK_DONE"; id: number; time: number };

// FFmpeg WASM Engine Types

export interface EmbindObject {
  delete(): void;
  isDeleted(): boolean;
}

export interface StringList extends EmbindObject {
  size(): number;
  get(index: number): string;
}

export interface StringMap extends EmbindObject {
  keys(): StringList;
  get(key: string): string;
  set(key: string, value: string): void;
  size(): number;
}

export interface Uint8List extends EmbindObject {
  size(): number;
  get(index: number): number;
}

export interface DecoderStatus {
  status: number;
  error: string;
}

export interface AudioProperties {
  status: DecoderStatus;
  encoding: string;
  sampleRate: number;
  channelCount: number;
  duration: number;
  metadata: StringMap;
  coverArt: Uint8List;
  bitsPerSample: number;
}

export interface ChunkResult {
  status: DecoderStatus;
  samples: Float32Array;
  isEOF: boolean;
  startTime: number;
}

export interface AudioStreamDecoder extends EmbindObject {
  init(path: string): AudioProperties;
  readChunk(chunkSize: number): ChunkResult;
  seek(timestamp: number): DecoderStatus;
  close(): void;
}

export interface AudioDecoderModule extends EmscriptenModule {
  FS: typeof FS & {
    filesystems: {
      WORKERFS: Emscripten.FileSystemType;
    };
  };
  AudioStreamDecoder: {
    new (): AudioStreamDecoder;
  };
}
