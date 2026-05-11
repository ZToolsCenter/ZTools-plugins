import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";

/**
 * 装饰器缓存项
 */
interface CacheItem {
  hash: string;
  lastUpdate: number;
}

/**
 * 装饰器管理器
 *
 * 统一管理Monaco编辑器装饰器的生命周期，解决装饰器残留和性能问题
 *
 * 主要功能：
 * 1. 基于内容哈希的智能缓存机制
 * 2. 统一的装饰器清理和注册
 * 3. 按行号和类型组织装饰器
 * 4. 自动检测内容变化并失效缓存
 */
export class DecorationManager {
  private decorations = new Map<string, Set<string>>();
  private contentCache = new Map<number, CacheItem>();
  private zIndex: number;

  constructor(zIndex: number = 3000) {
    this.zIndex = zIndex;
  }

  /**
   * 生成内容哈希
   * @param content 文本内容
   * @returns 内容哈希值
   */
  private generateHash(content: string): string {
    let hash = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);

      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * 检查内容是否发生变化
   * @param lineNumber 行号
   * @param content 当前行内容
   * @returns 是否内容已变化
   */
  hasContentChanged(lineNumber: number, content: string): boolean {
    const currentHash = this.generateHash(content);
    const cacheItem = this.contentCache.get(lineNumber);

    if (!cacheItem) {
      return true; // 首次处理视为变化
    }

    return cacheItem.hash !== currentHash;
  }

  /**
   * 更新内容缓存
   * @param lineNumber 行号
   * @param content 当前行内容
   */
  updateContentCache(lineNumber: number, content: string): void {
    const hash = this.generateHash(content);

    this.contentCache.set(lineNumber, {
      hash,
      lastUpdate: Date.now(),
    });
  }

  /**
   * 清理指定行的所有装饰器
   * @param editor 编辑器实例
   * @param lineNumber 行号
   */
  clearLineDecorations(
    editor: editor.IStandaloneCodeEditor,
    lineNumber: number,
  ): void {
    const key = lineNumber.toString();
    const decorationIds = this.decorations.get(key);

    if (decorationIds?.size) {
      editor.removeDecorations(Array.from(decorationIds));
      this.decorations.delete(key);
    }

    // 清理内容缓存
    this.contentCache.delete(lineNumber);
  }

  /**
   * 清理指定范围内所有装饰器
   * @param editor 编辑器实例
   * @param startLine 起始行号
   * @param endLine 结束行号
   */
  clearRangeDecorations(
    editor: editor.IStandaloneCodeEditor,
    startLine: number,
    endLine: number,
  ): void {
    for (let line = startLine; line <= endLine; line++) {
      this.clearLineDecorations(editor, line);
    }
  }

  /**
   * 清理所有装饰器
   * @param editor 编辑器实例
   */
  clearAllDecorations(editor: editor.IStandaloneCodeEditor): void {
    const allDecorationIds: string[] = [];

    for (const decorationSet of this.decorations.values()) {
      allDecorationIds.push(...Array.from(decorationSet));
    }

    if (allDecorationIds.length > 0) {
      editor.removeDecorations(allDecorationIds);
    }

    this.decorations.clear();
    this.contentCache.clear();
  }

  /**
   * 注册装饰器
   * @param lineNumber 行号
   * @param decorationId 装饰器ID
   */
  registerDecoration(lineNumber: number, decorationId: string): void {
    const key = lineNumber.toString();

    if (!this.decorations.has(key)) {
      this.decorations.set(key, new Set());
    }
    this.decorations.get(key)!.add(decorationId);
  }

  /**
   * 批量应用装饰器
   * @param editor 编辑器实例
   * @param decorations 装饰器配置数组
   * @returns 装饰器ID数组
   */
  applyDecorations(
    editor: editor.IStandaloneCodeEditor,
    decorations: monaco.editor.IModelDeltaDecoration[],
  ): string[] {
    if (decorations.length === 0) {
      return [];
    }

    const enrichedDecorations = decorations.map((decoration) => ({
      ...decoration,
      options: {
        ...decoration.options,
        zIndex: decoration.options.zIndex || this.zIndex,
      },
    }));

    const decorationIds = editor
      .createDecorationsCollection()
      .set(enrichedDecorations);

    // 注册装饰器到管理器
    decorationIds.forEach((id, index) => {
      const decoration = enrichedDecorations[index];
      const lineNumber = decoration.range.startLineNumber;

      this.registerDecoration(lineNumber, id);
    });

    return decorationIds;
  }

  /**
   * 检查行是否需要处理
   * @param lineNumber 行号
   * @param content 当前行内容
   * @param maxLength 最大长度限制
   * @returns 是否需要处理
   */
  shouldProcessLine(
    lineNumber: number,
    content: string,
    maxLength: number = 1000,
  ): boolean {
    // 超过长度限制的行跳过
    if (content.length > maxLength) {
      return false;
    }

    // 内容未变化的行跳过
    return this.hasContentChanged(lineNumber, content);
  }

  /**
   * 获取行的装饰器数量
   * @param lineNumber 行号
   * @returns 装饰器数量
   */
  getLineDecorationCount(lineNumber: number): number {
    const key = lineNumber.toString();

    return this.decorations.get(key)?.size || 0;
  }

  /**
   * 获取管理器统计信息
   * @returns 统计信息
   */
  getStats(): {
    totalDecorations: number;
    cachedLines: number;
    linesWithDecorations: number;
  } {
    let totalDecorations = 0;
    let linesWithDecorations = 0;

    for (const decorationSet of this.decorations.values()) {
      totalDecorations += decorationSet.size;
      linesWithDecorations++;
    }

    return {
      totalDecorations,
      cachedLines: this.contentCache.size,
      linesWithDecorations,
    };
  }

  /**
   * 清理过期的缓存项
   * @param maxAge 最大缓存时间（毫秒）
   */
  cleanupExpiredCache(maxAge: number = 5 * 60 * 1000): void {
    const now = Date.now();
    const expiredLines: number[] = [];

    for (const [lineNumber, cacheItem] of this.contentCache.entries()) {
      if (now - cacheItem.lastUpdate > maxAge) {
        expiredLines.push(lineNumber);
      }
    }

    expiredLines.forEach((lineNumber) => {
      this.contentCache.delete(lineNumber);
    });
  }
}

/**
 * 创建装饰器管理器实例的工厂函数
 * @param zIndex z-index值
 * @returns 装饰器管理器实例
 */
export const createDecorationManager = (zIndex?: number): DecorationManager => {
  return new DecorationManager(zIndex);
};
