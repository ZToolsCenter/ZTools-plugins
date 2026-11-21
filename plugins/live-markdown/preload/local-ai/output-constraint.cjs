"use strict";

const MAX_SCHEMA_BYTES = 32 * 1024;
const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_NODES = 2_048;
const MAX_STRING_LENGTH = 1_000_000;
const JSON_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const SCHEMA_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "anyOf", "const", "enum", "minLength", "maxLength", "items", "minItems", "maxItems", "$defs", "$ref"
]);

function fail(message) {
  throw new Error(`Invalid local AI output schema: ${message}`);
}

function cloneJsonValue(value) {
  const active = new WeakSet();
  const state = { nodes: 0, stringBytes: 0 };
  const countString = (value) => {
    state.stringBytes += Buffer.byteLength(value, "utf8");
    if (state.stringBytes > MAX_SCHEMA_BYTES) fail("serialized schema exceeds 32 KiB");
  };

  function clone(node, depth) {
    state.nodes++;
    if (state.nodes > MAX_SCHEMA_NODES) fail("schema exceeds 2048 JSON nodes");
    if (depth > MAX_SCHEMA_DEPTH) fail("schema exceeds 16 levels of nesting");
    if (typeof node === "string") { countString(node); return node; }
    if (node === null || typeof node === "boolean") return node;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) fail("non-finite numbers are not supported");
      return node;
    }
    if (typeof node !== "object") fail("only JSON values are supported");
    if (active.has(node)) fail("circular references are not supported");
    active.add(node);
    try {
      if (Array.isArray(node)) {
        if (Object.getPrototypeOf(node) !== Array.prototype) fail("arrays must be plain arrays");
        if (Reflect.ownKeys(node).some((key) => typeof key === "symbol")) fail("symbol keys are not supported");
        const copy = [];
        for (let index = 0; index < node.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("sparse arrays and accessors are not supported");
          copy.push(clone(descriptor.value, depth + 1));
        }
        if (Reflect.ownKeys(node).some((key) => key !== "length" &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length || String(Number(key)) !== key))) {
          fail("arrays may not contain custom properties");
        }
        return copy;
      }
      const prototype = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null) fail("objects must be plain objects");
      if (Reflect.ownKeys(node).some((key) => typeof key === "symbol")) fail("symbol keys are not supported");
      const copy = Object.create(null);
      for (const key of Reflect.ownKeys(node)) {
        countString(key);
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor.enumerable || !("value" in descriptor)) fail("non-enumerable properties and accessors are not supported");
        copy[key] = clone(descriptor.value, depth + 1);
      }
      return copy;
    } finally {
      active.delete(node);
    }
  }

  const cloned = clone(value, 0);
  if (!cloned || Array.isArray(cloned) || typeof cloned !== "object") fail("the root must be a schema object");
  const serialized = JSON.stringify(cloned);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES) fail("serialized schema exceeds 32 KiB");
  return cloned;
}

function isRecord(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function validateType(value, path) {
  const types = Array.isArray(value) ? value : [value];
  if (!types.length || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type)) || new Set(types).size !== types.length) {
    fail(`${path} must contain supported, unique JSON types`);
  }
}

function validateSchemaNode(schema, path, allowDefinitions = false) {
  if (!isRecord(schema)) fail(`${path} must be a schema object`);
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS.has(key)) fail(`unsupported keyword ${JSON.stringify(key)} at ${path}`);
    if (key === "$defs" && !allowDefinitions) fail(`$defs is only supported at the root`);
  }
  if (Object.hasOwn(schema, "type")) validateType(schema.type, `${path}.type`);
  if (Object.hasOwn(schema, "properties")) {
    if (!isRecord(schema.properties)) fail(`${path}.properties must be an object`);
    for (const [name, child] of Object.entries(schema.properties)) validateSchemaNode(child, `${path}.properties.${name}`);
  }
  if (Object.hasOwn(schema, "required")) {
    if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== "string") || new Set(schema.required).size !== schema.required.length) {
      fail(`${path}.required must be an array of unique property names`);
    }
  }
  if (Object.hasOwn(schema, "additionalProperties")) {
    const value = schema.additionalProperties;
    if (typeof value !== "boolean") validateSchemaNode(value, `${path}.additionalProperties`);
  }
  if (Object.hasOwn(schema, "items")) validateSchemaNode(schema.items, `${path}.items`);
  for (const key of ["minItems", "maxItems"]) {
    if (Object.hasOwn(schema, key) && (!Number.isInteger(schema[key]) || schema[key] < 0 || schema[key] > 256)) {
      fail(`${path}.${key} must be an integer from 0 to 256`);
    }
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) fail(`${path} has conflicting array lengths`);
  if (Object.hasOwn(schema, "anyOf")) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) fail(`${path}.anyOf must be a non-empty array`);
    schema.anyOf.forEach((child, index) => validateSchemaNode(child, `${path}.anyOf[${index}]`));
  }
  if (Object.hasOwn(schema, "enum") && (!Array.isArray(schema.enum) || schema.enum.length === 0)) fail(`${path}.enum must be a non-empty array`);
  for (const key of ["minLength", "maxLength"]) {
    if (Object.hasOwn(schema, key) && (!Number.isInteger(schema[key]) || schema[key] < 0 || schema[key] > MAX_STRING_LENGTH)) {
      fail(`${path}.${key} must be an integer from 0 to ${MAX_STRING_LENGTH}`);
    }
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength) fail(`${path} has conflicting string lengths`);
  if (Object.hasOwn(schema, "$ref") && typeof schema.$ref !== "string") fail(`${path}.$ref must be a local $defs reference`);
}

function decodeDefinitionRef(reference) {
  const prefix = "#/$defs/";
  if (!reference.startsWith(prefix)) fail("external or unsupported $ref values are not allowed");
  const token = reference.slice(prefix.length);
  if (!token || token.includes("/") || /~(?![01])/.test(token)) fail("$ref must point to one root $defs entry");
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function collectRefs(schema, refs = []) {
  if (Object.hasOwn(schema, "$ref")) refs.push(decodeDefinitionRef(schema.$ref));
  if (schema.properties) for (const child of Object.values(schema.properties)) collectRefs(child, refs);
  if (isRecord(schema.additionalProperties)) collectRefs(schema.additionalProperties, refs);
  if (schema.anyOf) for (const child of schema.anyOf) collectRefs(child, refs);
  if (schema.items) collectRefs(schema.items, refs);
  return refs;
}

function validateDefinitionGraph(root) {
  const definitions = root.$defs || Object.create(null);
  const graph = new Map();
  graph.set("root", collectRefs(root).map((name) => `def:${name}`));
  for (const [name, schema] of Object.entries(definitions)) graph.set(`def:${name}`, collectRefs(schema).map((dependency) => `def:${dependency}`));
  for (const refs of graph.values()) {
    for (const target of refs) {
      const name = target.slice(4);
      if (!Object.hasOwn(definitions, name)) fail(`$ref target ${JSON.stringify(name)} is missing`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) fail("recursive $defs references are not supported");
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of graph.get(name) || []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of graph.keys()) visit(name);
}

function validateOutputSchema(schema) {
  const safeSchema = cloneJsonValue(schema);
  validateSchemaNode(safeSchema, "$", true);
  if (Object.hasOwn(safeSchema, "$defs")) {
    if (!isRecord(safeSchema.$defs)) fail("$defs must be an object");
    for (const [name, definition] of Object.entries(safeSchema.$defs)) {
      if (!name) fail("$defs entry names must not be empty");
      validateSchemaNode(definition, `.$defs.${name}`);
    }
  }
  validateDefinitionGraph(safeSchema);
  return safeSchema;
}

module.exports = { MAX_SCHEMA_BYTES, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES, validateOutputSchema };
