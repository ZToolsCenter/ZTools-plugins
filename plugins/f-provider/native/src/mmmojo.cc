#include "mmmojo.h"

#include <string>

namespace wechat_ocr {

namespace {

MmmojoApi g_api{};
HMODULE g_module = nullptr;
std::string g_loadError;

template <typename T>
T Resolve(const char* name) {
  return reinterpret_cast<T>(GetProcAddress(g_module, name));
}

}  // namespace

bool MmmojoLoad(const std::wstring& dllPath) {
  if (g_module) return true;

  // mmmojo_64.dll has sibling dependencies (it pulls in DLLs that live next to
  // WeChatOCR.exe). The original C# loader calls SetDllDirectory(dir) first;
  // we mirror that so those imports resolve from wco_data/.
  std::wstring dir = dllPath.substr(0, dllPath.find_last_of(L"\\/"));
  ::SetDllDirectoryW(dir.c_str());

  // LOAD_WITH_ALTERED_SEARCH_PATH makes the loader also search the DLL's own
  // directory for its dependencies — mmojo needs this because it dlopens sibling
  // modules at runtime.
  g_module = LoadLibraryExW(dllPath.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!g_module) {
    DWORD gle = GetLastError();
    g_loadError = "LoadLibrary failed for mmmojo (err=" + std::to_string(gle) +
                  ", path=" + std::string(dir.begin(), dir.end()) + ")";
    return false;
  }

#define RESOLVE(field, type, name) g_api.field = Resolve<type>(name)
  RESOLVE(InitializeMMMojo, void(__cdecl*)(int, char**), "InitializeMMMojo");
  RESOLVE(ShutdownMMMojo, void(__cdecl*)(), "ShutdownMMMojo");
  RESOLVE(CreateMMMojoEnvironment, void*(__cdecl*)(), "CreateMMMojoEnvironment");
  RESOLVE(SetMMMojoEnvironmentCallbacks, void(__cdecl*)(void*, int, void*), "SetMMMojoEnvironmentCallbacks");
  RESOLVE(SetMMMojoEnvironmentInitParams, void(__cdecl*)(void*, int, void*), "SetMMMojoEnvironmentInitParams");
  RESOLVE(AppendMMSubProcessSwitchNative, void(__cdecl*)(void*, const char*, const wchar_t*), "AppendMMSubProcessSwitchNative");
  RESOLVE(StartMMMojoEnvironment, void(__cdecl*)(void*), "StartMMMojoEnvironment");
  RESOLVE(StopMMMojoEnvironment, void(__cdecl*)(void*), "StopMMMojoEnvironment");
  RESOLVE(RemoveMMMojoEnvironment, void(__cdecl*)(void*), "RemoveMMMojoEnvironment");
  RESOLVE(GetMMMojoReadInfoRequest, void*(__cdecl*)(void*, uint32_t*), "GetMMMojoReadInfoRequest");
  RESOLVE(GetMMMojoReadInfoMethod, int(__cdecl*)(void*), "GetMMMojoReadInfoMethod");
  RESOLVE(RemoveMMMojoReadInfo, void(__cdecl*)(void*), "RemoveMMMojoReadInfo");
  RESOLVE(CreateMMMojoWriteInfo, void*(__cdecl*)(int, int, uint32_t), "CreateMMMojoWriteInfo");
  RESOLVE(GetMMMojoWriteInfoRequest, void*(__cdecl*)(void*, uint32_t), "GetMMMojoWriteInfoRequest");
  RESOLVE(RemoveMMMojoWriteInfo, void(__cdecl*)(void*), "RemoveMMMojoWriteInfo");
  RESOLVE(SendMMMojoWriteInfo, bool(__cdecl*)(void*, void*), "SendMMMojoWriteInfo");
#undef RESOLVE

  // Sanity check the critical symbols.
  if (!g_api.CreateMMMojoEnvironment || !g_api.StartMMMojoEnvironment || !g_api.SendMMMojoWriteInfo) {
    g_loadError = "mmmojo.dll missing required exports";
    FreeLibrary(g_module);
    g_module = nullptr;
    return false;
  }
  return true;
}

const MmmojoApi& Mmmojo() { return g_api; }

const std::string& MmmojoLoadError() { return g_loadError; }

}  // namespace wechat_ocr
