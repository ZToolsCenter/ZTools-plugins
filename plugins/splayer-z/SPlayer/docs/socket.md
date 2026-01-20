# WebSocket API

**基础路径**: `ws://localhost:25885` (默认端口，可在设置中修改)

## 概述

WebSocket API 提供了实时双向通信能力，可以控制播放器并接收播放状态更新。

## 连接

```javascript
const ws = new WebSocket("ws://localhost:25885");
```

## 消息格式

所有消息都遵循以下 JSON 格式：

```json
{
  "type": "消息类型",
  "data": {}
}
```

## 控制播放器

**消息类型**: `control`

**请求格式**:

```json
{
  "type": "control",
  "data": {
    "command": "toggle|play|pause|next|prev"
  }
}
```

**命令说明**:

- `toggle` - 播放/暂停切换
- `play` - 播放
- `pause` - 暂停
- `next` - 下一曲
- `prev` - 上一曲

**响应格式**:

成功响应：

```json
{
  "type": "control-response",
  "data": {
    "success": true,
    "command": "toggle",
    "message": "播放/暂停切换命令已执行"
  }
}
```

错误响应：

```json
{
  "type": "error",
  "data": {
    "message": "错误信息"
  }
}
```

**使用示例**:

```javascript
// 连接 WebSocket
const ws = new WebSocket("ws://localhost:25885");

// 连接成功后发送控制命令
ws.onopen = () => {
  // 播放/暂停切换
  ws.send(
    JSON.stringify({
      type: "control",
      data: {
        command: "toggle",
      },
    }),
  );

  // 下一曲
  ws.send(
    JSON.stringify({
      type: "control",
      data: {
        command: "next",
      },
    }),
  );
};

// 接收消息
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("收到消息:", message);
};
```

## 获取信息

**消息类型**: `get-song-info`

**请求格式**:

```json
{
  "type": "get-song-info"
}
```

**响应格式**:

成功响应：

```json
{
  "type": "song-info",
  "data": {
    "playStatus": "play",
    "playName": "歌曲名",
    "artistName": "歌手名",
    "albumName": "专辑名",
    "currentTime": 123.45,
    "volume": 1,
    "playRate": 1,
    "id": 123456,
    "name": "歌曲名",
    "artists": "歌手名",
    "album": "专辑名",
    "cover": "http://...",
    "duration": 300,
    "lrcData": [],
    "yrcData": []
  }
}
```

错误响应：

```json
{
  "type": "error",
  "data": {
    "message": "获取当前播放信息失败"
  }
}
```

## 事件广播

当播放器状态发生变化时，服务器会向所有连接的客户端广播消息。

### 欢迎消息

连接成功后，服务器会自动发送欢迎消息：

```json
{
  "type": "welcome",
  "data": {
    "message": "欢迎连接到 SPlayer WebSocket 服务",
    "timestamp": 1234567890123
  }
}
```

### 播放状态更新

当播放/暂停状态改变时触发：

```json
{
  "type": "status-change",
  "data": {
    "status": true, // true: 播放中, false: 暂停
    "timestamp": 1234567890123
  }
}
```

### 歌曲信息更新

当切换歌曲或歌曲信息加载完成时触发：

```json
{
  "type": "song-change",
  "data": {
    "title": "歌曲名 - 歌手",
    "name": "歌曲名",
    "artist": "歌手",
    "album": "专辑名",
    "duration": 240000, // 总时长(ms)
    "timestamp": 1234567890123
  }
}
```

### 播放进度更新

播放过程中实时触发（约 500ms 一次）：

```json
{
  "type": "progress-change",
  "data": {
    "currentTime": 12000, // 当前播放时间(ms)
    "duration": 240000, // 总时长(ms)
    "timestamp": 1234567890123
  }
}
```

### 歌词更新

当歌词数据加载或改变时触发：

```json
{
  "type": "lyric-change",
  "data": {
    "lrcData": [], // 普通歌词数据
    "yrcData": [], // 逐字歌词数据
    "timestamp": 1234567890123
  }
}
```

## 心跳检测

客户端可以发送 `PING` 消息进行心跳检测，服务器会自动回复 `PONG`：

```javascript
// 发送心跳
ws.send("PING");

// 服务器自动回复 PONG
```

## 错误处理

当发生错误时，服务器会发送错误消息：

```json
{
  "type": "error",
  "data": {
    "message": "错误描述信息"
  }
}
```

常见错误：

- `应用程序未找到或已销毁` - 应用程序主窗口未初始化
- `缺少 command 参数` - 控制命令缺少必需参数
- `未知的控制命令` - 不支持的控制命令
- `消息格式错误` - 消息不是有效的 JSON 格式
