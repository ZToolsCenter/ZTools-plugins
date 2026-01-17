# Native Addon API 设计文档

## 概述

本文档定义了录屏助手系统级事件监听 Native Addon 的接口规范。该 Addon 用于捕获全局鼠标和键盘事件，支持跨平台（Windows、macOS）。

## 核心 API

### hookEvent()

系统级事件钩子方法，用于监听全局鼠标和/或键盘事件。

#### 函数签名

```cpp
void HookEvent(const CallbackInfo& info) {
  int effect = info[0].As<Number>().Int32Value();
  Function callback = info[1].As<Function>();
  // 实现...
}
```

```typescript
// JavaScript 调用
addon.hookEvent(
  effect: 1 | 2 | 3,
  callback: (...eventData: any[]) => void
): void
```

#### 参数说明

**effect** (number)
- 类型：整数枚举
- 取值：
  - `1`: 仅监听鼠标事件
  - `2`: 仅键盘事件
  - `3`: 同时监听鼠标和键盘事件

**建议使用位运算处理：**
```cpp
if (effect & 0x01) RegisterMouseHook();   // 1 或 3
if (effect & 0x02) RegisterKeyboardHook(); // 2 或 3
```

**callback** (function)
- 类型：JavaScript 回调函数
- 说明：事件触发时调用，参数根据事件类型动态传递

## 回调参数规范

### 鼠标事件回调

根据 effect 值，当鼠标事件发生时触发回调。

#### Windows 平台

**事件代码：**

| 事件代码 | 常量 | 说明 |
|---------|------|------|
| 0x0201 | WM_LBUTTONDOWN | 鼠标左键按下 |
| 0x0202 | WM_LBUTTONUP | 鼠标左键抬起 |
| 0x0204 | WM_RBUTTONDOWN | 鼠标右键按下 |
| 0x0205 | WM_RBUTTONUP | 鼠标右键抬起 |

**回调参数：**
```cpp
// C++ 调用示例
callback.Call({
  Number::New(env, eventCode),
  Number::New(env, x),  // 可选
  Number::New(env, y)   // 可选
});
```

```typescript
// JavaScript 接收
callback(eventCode: number, x?: number, y?: number)
```

**注意：** x, y 坐标可选，如不提供则由前端自行获取。

#### macOS 平台

**事件代码：**

| 事件代码 | 说明 |
|---------|------|
| 1 | 鼠标左键按下 |
| 2 | 鼠标左键抬起 |
| 3 | 鼠标右键按下 |
| 4 | 鼠标右键抬起 |

**回调参数：**
```cpp
// C++ 调用示例
callback.Call({
  Number::New(env, eventCode),
  Number::New(env, x),  // 必需
  Number::New(env, y)   // 必需
});
```

```typescript
// JavaScript 接收
callback(eventCode: number, x: number, y: number)
```

**注意：** macOS 平台必须提供 x, y 坐标。

### 键盘事件回调

根据 effect 值，当键盘事件发生时触发回调。

**回调参数：**
```cpp
// C++ 调用示例
callback.Call({
  String::New(env, keyName),
  Boolean::New(env, shiftKey),
  Boolean::New(env, ctrlKey),
  Boolean::New(env, altKey),
  Boolean::New(env, metaKey),
  Boolean::New(env, flagsChange)
});
```

```typescript
// JavaScript 接收
callback(
  keyName: string,
  shiftKey: boolean,
  ctrlKey: boolean,
  altKey: boolean,
  metaKey: boolean,
  flagsChange: boolean
)
```

**参数说明：**

| 参数 | 类型 | 说明 |
|-----|------|------|
| keyName | string | 按键名称，如 'A', 'Enter', 'Shift' 等 |
| shiftKey | boolean | Shift 键是否按下 |
| ctrlKey | boolean | Ctrl/Control 键是否按下 |
| altKey | boolean | Alt/Option 键是否按下 |
| metaKey | boolean | Command/Win 键是否按下 |
| flagsChange | boolean | 修饰键状态改变标识（macOS 特有） |

**按键名称规范：**

| 平台 | 控制键名称 |
|------|----------|
| Windows | `Ctrl`, `Alt`, `Shift` |
| macOS | `Control`, `Option`, `Command`, `Shift` |

支持左右区分：`Right Shift`, `Right Ctrl`, `Right Control` 等

## 实现要求

### 平台实现

#### Windows

**API：** Win32 Hook API
```cpp
#include <windows.h>

HHOOK mouseHook = NULL;
HHOOK keyboardHook = NULL;

// 鼠标钩子回调
LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0) {
    MSLLHOOKSTRUCT* info = (MSLLHOOKSTRUCT*)lParam;
    // 触发 JavaScript 回调
    // callback(wParam, info->pt.x, info->pt.y);
  }
  return CallNextHookEx(mouseHook, nCode, wParam, lParam);
}

// 键盘钩子回调
LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0 && wParam == WM_KEYDOWN) {
    KBDLLHOOKSTRUCT* info = (KBDLLHOOKSTRUCT*)lParam;
    // 获取按键名称和修饰键状态
    // 触发 JavaScript 回调
  }
  return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
}

void RegisterMouseHook() {
  mouseHook = SetWindowsHookEx(WH_MOUSE_LL, MouseProc, NULL, 0);
}

void RegisterKeyboardHook() {
  keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, NULL, 0);
}
```

#### macOS

**API：** CGEvent 或 NSEvent
```objc
#import <ApplicationServices/ApplicationServices.h>

CGEventRef mouseCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
  int eventCode = 0;
  switch(type) {
    case kCGEventLeftMouseDown: eventCode = 1; break;
    case kCGEventLeftMouseUp: eventCode = 2; break;
    case kCGEventRightMouseDown: eventCode = 3; break;
    case kCGEventRightMouseUp: eventCode = 4; break;
  }

  CGPoint location = CGEventGetLocation(event);
  // 触发 JavaScript 回调
  // callback(eventCode, location.x, location.y);

  return event;
}

CGEventRef keyboardCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
  if (type == kCGEventKeyDown || type == kCGEventFlagsChanged) {
    CGKeyCode keyCode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    CGEventFlags flags = CGEventGetFlags(event);

    // 解析按键名称和修饰键状态
    // 触发 JavaScript 回调
  }

  return event;
}

void RegisterMouseHook() {
  CGEventMask mask = CGEventMaskBit(kCGEventLeftMouseDown) |
                     CGEventMaskBit(kCGEventLeftMouseUp) |
                     CGEventMaskBit(kCGEventRightMouseDown) |
                     CGEventMaskBit(kCGEventRightMouseUp);

  CFMachPortRef tap = CGEventTapCreate(
    kCGSessionEventTap,
    kCGHeadInsertEventTap,
    kCGEventTapOptionDefault,
    mask,
    mouseCallback,
    NULL
  );
  // 添加到 run loop...
}
```

### 线程安全

**要求：**
1. 回调必须在主线程执行
2. 使用 `ThreadSafeFunction` (Node-API) 跨线程调用
3. 避免阻塞 UI 渲染

**示例：**
```cpp
Napi::ThreadSafeFunction tsfn;

// 在 HookEvent 中创建
tsfn = Napi::ThreadSafeFunction::New(
  env,
  callback,
  "HookEventCallback",
  0,
  1
);

// 在系统钩子回调中调用
tsfn.BlockingCall([eventData](Napi::Env env, Napi::Function jsCallback) {
  jsCallback.Call({ /* 参数 */ });
});
```

### 资源管理

**生命周期：**
1. `hookEvent` 调用时注册系统钩子
2. 模块卸载时自动清理钩子
3. 避免内存泄漏

**建议实现：**
```cpp
class HookManager {
public:
  ~HookManager() {
    UnhookAll();
  }

  void UnhookAll() {
    if (mouseHook) {
      // Windows: UnhookWindowsHookEx(mouseHook);
      // macOS: CFRelease(eventTap);
    }
    if (keyboardHook) {
      // 清理键盘钩子
    }
  }
};
```

## 性能优化

### 事件过滤

1. 根据 effect 参数仅注册需要的钩子类型
2. 避免捕获不必要的事件
3. 在 C++ 层面过滤无效事件

### 回调优化

1. 减少 JavaScript 回调频率
2. 批量处理事件（如果需要）
3. 异步调用避免阻塞系统钩子

## 安全性

### 权限要求

**Windows:**
- 低级钩子（`WH_MOUSE_LL`, `WH_KEYBOARD_LL`）可能需要管理员权限
- 建议在应用启动时检查权限

**macOS:**
- 必须在系统偏好设置中授予辅助功能权限
- 使用 `AXIsProcessTrusted()` 检查权限

### 权限检查示例

```cpp
// macOS
bool CheckAccessibility() {
  return AXIsProcessTrusted();
}

// Windows (检查是否以管理员运行)
bool IsElevated() {
  BOOL isElevated = FALSE;
  HANDLE token = NULL;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    TOKEN_ELEVATION elevation;
    DWORD size;
    if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size)) {
      isElevated = elevation.TokenIsElevated;
    }
    CloseHandle(token);
  }
  return isElevated;
}
```

## 技术栈

### 推荐方案

**Node.js 绑定：**
- Node-API (N-API) - 推荐，ABI 稳定
- NAN (Native Abstractions for Node.js) - 兼容旧版本

**平台 API：**
- Windows: Win32 API (`windows.h`)
- macOS: Core Graphics (`ApplicationServices/ApplicationServices.h`)

**构建工具：**
- node-gyp
- cmake-js

### binding.gyp 示例

```python
{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "src/addon.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "user32.lib" ]
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_LDFLAGS": [
              "-framework ApplicationServices"
            ]
          }
        }]
      ]
    }
  ]
}
```

## 版本兼容性

- **Node.js**: >= 12.0.0
- **Electron**: >= 10.0.0
- **平台**: Windows 10+, macOS 10.13+

## 故障排查

### 常见问题

**1. 钩子注册失败**
- Windows: 检查管理员权限
- macOS: 检查辅助功能权限 (`AXIsProcessTrusted()`)
- 检查 effect 参数值是否有效 (1, 2, 或 3)

**2. 回调未触发**
- 验证 ThreadSafeFunction 是否正确创建
- 检查系统钩子是否成功注册
- macOS: 确认 Event Tap 已添加到 run loop

**3. 内存泄漏**
- 确保在模块卸载时调用 `UnhookAll()`
- ThreadSafeFunction 使用后正确释放
- 检查回调函数的引用计数

**4. 坐标不准确**
- macOS: 注意 Retina 屏幕坐标需要缩放
- 多显示器场景：确保坐标为屏幕绝对坐标

---

**文档版本：** 1.0.1
**更新日期：** 2025-12-13
**适用平台：** Windows, macOS
