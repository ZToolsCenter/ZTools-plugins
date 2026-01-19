import request from "@/utils/request";

/**
 * QQ 音乐模糊匹配歌词响应
 */
export interface QQMusicMatchResponse {
  code: number;
  song?: {
    id: string;
    mid: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
  };
  /** LRC 格式歌词 */
  lrc?: string;
  /** QRC 逐字歌词原始内容 */
  qrc?: string;
  /** 翻译歌词 */
  trans?: string;
  /** 罗马音歌词 */
  roma?: string;
  message?: string;
}

/**
 * QQ 音乐模糊匹配获取歌词
 * @param keyword 搜索关键词（建议格式：歌曲名-歌手名）
 * @returns 歌词数据
 */
export const qqMusicMatch = (keyword: string): Promise<QQMusicMatchResponse> => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/match",
    params: { keyword },
  });
};

/**
 * QQ 音乐搜索歌曲
 * @param keyword 搜索关键词
 * @param page 页码
 * @param pageSize 每页数量
 */
export const qqMusicSearch = (keyword: string, page = 1, pageSize = 20) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/search",
    params: { keyword, page, pageSize },
  });
};

/**
 * QQ 音乐获取歌词
 * @param id 歌曲 ID（数字）
 * @param name 歌曲名称
 * @param artist 歌手名称
 */
export const qqMusicLyric = (id: number, name?: string, artist?: string) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/lyric",
    params: { id, name, artist },
  });
};
