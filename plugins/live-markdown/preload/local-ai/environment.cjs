"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { getAvailableMemory: getPlatformAvailableMemory } = require("./memory-info.cjs");
const { getDiskFreeBytes: getPlatformDiskFreeBytes } = require("./disk-info.cjs");

const FREE_MEMORY_RESERVE_BYTES = 1536 * 1024 * 1024;
const STARTUP_RESERVE_BYTES = 128 * 1024 * 1024;
const MODEL_MEMORY_FACTOR = 1.25;

function getDiskFreeBytes(directory, fsApi = fs, platform = process.platform, diskOptions = {}) {
  return getPlatformDiskFreeBytes(directory, { ...diskOptions, fs: fsApi, platform });
}

function getAvailableMemory(osApi = os, platform = process.platform, memoryOptions = {}) {
  return getPlatformAvailableMemory({ ...memoryOptions, platform, os: osApi });
}

function profileFitsResources(profile, _resources, availableMemory) {
  if (!profile.available || !profile.runtime || !profile.model) return { available: false, reason: "此设备没有完整的受信任运行资源清单" };
  const modelBytes = Number(profile.model.memoryBytes || profile.model.size);
  if (!Number.isSafeInteger(modelBytes) || modelBytes <= 0) return { available: false, reason: "模型内存需求尚未经过设备验证" };
  const required = Math.ceil(modelBytes * MODEL_MEMORY_FACTOR + FREE_MEMORY_RESERVE_BYTES + STARTUP_RESERVE_BYTES);
  if (availableMemory < required) return { available: false, reason: "可用内存不足，模型仍可能拖慢编辑器" };
  return { available: true, required };
}

function extractedBytes(resource) {
  if (!resource || !Array.isArray(resource.files)) return 0;
  return resource.files.reduce((total, file) => total + (Number.isSafeInteger(file.size) ? file.size : 0), 0);
}

module.exports = {
  FREE_MEMORY_RESERVE_BYTES,
  STARTUP_RESERVE_BYTES,
  MODEL_MEMORY_FACTOR,
  getDiskFreeBytes,
  getAvailableMemory,
  profileFitsResources,
  extractedBytes
};
