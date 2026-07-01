#include "ocr_manager.h"

#include <chrono>
#include <cstring>
#include <thread>

#include "mmmojo.h"

namespace wechat_ocr {

OcrManager::OcrManager(const std::wstring& dataDir, const std::wstring& dllPath)
    : dataDir_(dataDir), dllPath_(dllPath) {
  // WeChatOCR.exe lives directly under wco_data/.
  exePath_ = dataDir_ + L"\\WeChatOCR.exe";
  for (int i = 0; i < kOcrMaxTaskId; ++i) idleIds_.push(i);
}

OcrManager::~OcrManager() { Shutdown(); }

bool OcrManager::Start(std::string* err) {
  if (running_.load()) return true;

  if (!MmmojoLoad(dllPath_)) {
    if (err) *err = "failed to load mmmojo dll: " + MmmojoLoadError();
    return false;
  }

  const auto& api = Mmmojo();

  // Stash self-pointer as mmmojo user-data so static callbacks reach us.
  // Equivalent to C# SetCallbackUsrData(GCHandle.ToIntPtr(...)).
  void* userData = this;

  api.InitializeMMMojo(0, nullptr);
  env_ = api.CreateMMMojoEnvironment();
  if (!env_) {
    if (err) *err = "CreateMMMojoEnvironment failed";
    return false;
  }

  // Register callbacks. Keep the delegates alive as members — mmmojo holds the
  // raw pointers for the lifetime of the environment.
  api.SetMMMojoEnvironmentCallbacks(env_, static_cast<int>(MMMojoCallbackType::kMMUserData), userData);

  connectCb_ = &OcrManager::OnRemoteConnect;
  disconnectCb_ = &OcrManager::OnRemoteDisconnect;
  readPushCb_ = &OcrManager::OnReadPush;

  api.SetMMMojoEnvironmentCallbacks(env_, static_cast<int>(MMMojoCallbackType::kMMRemoteConnect),
                                    reinterpret_cast<void*>(connectCb_));
  api.SetMMMojoEnvironmentCallbacks(env_, static_cast<int>(MMMojoCallbackType::kMMRemoteDisconnect),
                                    reinterpret_cast<void*>(disconnectCb_));
  api.SetMMMojoEnvironmentCallbacks(env_, static_cast<int>(MMMojoCallbackType::kMMReadPush),
                                    reinterpret_cast<void*>(readPushCb_));

  // Host process + exe path (mirrors XPluginManager.InitMmMojoEnv).
  api.SetMMMojoEnvironmentInitParams(env_, static_cast<int>(MMMojoEnvironmentInitParamType::kMMHostProcess),
                                     reinterpret_cast<void*>(static_cast<intptr_t>(1)));
  api.SetMMMojoEnvironmentInitParams(env_, static_cast<int>(MMMojoEnvironmentInitParamType::kMMExePath),
                                     const_cast<wchar_t*>(exePath_.c_str()));

  // --user-lib-dir=<dataDir> : tells the OCR exe where to find Model/.
  std::string key = "user-lib-dir";
  // value is a wide string; mmmojo expects the wide bytes.
  api.AppendMMSubProcessSwitchNative(env_, key.c_str(), dataDir_.c_str());

  api.StartMMMojoEnvironment(env_);
  running_.store(true);

  // Wait for the child to connect (DoOcrTask polls the same flag in C#).
  for (int i = 0; i < 50 && !connected_.load(); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  if (!connected_.load()) {
    if (err) *err = "WeChatOCR.exe did not connect in time";
    Shutdown();
    return false;
  }
  return true;
}

int OcrManager::GetIdleTaskId() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (idleIds_.empty()) return -1;
  int id = idleIds_.front();
  idleIds_.pop();
  return id;
}

void OcrManager::SetTaskIdle(int taskId) {
  std::lock_guard<std::mutex> lock(mutex_);
  idleIds_.push(taskId);
  pending_.erase(taskId);
}

int OcrManager::Submit(const std::wstring& imagePath, ResultCallback cb) {
  if (!running_.load() || !connected_.load()) return -1;

  // WeChatOCR expects an ANSI path on the protobuf wire (pic_path is `string`).
  // Convert the wide path to UTF-8 to be safe with non-ASCII characters.
  std::string picPath;
  int len = WideCharToMultiByte(CP_UTF8, 0, imagePath.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (len > 0) {
    picPath.resize(len - 1);
    WideCharToMultiByte(CP_UTF8, 0, imagePath.c_str(), -1, &picPath[0], len, nullptr, nullptr);
  }

  int taskId = GetIdleTaskId();
  if (taskId < 0) return -1;

  {
    std::lock_guard<std::mutex> lock(mutex_);
    pending_[taskId] = {imagePath, std::move(cb)};
  }

  std::string payload = EncodeOcrRequest(taskId, picPath);
  const auto& api = Mmmojo();
  void* writeInfo = api.CreateMMMojoWriteInfo(static_cast<int>(MMMojoInfoMethod::kMMPush), 0, 1);
  void* req = api.GetMMMojoWriteInfoRequest(writeInfo, static_cast<uint32_t>(payload.size()));
  std::memcpy(req, payload.data(), payload.size());
  bool sent = api.SendMMMojoWriteInfo(env_, writeInfo);
  // NOTE: do NOT call RemoveMMMojoWriteInfo here — removing the write-info
  // before mmojo has dispatched the request causes the OCR task to be dropped
  // (the C# reference SendPbSerializedData omits this call too).
  (void)sent;
  return taskId;
}

void OcrManager::Shutdown() {
  if (!running_.exchange(false)) return;
  const auto& api = Mmmojo();
  if (env_) {
    api.StopMMMojoEnvironment(env_);
    api.RemoveMMMojoEnvironment(env_);
    env_ = nullptr;
  }
  connected_.store(false);
  std::lock_guard<std::mutex> lock(mutex_);
  // Fail any still-pending tasks.
  for (auto& kv : pending_) {
    OcrOutcome outcome;
    outcome.ok = false;
    outcome.taskId = kv.first;
    outcome.errorMessage = "OCR engine shut down";
    if (kv.second.callback) kv.second.callback(outcome);
  }
  pending_.clear();
}

// ---- mmmojo callbacks (fire on mmojo's worker thread) ----

void __cdecl OcrManager::OnRemoteConnect(bool isConnected, void* userData) {
  auto* self = static_cast<OcrManager*>(userData);
  if (self) self->connected_.store(isConnected);
}

void __cdecl OcrManager::OnRemoteDisconnect(void* userData) {
  auto* self = static_cast<OcrManager*>(userData);
  if (self) self->connected_.store(false);
}

void __cdecl OcrManager::OnReadPush(uint32_t requestId, void* requestInfo, void* userData) {
  auto* self = static_cast<OcrManager*>(userData);
  if (!self || !requestInfo) return;

  const auto& api = Mmmojo();
  uint32_t pbSize = 0;
  void* pbData = api.GetMMMojoReadInfoRequest(requestInfo, &pbSize);
  if (pbSize <= 20 || !pbData) {
    api.RemoveMMMojoReadInfo(requestInfo);
    return;
  }

  OcrResult parsed;
  bool parsedOk = DecodeOcrResponse(static_cast<const uint8_t*>(pbData), pbSize, parsed);
  api.RemoveMMMojoReadInfo(requestInfo);
  if (!parsedOk) return;

  // Route the result to the submitter by task id.
  ResultCallback cb;
  {
    std::lock_guard<std::mutex> lock(self->mutex_);
    auto it = self->pending_.find(parsed.taskId);
    if (it == self->pending_.end()) return;
    cb = std::move(it->second.callback);
    self->pending_.erase(it);
    self->idleIds_.push(parsed.taskId);
  }

  OcrOutcome outcome;
  outcome.ok = true;
  outcome.taskId = parsed.taskId;
  outcome.result = std::move(parsed);
  if (cb) cb(outcome);
}

}  // namespace wechat_ocr
