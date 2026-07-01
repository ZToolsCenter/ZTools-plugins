// OcrManager — the heart of the bridge. Ported from WeChatOcr's
// OcrManager.cs + XPluginManager.cs + DefaultCallbacks.cs.
//
// Responsibilities:
//   * Boot a mmmojo environment that launches WeChatOCR.exe as a child process.
//   * Wait for the child to connect, then push protobuf-encoded OCR tasks.
//   * On the kMMReadPush callback (which fires on mmmojo's own thread), parse
//     the response and hand the result back to the caller via the callback.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

#include "mmmojo.h"
#include "pb.h"

namespace wechat_ocr {

// Outcome of a single OCR task. `errorMessage` is set when ok == false.
struct OcrOutcome {
  bool ok = false;
  int taskId = -1;
  OcrResult result;
  std::string errorMessage;
};

using ResultCallback = std::function<void(const OcrOutcome&)>;

class OcrManager {
 public:
  static constexpr int kOcrMaxTaskId = 32;

  // `dataDir` is the wco_data/ directory (contains WeChatOCR.exe + Model).
  // `dllPath` is the full path to mmmojo_64.dll (or mmmojo.dll).
  OcrManager(const std::wstring& dataDir, const std::wstring& dllPath);
  ~OcrManager();

  OcrManager(const OcrManager&) = delete;
  OcrManager& operator=(const OcrManager&) = delete;

  // Boot the environment. Returns false (with a message in *err) on failure.
  bool Start(std::string* err);

  // Submit `imagePath` for recognition; `cb` is invoked (on mmmojo's thread)
  // with the outcome. Returns the assigned task id, or -1 if the queue is full
  // / not connected.
  int Submit(const std::wstring& imagePath, ResultCallback cb);

  void Shutdown();

 private:
  // mmmojo callbacks (static, trampoline into the instance via user-data).
  static void __cdecl OnRemoteConnect(bool isConnected, void* userData);
  static void __cdecl OnRemoteDisconnect(void* userData);
  static void __cdecl OnReadPush(uint32_t requestId, void* requestInfo, void* userData);

  int GetIdleTaskId();
  void SetTaskIdle(int taskId);

  // ---- resolved at construction ----
  std::wstring dataDir_;
  std::wstring dllPath_;
  std::wstring exePath_;  // <dataDir>/WeChatOCR.exe

  // ---- runtime state ----
  void* env_ = nullptr;
  std::atomic<bool> running_{false};
  std::atomic<bool> connected_{false};
  std::mutex mutex_;

  // idle task ids (0..31) waiting to be assigned.
  std::queue<int> idleIds_;
  // pending tasks: taskId -> {imagePath, callback}. Only one in flight at a
  // time per id, but we keep the map to route the async response back.
  struct Pending {
    std::wstring imagePath;
    ResultCallback callback;
  };
  std::map<int, Pending> pending_;

  // Keep function pointers alive (mmojo callbacks store raw pointers).
  MMRemoteConnectDelegate connectCb_;
  MMRemoteDisconnectDelegate disconnectCb_;
  MMReadPushDelegate readPushCb_;
};

}  // namespace wechat_ocr
