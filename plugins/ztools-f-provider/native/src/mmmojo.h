// Dynamic loader for WeChat's mmmojo(mmmojo_64).dll.
//
// Mirrors WeChatOcr/MmmojoDll.cs: every exported function we need is resolved
// at runtime via LoadLibrary/GetProcAddress so the .node has no link-time
// dependency on the DLL (which is proprietary and lives in wco_data/).
#pragma once

#include <cstdint>
#include <string>
#include <windows.h>

namespace wechat_ocr {

// Callback signatures — copied verbatim from DefaultCallbacks.cs so the function
// pointers handed back to mmmojo match its calling convention.
typedef void(__cdecl* MMReadPushDelegate)(uint32_t requestId, void* requestInfo, void* userData);
typedef void(__cdecl* MMReadPullDelegate)(uint32_t requestId, void* requestInfo, void* userData);
typedef void(__cdecl* MMReadSharedDelegate)(uint32_t requestId, void* requestInfo, void* userData);
typedef void(__cdecl* MMRemoteConnectDelegate)(bool isConnected, void* userData);
typedef void(__cdecl* MMRemoteDisconnectDelegate)(void* userData);
typedef void(__cdecl* MMRemoteProcessLaunchedDelegate)(void* userData);
typedef void(__cdecl* MMRemoteProcessLaunchFailedDelegate)(int errorCode, void* userData);
typedef void(__cdecl* MMRemoteMojoErrorDelegate)(void* errorBuf, int errorSize, void* userData);

enum class MMMojoCallbackType {
  kMMUserData = 0,
  kMMReadPush,
  kMMReadPull,
  kMMReadShared,
  kMMRemoteConnect,
  kMMRemoteDisconnect,
  kMMRemoteProcessLaunched,
  kMMRemoteProcessLaunchFailed,
  kMMRemoteMojoError
};

enum class MMMojoEnvironmentInitParamType {
  kMMHostProcess = 0,
  kMMLoopStartThread,
  kMMExePath,
  kMMLogPath,
  kMMLogToStderr,
  kMMAddNumMessagepipe,
  kMMSetDisconnectHandlers,
  kMMDisableDefaultPolicy = 1000,
  kMMElevated,
  kMMCompatible
};

enum class MMMojoInfoMethod {
  kMMNone = 0,
  kMMPush,
  kMMPullReq,
  kMMPullResp,
  kMMShared
};

// Lazily loads the DLL on first use and resolves all symbols. Returns true if
// every required symbol was found (cached after the first success).
bool MmmojoLoad(const std::wstring& dllPath);

// Human-readable reason for the most recent MmmojoLoad failure (empty on success).
const std::string& MmmojoLoadError();

// Resolved function pointers (only valid after MmmojoLoad() == true).
struct MmmojoApi {
  void(__cdecl* InitializeMMMojo)(int argc, char** argv);
  void(__cdecl* ShutdownMMMojo)();
  void*(__cdecl* CreateMMMojoEnvironment)();
  void(__cdecl* SetMMMojoEnvironmentCallbacks)(void* env, int type, void* callback);
  void(__cdecl* SetMMMojoEnvironmentInitParams)(void* env, int type, void* param);
  void(__cdecl* AppendMMSubProcessSwitchNative)(void* env, const char* switchStr, const wchar_t* value);
  void(__cdecl* StartMMMojoEnvironment)(void* env);
  void(__cdecl* StopMMMojoEnvironment)(void* env);
  void(__cdecl* RemoveMMMojoEnvironment)(void* env);
  void*(__cdecl* GetMMMojoReadInfoRequest)(void* readInfo, uint32_t* requestDataSize);
  int(__cdecl* GetMMMojoReadInfoMethod)(void* readInfo);
  void(__cdecl* RemoveMMMojoReadInfo)(void* readInfo);
  void*(__cdecl* CreateMMMojoWriteInfo)(int method, int sync, uint32_t requestId);
  void*(__cdecl* GetMMMojoWriteInfoRequest)(void* writeInfo, uint32_t requestDataSize);
  void(__cdecl* RemoveMMMojoWriteInfo)(void* writeInfo);
  bool(__cdecl* SendMMMojoWriteInfo)(void* env, void* writeInfo);
};

const MmmojoApi& Mmmojo();

}  // namespace wechat_ocr
