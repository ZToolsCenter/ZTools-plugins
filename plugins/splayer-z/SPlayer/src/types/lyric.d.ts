import { type LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 歌词数据类型
 */
export interface SongLyric {
  lrcData: LyricLine[];
  yrcData: LyricLine[];
}
