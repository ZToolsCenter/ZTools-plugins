import type {
  BridgeEnvelope,
  HostMessage,
  LocalAssetAcknowledgement,
  LocalResourceAcknowledgement,
} from "./types";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_ASSET_BYTES / 3) * 4;
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_INLINE_MEDIA = /^data:(?:image|audio|video)\/[a-z0-9.+-]+(?:;[^,]*)?,/i;
const REMOTE_REFERENCE = /^(?:https?|ftp):/i;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function createRequestID() {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

export function isValidEnvelope(envelope: BridgeEnvelope) {
  return envelope.version === 1
    && envelope.requestID.trim().length > 0
    && envelope.requestID.length <= 128
    && Number.isInteger(envelope.revision)
    && envelope.revision >= 0;
}

export function postToHost(message: HostMessage) {
  window.webkit?.messageHandlers?.gooseNotes?.postMessage(message);
}

interface PendingResource extends Pick<BridgeEnvelope, "pageID" | "revision"> {
  cacheKey: string;
  resolve(url: string): void;
  reject(error: Error): void;
  timeout: number;
}

export class NativeLocalResourceBridge {
  private readonly pending = new Map<string, PendingResource>();
  private readonly resolved = new Map<string, string>();

  resolve(source: string, context: Pick<BridgeEnvelope, "pageID" | "revision">) {
    const reference = source.trim();
    if (reference.startsWith("blob:")) return Promise.resolve(reference);
    if (reference.startsWith("data:")) {
      return SAFE_INLINE_MEDIA.test(reference)
        ? Promise.resolve(reference)
        : Promise.reject(new Error("只允许图片、音频或视频 data URL。"));
    }
    if (REMOTE_REFERENCE.test(reference)) {
      return Promise.reject(new Error("原生编辑器不读取远程媒体。"));
    }
    if (EXPLICIT_SCHEME.test(reference) && !reference.startsWith("file:")) {
      return Promise.reject(new Error("不支持该资源地址。"));
    }

    const cacheKey = `${context.pageID}\0${context.revision}\0${reference}`;
    const cached = this.resolved.get(cacheKey);
    if (cached) return Promise.resolve(cached);

    const requestID = createRequestID();
    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestID);
        reject(new Error("本地资源解析超时。"));
      }, 15_000);
      this.pending.set(requestID, { ...context, cacheKey, resolve, reject, timeout });
      postToHost({
        version: 1,
        type: "resolveLocalResource",
        requestID,
        pageID: context.pageID,
        revision: context.revision,
        source: reference,
      });
    });
  }

  readonly receive = (acknowledgement: LocalResourceAcknowledgement) => {
    if (!isValidEnvelope(acknowledgement)) return;
    const request = this.pending.get(acknowledgement.requestID);
    if (!request) return;
    this.pending.delete(acknowledgement.requestID);
    window.clearTimeout(request.timeout);
    if (request.pageID !== acknowledgement.pageID
      || request.revision !== acknowledgement.revision) {
      request.reject(new Error("本地资源请求已失效。"));
      return;
    }
    if (acknowledgement.status === "resolved" && acknowledgement.url) {
      this.resolved.set(request.cacheKey, acknowledgement.url);
      request.resolve(acknowledgement.url);
      return;
    }
    request.reject(new Error(acknowledgement.message ?? "无法读取本地资源。"));
  };

  invalidate() {
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error("当前文件已切换，本地资源请求已取消。"));
    }
    this.pending.clear();
    this.resolved.clear();
  }
}
interface PendingAsset extends Pick<BridgeEnvelope, "pageID" | "revision"> {
  resolve(asset: { relativePath: string; mediaType: string }): void;
  reject(error: Error): void;
  timeout: number;
}

function decodedByteLength(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

async function fileAsBase64(file: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result ?? "");
      const separator = dataURL.indexOf(",");
      if (separator < 0) reject(new Error("附件数据无效，请重新选择。"));
      else resolve(dataURL.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("无法读取附件。"));
    reader.readAsDataURL(file);
  });
}

export class NativeLocalAssetBridge {
  private readonly pending = new Map<string, PendingAsset>();

  async save(
    file: Blob,
    filename: string,
    mediaType: string,
    context: Pick<BridgeEnvelope, "pageID" | "revision">,
  ) {
    if (file.size > MAX_ASSET_BYTES) throw new Error("单个附件不能超过 8 MB。");
    const base64 = (await fileAsBase64(file)).trim();
    if (!base64 || base64.length > MAX_BASE64_LENGTH || !STRICT_BASE64.test(base64)
      || decodedByteLength(base64) > MAX_ASSET_BYTES) {
      throw new Error("附件数据无效或超过 8 MB。");
    }
    const requestID = createRequestID();
    return await new Promise<{ relativePath: string; mediaType: string }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestID);
        reject(new Error("附件保存超时，请重试。"));
      }, 20_000);
      this.pending.set(requestID, { ...context, resolve, reject, timeout });
      postToHost({
        version: 1,
        type: "saveLocalAsset",
        requestID,
        pageID: context.pageID,
        revision: context.revision,
        filename: filename || "附件",
        mediaType: mediaType || "application/octet-stream",
        base64,
      });
    });
  }

  readonly receive = (acknowledgement: LocalAssetAcknowledgement) => {
    if (!isValidEnvelope(acknowledgement)) return;
    const request = this.pending.get(acknowledgement.requestID);
    if (!request) return;
    this.pending.delete(acknowledgement.requestID);
    window.clearTimeout(request.timeout);
    if (request.pageID !== acknowledgement.pageID
      || request.revision !== acknowledgement.revision) {
      request.reject(new Error("附件保存请求已失效。"));
      return;
    }
    if (acknowledgement.status === "saved"
      && acknowledgement.relativePath
      && acknowledgement.mediaType) {
      request.resolve({
        relativePath: acknowledgement.relativePath,
        mediaType: acknowledgement.mediaType,
      });
      return;
    }
    request.reject(new Error(acknowledgement.message ?? "附件保存失败，请重试。"));
  };

  invalidate() {
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error("当前文件已切换，附件保存请求已取消。"));
    }
    this.pending.clear();
  }
}
