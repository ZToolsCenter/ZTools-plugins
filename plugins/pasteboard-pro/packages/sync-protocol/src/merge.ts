import type {
  HybridClock,
  PasteItem,
  PastePayload,
  Pinboard,
} from "@pasteboard-pro/core";

import { compareClock } from "./clock";

export type SyncEntityType = "paste_item" | "pinboard";

export type Tombstone = {
  id: string;
  entityType: SyncEntityType;
  deleted: true;
  deletedAt: string;
  sourceDeviceId: string;
  clock: HybridClock;
};

const MINIMUM_CLOCK: HybridClock = {
  // Internal missing-field sentinel; it is never serialized or schema-validated.
  wallMs: Number.NEGATIVE_INFINITY,
  counter: 0,
  deviceId: "",
};

function cloneClock(clock: HybridClock): HybridClock {
  return { ...clock };
}

function fieldClock(
  clocks: Readonly<Record<string, HybridClock>>,
  key: string,
): HybridClock {
  return hasOwn(clocks, key) ? clocks[key]! : MINIMUM_CLOCK;
}

function mergeFieldClocks(
  left: Readonly<Record<string, HybridClock>>,
  right: Readonly<Record<string, HybridClock>>,
): Record<string, HybridClock> {
  const merged: Record<string, HybridClock> = {};

  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const leftClock = fieldClock(left, key);
    const rightClock = fieldClock(right, key);
    const selected =
      compareClock(leftClock, rightClock) < 0 ? rightClock : leftClock;
    Object.defineProperty(merged, key, {
      value: cloneClock(selected),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return merged;
}

function selectField<T>(
  key: string,
  leftValue: T,
  leftClocks: Readonly<Record<string, HybridClock>>,
  rightValue: T,
  rightClocks: Readonly<Record<string, HybridClock>>,
  equal: (left: T, right: T) => boolean = Object.is,
): T {
  const leftClock = fieldClock(leftClocks, key);
  const rightClock = fieldClock(rightClocks, key);
  const clockOrder = compareClock(leftClock, rightClock);

  if (clockOrder < 0) {
    return rightValue;
  }
  if (clockOrder > 0) {
    return leftValue;
  }
  if (!equal(leftValue, rightValue)) {
    throw new RangeError(`Field ${key} has conflicting values at an equal clock`);
  }

  return leftValue;
}

function selectUpdatedAt(left: string, right: string): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    if (leftTime < rightTime) {
      return right;
    }
    if (leftTime > rightTime) {
      return left;
    }
  }

  return left < right ? right : left;
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sourceAppsEqual(
  left: PasteItem["sourceApp"],
  right: PasteItem["sourceApp"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return (
    Object.is(left.bundleId, right.bundleId) && Object.is(left.name, right.name)
  );
}

function optionalPayloadFieldEqual(
  left: PastePayload,
  right: PastePayload,
  key: "text" | "html" | "blobId" | "mediaType",
): boolean {
  return Object.is(left[key], right[key]);
}

function filePathsEqual(left: PastePayload, right: PastePayload): boolean {
  if (left.filePaths === undefined || right.filePaths === undefined) {
    return left.filePaths === right.filePaths;
  }
  return (
    left.filePaths.length === right.filePaths.length &&
    left.filePaths.every((path, index) => path === right.filePaths?.[index])
  );
}

function payloadsEqual(left: PastePayload, right: PastePayload): boolean {
  return (
    left.revision === right.revision &&
    optionalPayloadFieldEqual(left, right, "text") &&
    optionalPayloadFieldEqual(left, right, "html") &&
    optionalPayloadFieldEqual(left, right, "blobId") &&
    optionalPayloadFieldEqual(left, right, "mediaType") &&
    filePathsEqual(left, right)
  );
}

function clonePayload(payload: PastePayload): PastePayload {
  return {
    revision: payload.revision,
    ...(payload.text === undefined ? {} : { text: payload.text }),
    ...(payload.html === undefined ? {} : { html: payload.html }),
    ...(payload.blobId === undefined ? {} : { blobId: payload.blobId }),
    ...(payload.mediaType === undefined ? {} : { mediaType: payload.mediaType }),
    ...(payload.filePaths === undefined
      ? {}
      : { filePaths: [...payload.filePaths] }),
  };
}

function cloneSourceApp(
  sourceApp: Exclude<PasteItem["sourceApp"], undefined>,
): Exclude<PasteItem["sourceApp"], undefined> {
  return {
    ...(sourceApp.bundleId === undefined ? {} : { bundleId: sourceApp.bundleId }),
    ...(sourceApp.name === undefined ? {} : { name: sourceApp.name }),
  };
}

function assertPasteCaptureEqual(left: PasteItem, right: PasteItem): void {
  if (
    left.kind !== right.kind ||
    left.sourceDeviceId !== right.sourceDeviceId ||
    left.copiedAt !== right.copiedAt ||
    left.contentFingerprint !== right.contentFingerprint ||
    !sourceAppsEqual(left.sourceApp, right.sourceApp)
  ) {
    throw new RangeError("Paste items have conflicting immutable capture fields");
  }
}

export function mergePasteItem(left: PasteItem, right: PasteItem): PasteItem {
  if (left.id !== right.id) {
    throw new RangeError("Cannot merge paste items with different ids");
  }
  assertPasteCaptureEqual(left, right);

  if (
    left.payload.revision === right.payload.revision &&
    !payloadsEqual(left.payload, right.payload)
  ) {
    throw new RangeError("A payload revision cannot contain different content");
  }

  const title = selectField(
    "title",
    left.title,
    left.fieldClocks,
    right.title,
    right.fieldClocks,
  );
  const payload = selectField(
    "payload",
    left.payload,
    left.fieldClocks,
    right.payload,
    right.fieldClocks,
    payloadsEqual,
  );
  const ocrText = selectField(
    "ocrText",
    left.ocrText,
    left.fieldClocks,
    right.ocrText,
    right.fieldClocks,
  );
  const pinboardId = selectField(
    "pinboardId",
    left.pinboardId,
    left.fieldClocks,
    right.pinboardId,
    right.fieldClocks,
  );
  const pinboardOrderKey = selectField(
    "pinboardOrderKey",
    left.pinboardOrderKey,
    left.fieldClocks,
    right.pinboardOrderKey,
    right.fieldClocks,
  );
  const pinned = selectField(
    "pinned",
    left.pinned,
    left.fieldClocks,
    right.pinned,
    right.fieldClocks,
  );

  return {
    id: left.id,
    kind: left.kind,
    ...(left.sourceApp === undefined
      ? {}
      : { sourceApp: cloneSourceApp(left.sourceApp) }),
    sourceDeviceId: left.sourceDeviceId,
    copiedAt: left.copiedAt,
    updatedAt: selectUpdatedAt(left.updatedAt, right.updatedAt),
    contentFingerprint: left.contentFingerprint,
    ...(title === undefined ? {} : { title }),
    payload: clonePayload(payload),
    ...(ocrText === undefined ? {} : { ocrText }),
    ...(pinboardId === undefined ? {} : { pinboardId }),
    ...(pinboardOrderKey === undefined ? {} : { pinboardOrderKey }),
    pinned,
    fieldClocks: mergeFieldClocks(left.fieldClocks, right.fieldClocks),
  };
}

export function mergePinboard(left: Pinboard, right: Pinboard): Pinboard {
  if (left.id !== right.id) {
    throw new RangeError("Cannot merge pinboards with different ids");
  }
  if (left.createdAt !== right.createdAt) {
    throw new RangeError("Pinboards have conflicting immutable creation times");
  }

  return {
    id: left.id,
    name: selectField(
      "name",
      left.name,
      left.fieldClocks,
      right.name,
      right.fieldClocks,
    ),
    color: selectField(
      "color",
      left.color,
      left.fieldClocks,
      right.color,
      right.fieldClocks,
    ),
    orderKey: selectField(
      "orderKey",
      left.orderKey,
      left.fieldClocks,
      right.orderKey,
      right.fieldClocks,
    ),
    createdAt: left.createdAt,
    updatedAt: selectUpdatedAt(left.updatedAt, right.updatedAt),
    fieldClocks: mergeFieldClocks(left.fieldClocks, right.fieldClocks),
  };
}

function isTombstone(
  entity: PasteItem | Pinboard | Tombstone,
): entity is Tombstone {
  return "deleted" in entity && entity.deleted === true;
}

function liveEntityType(entity: PasteItem | Pinboard): SyncEntityType {
  return "kind" in entity ? "paste_item" : "pinboard";
}

function maximumLiveClock(entity: PasteItem | Pinboard): HybridClock {
  let maximum = MINIMUM_CLOCK;

  for (const clock of Object.values(entity.fieldClocks)) {
    if (compareClock(clock, maximum) > 0) {
      maximum = clock;
    }
  }

  return maximum;
}

function cloneTombstone(tombstone: Tombstone): Tombstone {
  return {
    id: tombstone.id,
    entityType: tombstone.entityType,
    deleted: true,
    deletedAt: tombstone.deletedAt,
    sourceDeviceId: tombstone.sourceDeviceId,
    clock: cloneClock(tombstone.clock),
  };
}

function tombstonesEqual(left: Tombstone, right: Tombstone): boolean {
  return (
    left.id === right.id &&
    left.entityType === right.entityType &&
    left.deleted === right.deleted &&
    left.deletedAt === right.deletedAt &&
    left.sourceDeviceId === right.sourceDeviceId &&
    compareClock(left.clock, right.clock) === 0
  );
}

function cloneLiveEntity(entity: PasteItem | Pinboard): PasteItem | Pinboard {
  return liveEntityType(entity) === "paste_item"
    ? mergePasteItem(entity as PasteItem, entity as PasteItem)
    : mergePinboard(entity as Pinboard, entity as Pinboard);
}

export function mergeEntity(
  left: PasteItem | Pinboard | Tombstone,
  right: PasteItem | Pinboard | Tombstone,
): PasteItem | Pinboard | Tombstone {
  if (left.id !== right.id) {
    throw new RangeError("Cannot merge entities with different ids");
  }

  const leftDeleted = isTombstone(left);
  const rightDeleted = isTombstone(right);

  if (leftDeleted && rightDeleted) {
    if (left.entityType !== right.entityType) {
      throw new RangeError("Cannot merge tombstones for different entity types");
    }
    const clockOrder = compareClock(left.clock, right.clock);
    if (clockOrder === 0 && !tombstonesEqual(left, right)) {
      throw new RangeError("Tombstones have conflicting metadata at an equal clock");
    }
    return cloneTombstone(clockOrder < 0 ? right : left);
  }

  if (!leftDeleted && !rightDeleted) {
    const leftType = liveEntityType(left);
    const rightType = liveEntityType(right);
    if (leftType !== rightType) {
      throw new RangeError("Cannot merge different live entity types");
    }
    return leftType === "paste_item"
      ? mergePasteItem(left as PasteItem, right as PasteItem)
      : mergePinboard(left as Pinboard, right as Pinboard);
  }

  const deleted = leftDeleted ? left : (right as Tombstone);
  const live = leftDeleted
    ? (right as PasteItem | Pinboard)
    : (left as PasteItem | Pinboard);

  if (deleted.entityType !== liveEntityType(live)) {
    throw new RangeError("Tombstone entity type does not match the live entity");
  }

  return compareClock(deleted.clock, maximumLiveClock(live)) >= 0
    ? cloneTombstone(deleted)
    : cloneLiveEntity(live);
}
