import { LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 计算歌词索引
 * @param currentTime 当前播放时间 (ms)
 * @param lyrics 原始歌词数组
 * @param offset 偏移量
 * @returns 歌词索引
 */
export const calculateLyricIndex = (
  currentTime: number,
  lyrics: LyricLine[],
  offset: number = 0,
): number => {
  // 边界检查
  if (!lyrics || !lyrics.length) return -1;
  // 预处理时间
  const playSeek = currentTime + offset + 300;
  const getStart = (v: LyricLine) => v.startTime || 0;
  // 直接返回最后一句
  const lastLine = lyrics[lyrics.length - 1];
  if (playSeek >= (lastLine.endTime ?? Infinity)) {
    return lyrics.length - 1;
  }
  // 普通歌词
  const isLrc = !lyrics[0].endTime;
  if (isLrc) {
    const idx = lyrics.findIndex((v) => getStart(v) >= playSeek);
    return idx === -1 ? lyrics.length - 1 : idx - 1;
  }

  // 逐字歌词
  if (playSeek < getStart(lyrics[0])) return -1;
  const activeCandidates: number[] = [];
  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (getStart(line) > playSeek) break;
    const end = line.endTime ?? Infinity;
    if (playSeek >= getStart(line) && playSeek < end) {
      activeCandidates.push(i);
    }
  }
  // 不在任何区间 -> 找最近的上一句
  if (activeCandidates.length === 0) {
    const next = lyrics.findIndex((v) => getStart(v) > playSeek);
    return next === -1 ? lyrics.length - 1 : next - 1;
  }
  // 多句激活处理
  if (activeCandidates.length === 1) return activeCandidates[0];
  const keepCount = activeCandidates.length >= 3 ? 3 : 2;
  const concurrent = activeCandidates.slice(-keepCount);
  return concurrent[0];
};
