# API 接口文档

## 概述

本软件提供了本地 HTTP API 服务，用于控制播放器和访问音乐服务。默认端口为 `25884`

## 基础信息

- **基础 URL**: `http://localhost:25884`
- **API 前缀**: `/api`
- **响应格式**: JSON

## 统一响应格式

所有接口都遵循以下响应格式：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {}
}
```

### 状态码说明

- `200`: 成功
- `500`: 服务器错误

---

## 播放控制接口 (Control API)

**基础路径**: `/api/control`

### 播放

**接口**: `GET /api/control/play`

**描述**: 发送播放命令

**响应示例**:

```json
{
  "code": 200,
  "message": "播放命令已发送",
  "data": null
}
```

---

### 暂停

**接口**: `GET /api/control/pause`

**描述**: 发送暂停命令

**响应示例**:

```json
{
  "code": 200,
  "message": "暂停命令已发送",
  "data": null
}
```

---

### 播放/暂停切换

**接口**: `GET /api/control/toggle`

**描述**: 切换播放/暂停状态

**响应示例**:

```json
{
  "code": 200,
  "message": "播放/暂停切换命令已发送",
  "data": null
}
```

---

### 下一曲

**接口**: `GET /api/control/next`

**描述**: 播放下一首歌曲

**响应示例**:

```json
{
  "code": 200,
  "message": "下一曲命令已发送",
  "data": null
}
```

---

### 上一曲

**接口**: `GET /api/control/prev`

**描述**: 播放上一首歌曲

**响应示例**:

```json
{
  "code": 200,
  "message": "上一曲命令已发送",
  "data": null
}
```

---

### 获取状态

**接口**: `GET /api/control/status`

**描述**: 获取软件版本、环境数据和连接状态

**响应示例**:

```json
{
  "code": 200,
  "message": "获取状态成功",
  "data": {
    "version": {
      "app": "3.0.0-beta.6",
      "name": "SPlayer"
    },
    "environment": {
      "platform": "win32",
      "arch": "x64",
      "nodeVersion": "20.x.x",
      "electronVersion": "x.x.x",
      "chromeVersion": "x.x.x",
      "v8Version": "x.x.x"
    },
    "connected": true,
    "window": "available"
  }
}
```

**响应字段说明**:

- `version.app`: 软件版本号
- `version.name`: 软件名称
- `environment.platform`: 操作系统平台 (win32/darwin/linux)
- `environment.arch`: 系统架构 (x64/arm64)
- `environment.nodeVersion`: Node.js 版本
- `environment.electronVersion`: Electron 版本
- `environment.chromeVersion`: Chrome 版本
- `environment.v8Version`: V8 引擎版本
- `connected`: 是否已连接
- `window`: 窗口状态

---

### 获取当前播放信息

**接口**: `GET /api/control/song-info`

**描述**: 获取当前播放的歌曲信息

> [!WARNING]
> 请勿频繁调用此接口（如每秒调用一次）来获取播放进度，这会导致软件性能异常。
> 如需实时获取播放进度和状态，请使用 WebSocket 连接并监听相关事件。

**响应示例**:

```json
{
  "code": 200,
  "message": "获取当前播放信息成功",
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

---

## 云音乐 API (Netease API)

**基础路径**: `/api/netease`

### 使用说明

云音乐 API 支持所有 NeteaseCloudMusicApi Enhanced 的接口。接口路径会自动转换为 kebab-case 格式。

**示例**:

- `GET /api/netease/login/cellphone?phone=xxx&password=xxx`
- `GET /api/netease/user/playlist?uid=xxx`
- `GET /api/netease/song/detail?ids=xxx`

更多接口请参考 [NeteaseCloudMusicApi Enhanced 文档](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)

---

## 解锁 API (Unblock API)

**基础路径**: `/api/unblock`

### 云音乐解锁

**接口**: `GET /api/unblock/netease?id={songId}`

**描述**: 获取网易云音乐解锁后的播放链接

**请求参数**:

- `id` (必需): 歌曲 ID

**响应示例**:

```json
{
  "code": 200,
  "url": "https://..."
}
```

---

### 酷我解锁

**接口**: `GET /api/unblock/kuwo?keyword={keyword}`

**描述**: 获取酷我音乐解锁后的播放链接

**请求参数**:

- `keyword` (必需): 搜索关键词（歌曲名或歌手名）

**响应示例**:

```json
{
  "code": 200,
  "url": "https://..."
}
```

---

### 波点解锁

**接口**: `GET /api/unblock/bodian?keyword={keyword}`

**描述**: 获取波点音乐解锁后的播放链接

**请求参数**:

- `keyword` (必需): 搜索关键词（歌曲名或歌手名）

**响应示例**:

```json
{
  "code": 200,
  "url": "https://..."
}
```

---

### 歌曲宝解锁

**接口**: `GET /api/unblock/gequbao?keyword={keyword}`

**描述**: 获取歌曲宝解锁后的播放链接

**请求参数**:

- `keyword` (必需): 搜索关键词（歌曲名或歌手名）

**响应示例**:

```json
{
  "code": 200,
  "url": "https://..."
}
```

---

## 全部 API 列表

**接口**: `GET /api`

**描述**: 获取所有 API 模块列表

**响应示例**:

```json
{
  "name": "SPlayer API",
  "description": "SPlayer API service",
  "author": "@imsyy",
  "list": [
    {
      "name": "NeteaseCloudMusicApi",
      "url": "/api/netease"
    },
    {
      "name": "UnblockAPI",
      "url": "/api/unblock"
    }
  ]
}
```

---

## 错误处理

当接口发生错误时，会返回以下格式：

```json
{
  "code": 500,
  "message": "错误描述",
  "data": null
}
```

常见错误：

- `主窗口未找到`: 应用程序主窗口未初始化
- `播放失败`: 播放操作执行失败
- `获取状态失败`: 状态获取失败

---

### 使用示例

#### cURL 示例

```bash
# 播放
curl http://localhost:25884/api/control/play

# 暂停
curl http://localhost:25884/api/control/pause

# 下一曲
curl http://localhost:25884/api/control/next

# 获取状态
curl http://localhost:25884/api/control/status
```

#### JavaScript 示例

```javascript
// 播放
fetch("http://localhost:25884/api/control/play")
  .then((res) => res.json())
  .then((data) => console.log(data));

// 获取状态
fetch("http://localhost:25884/api/control/status")
  .then((res) => res.json())
  .then((data) => console.log(data));
```

#### Python 示例

```python
import requests

# 播放
response = requests.get('http://localhost:25884/api/control/play')
print(response.json())

# 获取状态
response = requests.get('http://localhost:25884/api/control/status')
print(response.json())
```

---

## 注意事项

1. 所有接口仅在应用程序运行时可用
2. HTTP API 默认端口为 `25884`，可在环境变量 `VITE_SERVER_PORT` 中配置
3. WebSocket API 默认端口为 `25885`，可在应用程序设置中修改
4. 解锁接口仅供学习使用，请勿用于商业用途
5. 网易云音乐 API 需要登录后才能使用部分功能
6. 接口响应时间取决于网络状况和服务器负载
7. WebSocket 连接支持心跳检测（PING/PONG），建议客户端定期发送心跳以保持连接

---
