/**
 * 数据完整性校验器
 * 提供数据校验和版本向量比较功能
 */

import crypto from "crypto";

import { VersionVector } from "./types";

export class DataIntegrityChecker {
  /**
   * 计算数据的校验和
   */
  static calculateChecksum(data: any): string {
    try {
      const json = JSON.stringify(data);
      const hash = crypto.createHash("sha256");

      hash.update(json);

      return hash.digest("hex");
    } catch (error) {
      console.error("计算校验和失败:", error);

      return "";
    }
  }

  /**
   * 验证数据完整性
   */
  static validate(data: any, checksum: string): boolean {
    const calculated = this.calculateChecksum(data);

    return calculated === checksum;
  }

  /**
   * 比较版本向量
   * 返回: 1 (v1 > v2), -1 (v1 < v2), 0 (冲突)
   */
  static compareVersions(v1: VersionVector, v2: VersionVector): number {
    const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
    let greater = false;
    let lesser = false;

    for (const key of allKeys) {
      const version1 = v1[key] || 0;
      const version2 = v2[key] || 0;

      if (version1 > version2) {
        greater = true;
      } else if (version1 < version2) {
        lesser = true;
      }
    }

    if (greater && !lesser) return 1;
    if (lesser && !greater) return -1;

    return 0; // 并发冲突
  }

  /**
   * 合并版本向量
   */
  static mergeVersions(v1: VersionVector, v2: VersionVector): VersionVector {
    const merged: VersionVector = { ...v1 };

    for (const key of Object.keys(v2)) {
      merged[key] = Math.max(merged[key] || 0, v2[key]);
    }

    return merged;
  }

  /**
   * 验证数据结构
   */
  static validateStructure(data: any, schema?: any): boolean {
    if (data === null || data === undefined) {
      return false;
    }

    // 如果提供了 schema，进行深度验证
    if (schema) {
      return this.validateAgainstSchema(data, schema);
    }

    // 基本验证
    try {
      JSON.stringify(data);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 根据验证模式验证数据
   */
  private static validateAgainstSchema(data: any, schema: any): boolean {
    // 简单的 schema 验证实现
    // 可以根据需要扩展为更复杂的验证逻辑
    if (schema.type) {
      const dataType = Array.isArray(data) ? "array" : typeof data;

      if (dataType !== schema.type) {
        return false;
      }
    }

    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in data)) {
          return false;
        }
      }
    }

    return true;
  }
}
