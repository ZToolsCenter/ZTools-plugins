// ZTools ccToggle - sessions/shared.ts
// 会话模块公共工具：缓存、文件读取、消息合并、内容块提取

import utils = require('../../utils');
import { ContentBlock, HeadTailResult, Message, Session } from './types';

const fs = utils.fs;

// 文件枚举缓存（app -> 已排序文件列表），避免翻页时重复 readdir/stat
export const ENUM_TTL = 30000;
export const _enumCache: Record<string, { files: any[]; timestamp: number }> = {};

export async function cachedEnum<T>(key: string, produce: () => Promise<T[]>): Promise<T[]> {
  const hit = _enumCache[key];
  if (hit && Date.now() - hit.timestamp < ENUM_TTL) return hit.files as T[];
  const files = await produce();
  _enumCache[key] = { files, timestamp: Date.now() };
  return files;
}

// 大文件优化：只读头尾，提取元数据
const CHUNK_SIZE = 4096;
// 元数据解析并发度：每个文件 1 open + 1 stat + 2 read
export const PARSE_CONCURRENCY = 12;

// 一次打开文件，读取头部和尾部（只 open/stat/close 一次）
export async function readHeadAndTail(filePath: string): Promise<HeadTailResult> {
  let fd: import('fs').promises.FileHandle;
  try {
    fd = await fs.promises.open(filePath, 'r');
  } catch (e) {
    return { head: [], tail: [], size: 0 };
  }
  try {
    const size = (await fd.stat()).size;
    // 读头部
    const headLen = Math.min(CHUNK_SIZE, size);
    const headBuf = Buffer.alloc(headLen);
    await fd.read(headBuf, 0, headLen, 0);
    const head = headBuf.toString('utf8').split(/\r?\n/);

    // 读尾部（文件够大时）
    let tail: string[] = [];
    if (size > CHUNK_SIZE) {
      const tailPos = size - CHUNK_SIZE;
      const tailBuf = Buffer.alloc(CHUNK_SIZE);
      await fd.read(tailBuf, 0, CHUNK_SIZE, tailPos);
      tail = tailBuf.toString('utf8').split(/\r?\n/);
    }

    return { head, tail, size };
  } catch (e) {
    return { head: [], tail: [], size: 0 };
  } finally {
    await fd.close();
  }
}

// 统计 JSONL 中的消息行数（user/assistant/human 类型）
export function countMessageLines(lines: string[]): number {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    try {
      const d = JSON.parse(line);
      if (
        d &&
        (d.type === 'assistant' ||
          d.type === 'human' ||
          d.type === 'user' ||
          (d.type === 'event_msg' &&
            d.payload &&
            (d.payload.type === 'user_message' || d.payload.type === 'agent_message')) ||
          (d.type === 'message' &&
            d.message &&
            (d.message.role === 'user' || d.message.role === 'assistant')))
      )
        count++;
    } catch (e) {
      /* skip */
    }
  }
  return count;
}

// 快速统计消息数：直接数头尾的消息行
export function estimateMessageCount(
  headLines: string[],
  tailLines: string[],
  size: number
): number {
  // 小文件：头尾重叠，直接数头部
  if (size <= CHUNK_SIZE * 2) return countMessageLines(headLines);
  // 大文件：头尾各数一遍（中间的数不到，但比瞎猜准）
  return countMessageLines(headLines) + countMessageLines(tailLines);
}

// 分页解析：只解析当前页的文件，并发执行
export async function parsePage<T>(
  files: T[],
  offset: number,
  limit: number,
  parse: (f: T) => Promise<Session | null>
): Promise<Session[]> {
  if (limit <= 0) return [];
  const slice = limit === Infinity ? files.slice(offset) : files.slice(offset, offset + limit);
  const parsed = await utils.mapLimit(slice, PARSE_CONCURRENCY, parse);
  return parsed.filter(Boolean) as Session[];
}

// 合并连续同角色消息
export function mergeMessages(messages: Message[]): Message[] {
  if (messages.length <= 1) return messages;
  const merged: Message[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = messages[i];
    if (cur.role === prev.role) {
      // 合并 contentBlocks，使用最后一条的时间戳
      prev.contentBlocks = prev.contentBlocks.concat(cur.contentBlocks);
      if (cur.timestamp) prev.timestamp = cur.timestamp;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

// 从 content 字段提取结构化内容块
export function extractContentBlocks(content: unknown): ContentBlock[] {
  if (!content) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) {
    const blocks: ContentBlock[] = [];
    for (let i = 0; i < content.length; i++) {
      const item = content[i];
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text' && item.text) {
        blocks.push({ type: 'text', text: item.text });
      } else if (item.type === 'thinking' && item.thinking) {
        blocks.push({ type: 'thinking', text: item.thinking });
      } else if (item.type === 'tool_use') {
        blocks.push({ type: 'tool_use', name: item.name || 'unknown', input: item.input || {} });
      } else if (item.type === 'toolCall') {
        blocks.push({ type: 'tool_use', name: item.name || 'unknown', input: {} });
      } else if (item.type === 'tool_result') {
        // 工具执行结果：从嵌套的 content 中提取文本
        const resultText = extractToolResultText(item);
        if (resultText)
          blocks.push({ type: 'tool_result', text: resultText, name: item.tool_use_id || '' });
      }
    }
    return blocks;
  }
  return [{ type: 'text', text: JSON.stringify(content) }];
}

// 从 OpenCode tool state.output 数组中提取文本内容
export function extractOpenCodeOutputText(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const o of output) {
    if (!o || typeof o !== 'object') continue;
    const oa: any = o;
    if (oa.type === 'text' && oa.text) parts.push(String(oa.text));
    else if (oa.type === 'tool_result' && oa.text) parts.push(String(oa.text));
  }
  return parts.join('\n');
}

// 从 tool_result 中提取文本内容
export function extractToolResultText(item: Record<string, any>): string {
  if (!item) return '';
  const c = item.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (let i = 0; i < c.length; i++) {
      if (c[i] && c[i].type === 'text' && c[i].text) parts.push(c[i].text);
    }
    return parts.join('\n');
  }
  return '';
}

// 兼容旧接口：提取纯文本
export function extractContent(content: unknown): string {
  const blocks = extractContentBlocks(content);
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'text') parts.push(b.text!);
    else if (b.type === 'thinking') parts.push(b.text!);
    else if (b.type === 'tool_use') parts.push('[工具调用: ' + b.name + ']');
  }
  return parts.join('');
}

export function ocTs(ts: any): string {
  const n = Number(ts);
  if (!n) return '';
  try {
    return new Date(n).toISOString();
  } catch (e) {
    return '';
  }
}
