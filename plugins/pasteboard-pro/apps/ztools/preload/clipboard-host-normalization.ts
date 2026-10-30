import {
  PasteItemSchema,
  type HybridClock,
  type PasteItem,
  type PastePayload,
} from "@pasteboard-pro/core";
import type {
  CanonicalClipboardOrigin,
  CanonicalClipboardRecord,
  HostCursor,
} from "./clipboard-store-types";
import {
  fingerprint,
  isRecord,
  MAX_CLIPBOARD_TEXT_BYTES,
  textTitle,
} from "./clipboard-record-codec";

type HostClipboardFile = Readonly<{
  name?: string;
  path: string;
  isDirectory?: boolean;
  exists?: boolean;
}>;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

export function hostCursor(value: unknown): HostCursor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = nonEmptyString(value.id);
  const timestamp = finiteTimestamp(value.timestamp);
  return id === undefined || timestamp === undefined
    ? undefined
    : { id, timestamp };
}

export function compareCursor(left: HostCursor, right: HostCursor): -1 | 0 | 1 {
  if (left.timestamp < right.timestamp) {
    return -1;
  }
  if (left.timestamp > right.timestamp) {
    return 1;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export function storedCursor(value: unknown): HostCursor | undefined {
  return isRecord(value) && value.type === "pasteboard-pro-cursor"
    ? hostCursor(value.cursor)
    : undefined;
}

function normalizeFiles(value: Record<string, unknown>): HostClipboardFile[] {
  if (Array.isArray(value.files)) {
    return value.files.flatMap((candidate) => {
      if (!isRecord(candidate)) {
        return [];
      }
      const path = nonEmptyString(candidate.path);
      if (path === undefined) {
        return [];
      }
      const name = nonEmptyString(candidate.name);
      return [
        {
          path,
          ...(name === undefined ? {} : { name }),
          ...(typeof candidate.isDirectory === "boolean"
            ? { isDirectory: candidate.isDirectory }
            : {}),
          ...(typeof candidate.exists === "boolean"
            ? { exists: candidate.exists }
            : {}),
        },
      ];
    });
  }

  const path = nonEmptyString(value.filePath);
  if (path === undefined) {
    return [];
  }
  const name = nonEmptyString(value.fileName);
  return [{ path, ...(name === undefined ? {} : { name }) }];
}

function inferImageMediaType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/png";
  }
}

function sourceApp(value: Record<string, unknown>): PasteItem["sourceApp"] {
  const name = nonEmptyString(value.appName);
  const bundleId = nonEmptyString(value.appBundleId) ?? nonEmptyString(value.bundleId);
  return name === undefined && bundleId === undefined
    ? undefined
    : {
        ...(name === undefined ? {} : { name }),
        ...(bundleId === undefined ? {} : { bundleId }),
      };
}

export function normalizeHostClipboardItem(
  value: unknown,
  deviceId: string,
): CanonicalClipboardRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const cursor = hostCursor(value);
  const hostType = value.type;
  if (
    cursor === undefined ||
    (hostType !== "text" && hostType !== "image" && hostType !== "file")
  ) {
    return null;
  }

  const normalizedDeviceId = nonEmptyString(deviceId);
  if (normalizedDeviceId === undefined) {
    throw new TypeError("deviceId must be a non-empty string");
  }

  const copiedAt = new Date(cursor.timestamp).toISOString();
  const clock: HybridClock = {
    wallMs: cursor.timestamp,
    counter: 0,
    deviceId: normalizedDeviceId,
  };
  let kind: PasteItem["kind"];
  let payload: PastePayload;
  let title: string | undefined;
  let origin: CanonicalClipboardOrigin;

  if (hostType === "text") {
    const text =
      typeof value.content === "string"
        ? value.content
        : typeof value.preview === "string"
          ? value.preview
          : undefined;
    if (
      text === undefined ||
      text.length === 0 ||
      Buffer.byteLength(text, "utf8") > MAX_CLIPBOARD_TEXT_BYTES
    ) {
      return null;
    }
    const contentFingerprint = fingerprint({ type: hostType, text });
    kind = "text";
    payload = { revision: contentFingerprint, text };
    title = textTitle(text);
    origin = { host: "ztools", hostItemId: cursor.id, hostType };
  } else if (hostType === "image") {
    const imagePath = nonEmptyString(value.imagePath);
    if (imagePath === undefined) {
      return null;
    }
    const contentFingerprint = fingerprint({ type: hostType, imagePath });
    kind = "image";
    payload = {
      revision: contentFingerprint,
      blobId: "ztools-image:" + cursor.id,
      mediaType: inferImageMediaType(imagePath),
    };
    title = nonEmptyString(value.preview);
    const blobBytes =
      Number.isSafeInteger(value.byteSize) && Number(value.byteSize) >= 0
        ? Number(value.byteSize)
        : Number.isSafeInteger(value.size) && Number(value.size) >= 0
          ? Number(value.size)
          : undefined;
    origin = {
      host: "ztools",
      hostItemId: cursor.id,
      hostType,
      imagePath,
      ...(blobBytes === undefined ? {} : { blobBytes }),
    };
  } else {
    const files = normalizeFiles(value);
    if (files.length === 0) {
      return null;
    }
    const filePaths = files.map((file) => file.path);
    const contentFingerprint = fingerprint({ type: hostType, filePaths });
    kind = "files";
    payload = { revision: contentFingerprint, filePaths };
    title =
      files.length === 1
        ? (files[0]?.name ?? files[0]?.path)
        : files.length + " items";
    origin = { host: "ztools", hostItemId: cursor.id, hostType };
  }

  const app = sourceApp(value);
  const item = PasteItemSchema.parse({
    id: "ztools:" + cursor.id,
    kind,
    ...(title === undefined ? {} : { title }),
    ...(app === undefined ? {} : { sourceApp: app }),
    sourceDeviceId: normalizedDeviceId,
    copiedAt,
    updatedAt: copiedAt,
    contentFingerprint: payload.revision,
    payload,
    pinned: false,
    fieldClocks: {
      ...(title === undefined ? {} : { title: clock }),
      payload: clock,
      pinned: clock,
    },
  });

  return { item, origin };
}
