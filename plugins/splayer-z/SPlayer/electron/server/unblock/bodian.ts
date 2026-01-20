import { SongUrlResult } from "./unblock";
import { serverLog } from "../../main/logger";
import { createHash } from "crypto";
import axios from "axios";

/**
 * 生成随机设备 ID
 * @returns 随机设备 ID
 */
const getRandomDeviceId = () => {
  const min = 0;
  const max = 100000000000;
  const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomNum.toString();
};

/** 随机设备 ID */
const deviceId = getRandomDeviceId();

/**
 * 格式化歌曲信息
 * @param song 歌曲信息
 * @returns 格式化后的歌曲信息
 */
const format = (song: any) => ({
  id: song.MUSICRID.split("_").pop(),
  name: song.SONGNAME,
  duration: song.DURATION * 1000,
  album: { id: song.ALBUMID, name: song.ALBUM },
  artists: song.ARTIST.split("&").map((name: any, index: any) => ({
    id: index ? null : song.ARTISTID,
    name,
  })),
});

/**
 * 生成签名
 * @param str 请求字符串
 * @returns 包含签名的请求字符串
 */
const generateSign = (str: string) => {
  const url = new URL(str);

  const currentTime = Date.now();
  str += `&timestamp=${currentTime}`;

  const filteredChars = str
    .substring(str.indexOf("?") + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .split("")
    .sort();

  const dataToEncrypt = `kuwotest${filteredChars.join("")}${url.pathname}`;
  const md5 = createHash("md5").update(dataToEncrypt).digest("hex");
  return `${str}&sign=${md5}`;
};

/**
 * 搜索歌曲
 * @param keyword 搜索关键词
 * @returns 歌曲 ID 或 null
 */
const search = async (info: string): Promise<string | null> => {
  try {
    const keyword = encodeURIComponent(info.replace(" - ", " "));
    const url =
      "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
      "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
      keyword;
    const result = await axios.get(url);
    if (
      !result.data ||
      result.data.content.length < 2 ||
      !result.data.content[1].musicpage ||
      result.data.content[1].musicpage.abslist.length < 1
    ) {
      return null;
    }
    // 获取歌曲信息
    const list = result.data.content[1].musicpage.abslist.map(format);
    if (list[0] && !list[0]?.id) return null;
    return list[0].id;
  } catch (error) {
    serverLog.error("❌ Get BodianSongId Error:", error);
    return null;
  }
};

/**
 * 发送广告免费请求
 * @returns 包含广告免费响应的 Promise
 */
const sendAdFreeRequest = () => {
  try {
    const adurl =
      "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";

    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar",
      channel: "aliopen",
      devid: deviceId,
      ver: "3.9.0",
      host: "bd-api.kuwo.cn",
      qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
      "content-type": "application/json; charset=utf-8",
    };

    const data = JSON.stringify({
      type: 5,
      subType: 5,
      musicId: 0,
      adToken: "",
    });
    return axios.post(adurl, data, { headers });
  } catch (error) {
    serverLog.error("❌ Get Bodian Ad Free Error:", error);
    return null;
  }
};

/**
 * 获取波点音乐歌曲 URL
 * @param keyword 搜索关键词
 * @returns 包含歌曲 URL 的结果对象
 */
const getBodianSongUrl = async (keyword: string): Promise<SongUrlResult> => {
  try {
    if (!keyword) return { code: 404, url: null };
    const songId = await search(keyword);
    if (!songId) return { code: 404, url: null };
    // 请求地址
    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar",
      channel: "aliopen",
      devid: deviceId,
      ver: "3.9.0",
      host: "bd-api.kuwo.cn",
      "X-Forwarded-For": "1.0.1.114",
    };
    let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${"320kmp3"}&musicId=${songId}`;
    // 生成签名
    audioUrl = generateSign(audioUrl);
    // 获取广告
    await sendAdFreeRequest();
    // 获取歌曲地址
    const result = await axios.get(audioUrl, { headers });
    if (typeof result.data === "object") {
      const urlMatch = result.data.data.audioUrl;
      serverLog.log("🔗 BodianSong URL:", urlMatch);
      return { code: 200, url: urlMatch };
    }
    return { code: 404, url: null };
  } catch (error) {
    serverLog.error("❌ Get BodianSong URL Error:", error);
    return { code: 404, url: null };
  }
};

export default getBodianSongUrl;
