import {
  VAULT_OBJECT_TYPES,
  VAULT_VERSION,
  type VaultObjectDescriptor,
  type VaultObjectEnvelope,
  type VaultObjectType,
} from "./crypto-contract";

const textEncoder = new TextEncoder();
const OBJECT_TYPE_SET = new Set<string>(VAULT_OBJECT_TYPES);
const ENVELOPE_KEYS = new Set([
  "version",
  "objectType",
  "objectId",
  "revision",
  "nonce",
  "ciphertext",
]);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertPlainObject(value: object): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON only accepts plain objects");
  }
}

function normalizeJson(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON numbers must be finite");
    }
    return value;
  }
  if (typeof value === "undefined") {
    throw new TypeError("Canonical JSON does not support undefined");
  }
  if (typeof value === "bigint") {
    throw new TypeError("Canonical JSON does not support BigInt");
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Canonical JSON does not support sparse arrays");
        }
        return normalizeJson(value[index], ancestors);
      });
    }

    assertPlainObject(value);
    const normalized: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJson(value[key], ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set())) as string;
}

function assertDescriptorString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new TypeError(`${field} cannot contain a NUL byte`);
  }
}

export function parseVaultObjectDescriptor(value: unknown): VaultObjectDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Vault object descriptor must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== VAULT_VERSION) {
    throw new RangeError(`Unsupported vault object version: ${String(input.version)}`);
  }
  if (typeof input.objectType !== "string" || !OBJECT_TYPE_SET.has(input.objectType)) {
    throw new TypeError(`Unsupported vault object type: ${String(input.objectType)}`);
  }
  assertDescriptorString(input.objectId, "objectId");
  assertDescriptorString(input.revision, "revision");

  return {
    version: VAULT_VERSION,
    objectType: input.objectType as VaultObjectType,
    objectId: input.objectId,
    revision: input.revision,
  };
}

export function objectAad(descriptor: VaultObjectDescriptor): Uint8Array {
  const parsed = parseVaultObjectDescriptor(descriptor);
  return textEncoder.encode(
    `${parsed.version}\0${parsed.objectType}\0${parsed.objectId}\0${parsed.revision}`,
  );
}

function pathSegment(value: string, field: string): string {
  if (value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new TypeError(`${field} is not a safe object path segment`);
  }
  return encodeURIComponent(value);
}

export function objectPath(descriptor: VaultObjectDescriptor): string {
  const parsed = parseVaultObjectDescriptor(descriptor);
  return `objects/${parsed.objectType}/${pathSegment(parsed.objectId, "objectId")}/${pathSegment(parsed.revision, "revision")}.enc`;
}

function assertBase64(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new TypeError(`${field} must be canonical base64`);
  }
}

export function parseVaultEnvelope(value: unknown): VaultObjectEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Vault object envelope must be an object");
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new TypeError(`Unknown vault envelope field: ${key}`);
    }
  }
  const descriptor = parseVaultObjectDescriptor(input);
  assertBase64(input.nonce, "nonce");
  assertBase64(input.ciphertext, "ciphertext");

  return {
    ...descriptor,
    nonce: input.nonce,
    ciphertext: input.ciphertext,
  };
}
