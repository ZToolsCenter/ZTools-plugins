import { songDetail } from "@/api/song";
import { formatSongsList } from "@/utils/format";
import { usePlayerController } from "@/core/player/PlayerController";

class OrpheusData {
  constructor(type: string, id: number, cmd: string) {
    this.type = type;
    this.id = id;
    this.cmd = cmd;
  }

  type: string;
  id: number;
  cmd: string;
}

/**
 * 发送 注册/取消注册 协议的 Ipc
 * @param protocol 协议名
 * @param register true 则注册，false 则取消注册
 */
export const sendRegisterProtocol = (protocol: string, register: boolean = true) => {
  if (register) {
    window.electron.ipcRenderer.send("register-protocol", protocol);
  } else {
    window.electron.ipcRenderer.send("unregister-protocol", protocol);
  }
};

export const handleProtocolUrl = (url: string) => {
  switch (true) {
    case url.startsWith("orpheus://"):
      handleOpenOrpheus(url);
      break;
    default:
      break;
  }
};

export const handleOpenOrpheus = async (url: string) => {
  const data = parseOrpheus(url);
  if (!data) return;
  console.log("🚀 Open Orpheus:", data);

  if (data.cmd === "play" && data.type === "song") {
    const player = usePlayerController();
    const result = await songDetail(data.id);
    const song = formatSongsList(result.songs)[0];
    player.addNextSong(song, true);
  } else {
    console.log("❌ Unsupported Command or Type:", data);
  }
};

const parseOrpheus = (url: string): OrpheusData | undefined => {
  // 这里的协议是从网页端打开官方客户端的协议
  // 形如 `orpheus://eyJ0eXBlIjoic29uZyIsImlkIjoiMTgyNjM2MTcxMiIsImNtZCI6InBsYXkifQ==`
  // URI 的 Path 部分是 Base64 编码过的，解码后得到 Json
  // 形如 `{"type":"song","id":"1826361712","cmd":"play"}`

  if (!url.startsWith("orpheus://")) return;
  let path = url.replace("orpheus://", "");
  // 移除末尾可能存在的斜杠
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  // 尝试 URL 解码
  try {
    path = decodeURIComponent(path);
  } catch (e) {
    console.warn("URL Decode failed, using original path:", e);
  }
  // 处理 URL-safe Base64
  path = path.replace(/-/g, "+").replace(/_/g, "/");
  // 补全 Base64 填充
  const padding = path.length % 4;
  if (padding > 0) {
    path += "=".repeat(4 - padding);
  }
  let jsonString: string;
  try {
    jsonString = atob(path);
  } catch (e) {
    console.error("❌ Failed to decode base64:", path, e);
    return;
  }
  let data: OrpheusData;
  try {
    const json = JSON.parse(jsonString);
    data = new OrpheusData(json.type, json.id, json.cmd);
  } catch (e) {
    console.error("❌ Invalid Data:", e);
    return;
  }
  return data;
};
