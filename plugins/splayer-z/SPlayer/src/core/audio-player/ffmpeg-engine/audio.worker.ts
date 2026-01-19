import createAudioDecoderCore from "@/assets/ffmpeg/decode-audio.js";
import type {
  AudioDecoderModule,
  AudioStreamDecoder,
  WorkerRequest,
  WorkerResponse,
} from "./types";

let ffmpegModulePromise: Promise<AudioDecoderModule> | null = null;

function getModule(): Promise<AudioDecoderModule> {
  if (!ffmpegModulePromise) {
    ffmpegModulePromise = createAudioDecoderCore({
      locateFile: (path: string) => (path.endsWith(".wasm") ? "/wasm/decode-audio.wasm" : path),
      print: (text: string) => console.log("[WASM]", text),
      printErr: (text: string) => console.error("[WASM Error]", text),
    }) as Promise<AudioDecoderModule>;
  }
  return ffmpegModulePromise;
}

class DecoderSession {
  private decoder: AudioStreamDecoder | null = null;
  private mountDir: string;
  /**
   * 是否活着，用于退出循环
   */
  private isRunning = true;
  /**
   * 是否暂停，用于暂时挂起
   */
  private isPaused = false;

  constructor(
    private module: AudioDecoderModule,
    public req: WorkerRequest & { type: "INIT" },
  ) {
    this.mountDir = `/session_${req.id}`;
    this.init();
  }

  private init() {
    try {
      this.module.FS.mkdir(this.mountDir);
      this.module.FS.mount(
        this.module.FS.filesystems.WORKERFS,
        { files: [this.req.file] },
        this.mountDir,
      );
    } catch (e) {
      console.warn(`[DecoderSession] Mount error: ${e}`);
    }

    const filePath = `${this.mountDir}/${this.req.file.name}`;
    this.decoder = new this.module.AudioStreamDecoder();
    const props = this.decoder.init(filePath);

    if (props.status.status < 0) {
      throw new Error(`Decoder init failed: ${props.status.error}`);
    }

    const metadataObj: Record<string, string> = {};

    const keysList = props.metadata.keys();

    for (let i = 0; i < keysList.size(); i++) {
      const key = keysList.get(i);
      metadataObj[key] = props.metadata.get(key);
    }

    keysList.delete();

    let coverUrl: string | undefined;
    if (props.coverArt.size() > 0) {
      const cover = new Uint8Array(props.coverArt.size());
      for (let i = 0; i < props.coverArt.size(); i++) {
        cover[i] = props.coverArt.get(i);
      }
      coverUrl = URL.createObjectURL(new Blob([cover]));
    }

    this.post({
      type: "METADATA",
      id: this.req.id,
      sampleRate: props.sampleRate,
      channels: props.channelCount,
      duration: props.duration,
      metadata: metadataObj,
      encoding: props.encoding,
      coverUrl,
      bitsPerSample: props.bitsPerSample,
    });

    props.metadata?.delete();
    props.coverArt?.delete();

    this.decodeLoop();
  }

  private decodeLoop = () => {
    if (!this.isRunning) return;
    if (this.isPaused || !this.decoder) return;

    try {
      const result = this.decoder.readChunk(this.req.chunkSize);

      if (result.status.status < 0) {
        throw new Error(`Decode error: ${result.status.error}`);
      }

      if (result.samples.length > 0) {
        const chunkData = result.samples.slice();
        this.post(
          {
            type: "CHUNK",
            id: this.req.id,
            data: chunkData,
            startTime: result.startTime,
          },
          [chunkData.buffer],
        );
      }

      if (result.isEOF) {
        this.post({ type: "EOF", id: this.req.id });
        this.isRunning = false;
      } else {
        // 让出主线程，避免 UI 卡死
        setTimeout(this.decodeLoop, 0);
      }
    } catch (e) {
      this.handleError(e);
    }
  };

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.decodeLoop();
    }
  }

  public seek(time: number, newId: number) {
    if (!this.decoder) return;
    try {
      const result = this.decoder.seek(time);
      if (result.status < 0) throw new Error(result.error);

      this.req.id = newId;

      this.post({ type: "SEEK_DONE", id: newId, time });

      this.isRunning = true;
      this.isPaused = false;
      this.decodeLoop();
    } catch (e) {
      this.post({
        type: "ERROR",
        id: newId,
        error: e instanceof Error ? e.message : String(e),
      });
      this.destroy();
    }
  }

  public destroy() {
    this.isRunning = false;

    if (this.decoder) {
      this.decoder.close();
      this.decoder.delete();
      this.decoder = null;
    }

    if (this.module && this.mountDir) {
      try {
        this.module.FS.unmount(this.mountDir);
        this.module.FS.rmdir(this.mountDir);
      } catch {
        // 忽略卸载错误
      }
    }
  }

  private handleError(e: unknown) {
    this.post({
      type: "ERROR",
      id: this.req.id,
      error: e instanceof Error ? e.message : String(e),
    });
    this.destroy();
  }

  private post(msg: WorkerResponse, transfer: Transferable[] = []) {
    self.postMessage(msg, transfer);
  }
}

let currentSession: DecoderSession | null = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  switch (req.type) {
    case "INIT":
      currentSession?.destroy();
      currentSession = null;

      try {
        const module = await getModule();
        currentSession = new DecoderSession(module, req);
      } catch (err) {
        self.postMessage({
          type: "ERROR",
          id: req.id,
          error: `Module load failed: ${(err as Error).message}`,
        });
        console.error(err);
      }
      break;
    case "PAUSE":
      if (currentSession && currentSession.req.id === req.id) {
        currentSession.pause();
      }
      break;
    case "RESUME":
      if (currentSession && currentSession.req.id === req.id) {
        currentSession.resume();
      }
      break;
    case "SEEK":
      if (currentSession) {
        currentSession.seek(req.seekTime, req.id);
      }
      break;
  }
};
