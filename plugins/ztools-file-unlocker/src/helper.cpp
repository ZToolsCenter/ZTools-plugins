#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <winternl.h>
#include <restartmanager.h>
#include <psapi.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shldisp.h>
#include <exdisp.h>
#include <vector>
#include <string>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <algorithm>

#pragma comment(lib, "rstrtmgr.lib")
#pragma comment(lib, "psapi.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

#ifndef STATUS_SUCCESS
#define STATUS_SUCCESS ((NTSTATUS)0x00000000L)
#endif
#ifndef STATUS_BUFFER_TOO_SMALL
#define STATUS_BUFFER_TOO_SMALL ((NTSTATUS)0xC0000023L)
#endif
#ifndef STATUS_INFO_LENGTH_MISMATCH
#define STATUS_INFO_LENGTH_MISMATCH ((NTSTATUS)0xC0000004L)
#endif

#define SystemExtendedHandleInformation 64
#define ObjectNameInformation 1

typedef struct _SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX {
    PVOID Object;
    ULONG_PTR UniqueProcessId;
    ULONG_PTR HandleValue;
    ULONG GrantedAccess;
    USHORT CreatorBackTraceIndex;
    USHORT ObjectTypeIndex;
    ULONG HandleAttributes;
    ULONG Reserved;
} SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX, *PSYSTEM_HANDLE_TABLE_ENTRY_INFO_EX;

typedef struct _SYSTEM_HANDLE_INFORMATION_EX {
    ULONG_PTR NumberOfHandles;
    ULONG_PTR Reserved;
    SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX Handles[1];
} SYSTEM_HANDLE_INFORMATION_EX, *PSYSTEM_HANDLE_INFORMATION_EX;

typedef NTSTATUS(NTAPI* pfnNtQuerySystemInformation)(
    ULONG SystemInformationClass,
    PVOID SystemInformation,
    ULONG SystemInformationLength,
    PULONG ReturnLength
);

typedef NTSTATUS(NTAPI* pfnNtQueryObject)(
    HANDLE Handle,
    ULONG ObjectInformationClass,
    PVOID ObjectInformation,
    ULONG ObjectInformationLength,
    PULONG ReturnLength
);

pfnNtQuerySystemInformation g_NtQuerySystemInformation = NULL;
pfnNtQueryObject g_NtQueryObject = NULL;

struct ProcessHolderInfo {
    DWORD pid = 0;
    std::wstring appName;
    std::wstring exePath;
    std::wstring matchedPath;
    std::wstring reason;
    std::vector<ULONG_PTR> handles;
};

struct TargetFileInfo {
    std::wstring originalPath;
    std::wstring normPath;
    std::wstring ntPath;
    bool isDir = false;
    std::map<DWORD, ProcessHolderInfo> holders;
};

// JSON 转义辅助函数
std::string EscapeJsonString(const std::wstring& ws) {
    int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, NULL, 0, NULL, NULL);
    if (len <= 0) return "";
    std::string s(len - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, &s[0], len, NULL, NULL);

    std::ostringstream o;
    for (char c : s) {
        if (c == '"') o << "\"";
        else if (c == '\\') o << "\\\\";
        else if (c == '\b') o << "\\b";
        else if (c == '\f') o << "\\f";
        else if (c == '\n') o << "\\n";
        else if (c == '\r') o << "\\r";
        else if (c == '\t') o << "\\t";
        else if ((unsigned char)c < 32) {
            char buf[8];
            snprintf(buf, sizeof(buf), "\\u%04x", (unsigned char)c);
            o << buf;
        } else {
            o << c;
        }
    }
    return o.str();
}

void EnableDebugPrivilege() {
    HANDLE hToken;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken)) {
        TOKEN_PRIVILEGES tp;
        tp.PrivilegeCount = 1;
        tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        if (LookupPrivilegeValueW(NULL, SE_DEBUG_NAME, &tp.Privileges[0].Luid)) {
            AdjustTokenPrivileges(hToken, FALSE, &tp, sizeof(tp), NULL, NULL);
        }
        CloseHandle(hToken);
    }
}

std::wstring NormalizePath(std::wstring p) {
    if (p.empty()) return p;
    for (size_t i = 0; i < p.length(); i++) {
        if (p[i] == L'/') p[i] = L'\\';
    }
    wchar_t fullPath[MAX_PATH * 2] = { 0 };
    if (GetFullPathNameW(p.c_str(), MAX_PATH * 2, fullPath, NULL)) {
        p = fullPath;
    }
    wchar_t longPath[MAX_PATH * 2] = { 0 };
    if (GetLongPathNameW(p.c_str(), longPath, MAX_PATH * 2)) {
        p = longPath;
    }
    while (p.length() > 3 && p.back() == L'\\') {
        p.pop_back();
    }
    return p;
}

std::map<std::wstring, std::wstring> GetDosDeviceMap() {
    std::map<std::wstring, std::wstring> devMap;
    wchar_t driveStrings[512] = { 0 };
    if (GetLogicalDriveStringsW(512, driveStrings)) {
        wchar_t* pDrive = driveStrings;
        while (*pDrive) {
            wchar_t driveLetter[3] = { pDrive[0], L':', L'\0' };
            wchar_t deviceName[MAX_PATH] = { 0 };
            if (QueryDosDeviceW(driveLetter, deviceName, MAX_PATH)) {
                devMap[driveLetter] = deviceName;
            }
            pDrive += wcslen(pDrive) + 1;
        }
    }
    return devMap;
}

std::wstring DosPathToNtPath(const std::wstring& dosPath, const std::map<std::wstring, std::wstring>& devMap) {
    if (dosPath.length() >= 2 && dosPath[1] == L':') {
        std::wstring drive = dosPath.substr(0, 2);
        wchar_t upperDrive[3] = { (wchar_t)towupper(drive[0]), L':', L'\0' };
        auto it = devMap.find(upperDrive);
        if (it != devMap.end()) {
            return it->second + dosPath.substr(2);
        }
    }
    return dosPath;
}

std::wstring NtPathToDosPath(const std::wstring& ntPath, const std::map<std::wstring, std::wstring>& devMap) {
    for (const auto& kv : devMap) {
        if (!kv.second.empty() && _wcsnicmp(ntPath.c_str(), kv.second.c_str(), kv.second.length()) == 0) {
            return kv.first + ntPath.substr(kv.second.length());
        }
    }
    return ntPath;
}

void GetProcessDetails(DWORD pid, std::wstring& exePath, std::wstring& appName) {
    if (!exePath.empty() && !appName.empty()) return;
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (hProcess) {
        wchar_t buf[MAX_PATH * 2] = { 0 };
        DWORD size = sizeof(buf) / sizeof(wchar_t);
        if (QueryFullProcessImageNameW(hProcess, 0, buf, &size)) {
            exePath = buf;
            const wchar_t* pName = PathFindFileNameW(buf);
            if (pName) appName = pName;
        }
        CloseHandle(hProcess);
    }
    if (appName.empty()) {
        appName = L"PID: " + std::to_wstring(pid);
    }
}

inline bool PathMatches(const std::wstring& candPath, const std::wstring& targetPath, bool targetIsDir) {
    if (candPath.length() < targetPath.length()) return false;
    if (_wcsnicmp(candPath.c_str(), targetPath.c_str(), targetPath.length()) == 0) {
        if (candPath.length() == targetPath.length()) return true;
        if (targetIsDir) {
            wchar_t nextChar = candPath[targetPath.length()];
            if (nextChar == L'\\' || nextChar == L'/') return true;
        }
    }
    return false;
}

// ----------------- 辅助函数：从 IDispatch 提取选中的文件 -----------------
void ExtractSelectedFromDispatch(IDispatch* pdisp, const std::wstring& normDesktop, std::vector<std::wstring>& result) {
    if (!pdisp) return;
    IWebBrowserApp* pwba = NULL;
    if (SUCCEEDED(pdisp->QueryInterface(IID_IWebBrowserApp, (void**)&pwba)) && pwba) {
        IServiceProvider* psp = NULL;
        if (SUCCEEDED(pwba->QueryInterface(IID_IServiceProvider, (void**)&psp)) && psp) {
            IShellBrowser* psb = NULL;
            if (SUCCEEDED(psp->QueryService(SID_STopLevelBrowser, IID_IShellBrowser, (void**)&psb)) && psb) {
                IShellView* psv = NULL;
                if (SUCCEEDED(psb->QueryActiveShellView(&psv)) && psv) {
                    IFolderView* pfv = NULL;
                    if (SUCCEEDED(psv->QueryInterface(IID_IFolderView, (void**)&pfv)) && pfv) {
                        IShellItemArray* psia = NULL;
                        if (SUCCEEDED(pfv->Items(SVGIO_SELECTION, IID_IShellItemArray, (void**)&psia)) && psia) {
                            DWORD itemCount = 0;
                            psia->GetCount(&itemCount);
                            for (DWORD j = 0; j < itemCount; j++) {
                                IShellItem* psi = NULL;
                                if (SUCCEEDED(psia->GetItemAt(j, &psi)) && psi) {
                                    PWSTR pszPath = NULL;
                                    if (SUCCEEDED(psi->GetDisplayName(SIGDN_FILESYSPATH, &pszPath)) && pszPath) {
                                        std::wstring norm = NormalizePath(pszPath);
                                        CoTaskMemFree(pszPath);
                                        if (!norm.empty() && _wcsicmp(norm.c_str(), normDesktop.c_str()) != 0) {
                                            result.push_back(norm);
                                        }
                                    }
                                    psi->Release();
                                }
                            }
                            psia->Release();
                        }
                        pfv->Release();
                    }
                    psv->Release();
                }
                psb->Release();
            }
            psp->Release();
        }
        pwba->Release();
    }
}

// ----------------- 获取资源管理器 & 桌面当前选中的文件 -----------------
std::vector<std::wstring> GetExplorerSelectedFiles() {
    std::vector<std::wstring> result;
    CoInitialize(NULL);

    wchar_t szDesktopDir[MAX_PATH] = { 0 };
    SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, szDesktopDir);
    std::wstring normDesktop = NormalizePath(szDesktopDir);

    IShellWindows* psw = NULL;
    if (SUCCEEDED(CoCreateInstance(CLSID_ShellWindows, NULL, CLSCTX_ALL, IID_IShellWindows, (void**)&psw))) {
        VARIANT vEmpty;
        VariantInit(&vEmpty);
        long hwndDesktop = 0;
        IDispatch* pdispDesktop = NULL;
        if (SUCCEEDED(psw->FindWindowSW(&vEmpty, &vEmpty, SWC_DESKTOP, &hwndDesktop, SWFO_NEEDDISPATCH, &pdispDesktop)) && pdispDesktop) {
            ExtractSelectedFromDispatch(pdispDesktop, normDesktop, result);
            pdispDesktop->Release();
        }

        long count = 0;
        psw->get_Count(&count);
        for (long i = 0; i < count; i++) {
            VARIANT v;
            V_VT(&v) = VT_I4;
            V_I4(&v) = i;
            IDispatch* pdisp = NULL;
            if (SUCCEEDED(psw->Item(v, &pdisp)) && pdisp) {
                ExtractSelectedFromDispatch(pdisp, normDesktop, result);
                pdisp->Release();
            }
        }
        psw->Release();
    }
    CoUninitialize();
    return result;
}

// ----------------- 获取剪贴板中的文件 -----------------
std::vector<std::wstring> GetClipboardFiles() {
    std::vector<std::wstring> result;
    if (OpenClipboard(NULL)) {
        HANDLE hDrop = GetClipboardData(CF_HDROP);
        if (hDrop) {
            HDROP h = (HDROP)GlobalLock(hDrop);
            if (h) {
                UINT count = DragQueryFileW(h, 0xFFFFFFFF, NULL, 0);
                for (UINT i = 0; i < count; i++) {
                    wchar_t szPath[MAX_PATH * 2] = { 0 };
                    if (DragQueryFileW(h, i, szPath, MAX_PATH * 2)) {
                        result.push_back(NormalizePath(szPath));
                    }
                }
                GlobalUnlock(hDrop);
            }
        } else {
            HANDLE hText = GetClipboardData(CF_UNICODETEXT);
            if (hText) {
                LPCWSTR text = (LPCWSTR)GlobalLock(hText);
                if (text) {
                    std::wstring s(text);
                    if (s.length() >= 3 && ((s[1] == L':' && (s[2] == L'\\' || s[2] == L'/')) || s.rfind(L"\\\\", 0) == 0)) {
                        result.push_back(NormalizePath(s));
                    }
                    GlobalUnlock(hText);
                }
            }
        }
        CloseClipboard();
    }
    return result;
}

// ----------------- 引擎 1：批量极速扫描运行中进程自身 EXE 镜像 -----------------
void ScanRunningProcessImagesBatch(std::vector<TargetFileInfo>& targets) {
    DWORD aProcesses[2048], cbNeeded, cProcesses;
    if (!EnumProcesses(aProcesses, sizeof(aProcesses), &cbNeeded)) return;
    cProcesses = cbNeeded / sizeof(DWORD);
    DWORD currentPid = GetCurrentProcessId();

    for (DWORD i = 0; i < cProcesses; i++) {
        DWORD pid = aProcesses[i];
        if (pid == 0 || pid == 4 || pid == currentPid) continue;

        HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!hProcess) continue;

        wchar_t szExeName[MAX_PATH * 2] = { 0 };
        DWORD size = sizeof(szExeName) / sizeof(wchar_t);
        if (QueryFullProcessImageNameW(hProcess, 0, szExeName, &size)) {
            std::wstring normExe = NormalizePath(szExeName);
            for (auto& t : targets) {
                if (PathMatches(normExe, t.normPath, t.isDir)) {
                    auto& holder = t.holders[pid];
                    holder.pid = pid;
                    holder.exePath = normExe;
                    const wchar_t* pName = PathFindFileNameW(normExe.c_str());
                    holder.appName = pName ? pName : L"";
                    holder.matchedPath = normExe;
                    holder.reason = L"RunningExecutable";
                }
            }
        }
        CloseHandle(hProcess);
    }
}

// ----------------- 引擎 2：批量 Restart Manager 极速探测 -----------------
void ScanWithRestartManagerBatch(std::vector<TargetFileInfo>& targets) {
    std::vector<LPCWSTR> fileNames;
    std::vector<size_t> targetIndices;

    for (size_t i = 0; i < targets.size(); i++) {
        if (!targets[i].isDir) {
            fileNames.push_back(targets[i].normPath.c_str());
            targetIndices.push_back(i);
        }
    }
    if (fileNames.empty()) return;

    DWORD dwSession;
    WCHAR szSessionKey[CCH_RM_SESSION_KEY + 1] = { 0 };
    DWORD dwError = RmStartSession(&dwSession, 0, szSessionKey);
    if (dwError != ERROR_SUCCESS) return;

    dwError = RmRegisterResources(dwSession, (UINT)fileNames.size(), &fileNames[0], 0, NULL, 0, NULL);
    if (dwError == ERROR_SUCCESS) {
        DWORD dwReason = 0;
        UINT nProcInfoNeeded = 0;
        UINT nProcInfo = 0;
        dwError = RmGetList(dwSession, &nProcInfoNeeded, &nProcInfo, NULL, &dwReason);
        if (dwError == ERROR_MORE_DATA && nProcInfoNeeded > 0) {
            std::vector<RM_PROCESS_INFO> procInfos(nProcInfoNeeded);
            nProcInfo = nProcInfoNeeded;
            dwError = RmGetList(dwSession, &nProcInfoNeeded, &nProcInfo, &procInfos[0], &dwReason);
            if (dwError == ERROR_SUCCESS) {
                DWORD currentPid = GetCurrentProcessId();
                for (UINT p = 0; p < nProcInfo; p++) {
                    DWORD pid = procInfos[p].Process.dwProcessId;
                    if (pid == 0 || pid == currentPid) continue;

                    for (size_t idx : targetIndices) {
                        auto& t = targets[idx];
                        auto& item = t.holders[pid];
                        item.pid = pid;
                        if (procInfos[p].strAppName[0] && item.appName.empty()) {
                            item.appName = procInfos[p].strAppName;
                        }
                        GetProcessDetails(pid, item.exePath, item.appName);
                        item.matchedPath = t.normPath;
                        if (item.reason.empty()) item.reason = L"RestartManager";
                    }
                }
            }
        }
    }
    RmEndSession(dwSession);
}

// ----------------- 引擎 3：快速全局内核句柄扫描 -----------------
void ScanSystemHandlesBatch(std::vector<TargetFileInfo>& targets, const std::map<std::wstring, std::wstring>& devMap) {
    if (!g_NtQuerySystemInformation || !g_NtQueryObject) return;

    bool needDeepScan = false;
    for (const auto& t : targets) {
        if (t.holders.empty() || t.isDir) {
            needDeepScan = true;
            break;
        }
    }
    if (!needDeepScan) return;

    wchar_t tempPath[MAX_PATH] = { 0 };
    GetTempPathW(MAX_PATH, tempPath);
    wchar_t tempFile[MAX_PATH] = { 0 };
    GetTempFileNameW(tempPath, L"unl", 0, tempFile);
    HANDLE hProbeFile = CreateFileW(tempFile, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);

    ULONG bufferSize = 16 * 1024 * 1024;
    PVOID buffer = VirtualAlloc(NULL, bufferSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!buffer) {
        if (hProbeFile != INVALID_HANDLE_VALUE) { CloseHandle(hProbeFile); DeleteFileW(tempFile); }
        return;
    }

    ULONG returnLength = 0;
    NTSTATUS status = g_NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, bufferSize, &returnLength);
    while (status != STATUS_SUCCESS && bufferSize < 128 * 1024 * 1024) {
        VirtualFree(buffer, 0, MEM_RELEASE);
        bufferSize *= 2;
        buffer = VirtualAlloc(NULL, bufferSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!buffer) break;
        status = g_NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, bufferSize, &returnLength);
    }

    if (status != STATUS_SUCCESS || !buffer) {
        if (hProbeFile != INVALID_HANDLE_VALUE) { CloseHandle(hProbeFile); DeleteFileW(tempFile); }
        if (buffer) VirtualFree(buffer, 0, MEM_RELEASE);
        return;
    }

    PSYSTEM_HANDLE_INFORMATION_EX handleInfoEx = (PSYSTEM_HANDLE_INFORMATION_EX)buffer;
    DWORD currentPid = GetCurrentProcessId();

    USHORT fileTypeIndex = 0;
    if (hProbeFile != INVALID_HANDLE_VALUE) {
        for (ULONG_PTR i = 0; i < handleInfoEx->NumberOfHandles; i++) {
            if ((DWORD)handleInfoEx->Handles[i].UniqueProcessId == currentPid &&
                (HANDLE)handleInfoEx->Handles[i].HandleValue == hProbeFile) {
                fileTypeIndex = handleInfoEx->Handles[i].ObjectTypeIndex;
                break;
            }
        }
        CloseHandle(hProbeFile);
        DeleteFileW(tempFile);
    }

    std::map<DWORD, HANDLE> procCache;
    std::vector<BYTE> nameBuf(2048);

    for (ULONG_PTR i = 0; i < handleInfoEx->NumberOfHandles; i++) {
        const SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX& entry = handleInfoEx->Handles[i];
        if (fileTypeIndex != 0 && entry.ObjectTypeIndex != fileTypeIndex) continue;
        DWORD pid = (DWORD)entry.UniqueProcessId;
        if (pid <= 4 || pid == currentPid) continue;

        HANDLE hProcess = NULL;
        auto it = procCache.find(pid);
        if (it != procCache.end()) {
            hProcess = it->second;
        } else {
            hProcess = OpenProcess(PROCESS_DUP_HANDLE, FALSE, pid);
            procCache[pid] = hProcess;
        }
        if (!hProcess) continue;

        HANDLE hDup = NULL;
        if (!DuplicateHandle(hProcess, (HANDLE)entry.HandleValue, GetCurrentProcess(), &hDup, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
            continue;
        }

        // 关键保护：必须校验是否是 DISK 文件，避免 NamedPipe 导致 NtQueryObject 挂起
        DWORD fType = GetFileType(hDup);
        if (fType != FILE_TYPE_DISK) {
            CloseHandle(hDup);
            continue;
        }

        ULONG retLen = 0;
        NTSTATUS ntStatus = g_NtQueryObject(hDup, (OBJECT_INFORMATION_CLASS)ObjectNameInformation, &nameBuf[0], (ULONG)nameBuf.size(), &retLen);
        if (ntStatus == STATUS_SUCCESS) {
            POBJECT_NAME_INFORMATION nameInfo = (POBJECT_NAME_INFORMATION)&nameBuf[0];
            if (nameInfo->Name.Buffer && nameInfo->Name.Length > 0) {
                std::wstring objName(nameInfo->Name.Buffer, nameInfo->Name.Length / sizeof(wchar_t));

                for (auto& target : targets) {
                    bool matched = PathMatches(objName, target.ntPath, target.isDir);
                    if (!matched) {
                        std::wstring dosCand = NtPathToDosPath(objName, devMap);
                        matched = PathMatches(dosCand, target.normPath, target.isDir);
                    }

                    if (matched) {
                        auto& holder = target.holders[pid];
                        holder.pid = pid;
                        holder.matchedPath = target.normPath;
                        if (holder.reason.empty()) {
                            holder.reason = target.isDir ? L"DirectoryHandle" : L"FileHandle";
                        }
                        holder.handles.push_back(entry.HandleValue);
                    }
                }
            }
        }
        CloseHandle(hDup);
    }

    for (auto& p : procCache) {
        if (p.second) CloseHandle(p.second);
    }

    VirtualFree(buffer, 0, MEM_RELEASE);

    for (auto& target : targets) {
        for (auto& pair : target.holders) {
            GetProcessDetails(pair.first, pair.second.exePath, pair.second.appName);
        }
    }
}

// ----------------- 关闭远程进程句柄 -----------------
bool CloseRemoteHandle(DWORD pid, ULONG_PTR handleValue) {
    HANDLE hProcess = OpenProcess(PROCESS_DUP_HANDLE, FALSE, pid);
    if (!hProcess) return false;
    HANDLE hDup = NULL;
    BOOL res = DuplicateHandle(hProcess, (HANDLE)handleValue, GetCurrentProcess(), &hDup, 0, FALSE, DUPLICATE_CLOSE_SOURCE);
    if (hDup) CloseHandle(hDup);
    CloseHandle(hProcess);
    return res != FALSE;
}

// ----------------- 重启 Windows 资源管理器 -----------------
bool RestartExplorerShell() {
    Sleep(300);
    HINSTANCE hInst = ShellExecuteW(NULL, L"open", L"explorer.exe", NULL, NULL, SW_SHOWNORMAL);
    return (INT_PTR)hInst > 32;
}

// ----------------- 终止远程进程 -----------------
bool KillProcessById(DWORD pid, bool& wasExplorer) {
    wasExplorer = false;
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
    if (!hProcess) {
        hProcess = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
    }
    if (!hProcess) return false;

    wchar_t szExeName[MAX_PATH * 2] = { 0 };
    DWORD size = sizeof(szExeName) / sizeof(wchar_t);
    if (QueryFullProcessImageNameW(hProcess, 0, szExeName, &size)) {
        std::wstring norm = NormalizePath(szExeName);
        std::transform(norm.begin(), norm.end(), norm.begin(), ::towlower);
        if (norm.length() >= 12 && norm.substr(norm.length() - 12) == L"explorer.exe") {
            wasExplorer = true;
        }
    }

    BOOL res = TerminateProcess(hProcess, 1);
    if (res) {
        WaitForSingleObject(hProcess, 1500);
    }
    CloseHandle(hProcess);

    if (res && wasExplorer) {
        RestartExplorerShell();
    }

    return res != FALSE;
}

int wmain(int argc, wchar_t* argv[]) {
    SetConsoleOutputCP(CP_UTF8);
    EnableDebugPrivilege();

    if (argc < 2) {
        std::cout << "Usage:\n  unlocker-helper list <path1> [path2...]\n  unlocker-helper list-batch <path1> [path2...]\n  unlocker-helper get-selected\n  unlocker-helper kill <pid>\n  unlocker-helper restart-explorer\n  unlocker-helper close-handle <pid> <handleHex>\n";
        return 0;
    }

    std::wstring cmd = argv[1];

    if (cmd == L"restart-explorer") {
        bool ok = RestartExplorerShell();
        std::cout << "{\"ok\": " << (ok ? "true" : "false") << "}\n";
        return ok ? 0 : 1;
    }

    if (cmd == L"get-selected") {
        std::set<std::wstring> uniqueFiles;
        auto expFiles = GetExplorerSelectedFiles();
        for (const auto& f : expFiles) if (!f.empty()) uniqueFiles.insert(f);

        if (uniqueFiles.empty()) {
            auto clipFiles = GetClipboardFiles();
            for (const auto& f : clipFiles) if (!f.empty()) uniqueFiles.insert(f);
        }

        std::cout << "[\n";
        bool first = true;
        for (const auto& f : uniqueFiles) {
            if (!first) std::cout << ",\n";
            first = false;
            std::cout << "  \"" << EscapeJsonString(f) << "\"";
        }
        std::cout << "\n]\n";
        return 0;
    }

    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (hNtdll) {
        g_NtQuerySystemInformation = (pfnNtQuerySystemInformation)GetProcAddress(hNtdll, "NtQuerySystemInformation");
        g_NtQueryObject = (pfnNtQueryObject)GetProcAddress(hNtdll, "NtQueryObject");
    }

    if ((cmd == L"list" || cmd == L"list-batch") && argc >= 3) {
        auto devMap = GetDosDeviceMap();
        std::vector<TargetFileInfo> targets;

        for (int i = 2; i < argc; i++) {
            TargetFileInfo t;
            t.originalPath = argv[i];
            t.normPath = NormalizePath(argv[i]);
            t.ntPath = DosPathToNtPath(t.normPath, devMap);
            DWORD attrs = GetFileAttributesW(t.normPath.c_str());
            t.isDir = (attrs != INVALID_FILE_ATTRIBUTES) && (attrs & FILE_ATTRIBUTE_DIRECTORY);
            targets.push_back(t);
        }

        // 极速 3 级流水线引擎
        ScanRunningProcessImagesBatch(targets);
        ScanWithRestartManagerBatch(targets);
        ScanSystemHandlesBatch(targets, devMap);

        // 单路径调用且使用 'list' 时返回数组格式（向下兼容）
        if (cmd == L"list" && targets.size() == 1) {
            std::cout << "[\n";
            bool first = true;
            for (const auto& pair : targets[0].holders) {
                const auto& h = pair.second;
                if (!first) std::cout << ",\n";
                first = false;

                std::cout << "  {\n";
                std::cout << "    \"pid\": " << h.pid << ",\n";
                std::cout << "    \"name\": \"" << EscapeJsonString(h.appName) << "\",\n";
                std::cout << "    \"exe\": \"" << EscapeJsonString(h.exePath) << "\",\n";
                std::cout << "    \"matchedPath\": \"" << EscapeJsonString(h.matchedPath) << "\",\n";
                std::cout << "    \"reason\": \"" << EscapeJsonString(h.reason) << "\",\n";
                std::cout << "    \"handles\": [";
                for (size_t i = 0; i < h.handles.size(); i++) {
                    if (i > 0) std::cout << ", ";
                    std::cout << "\"0x" << std::hex << h.handles[i] << std::dec << "\"";
                }
                std::cout << "]\n";
                std::cout << "  }";
            }
            std::cout << "\n]\n";
            return 0;
        }

        // 批量调用返回 JSON Map: { "path1": [ ... ], "path2": [ ... ] }
        std::cout << "{\n";
        bool firstTarget = true;
        for (const auto& t : targets) {
            if (!firstTarget) std::cout << ",\n";
            firstTarget = false;

            std::cout << "  \"" << EscapeJsonString(t.originalPath) << "\": [\n";
            bool firstHolder = true;
            for (const auto& pair : t.holders) {
                const auto& h = pair.second;
                if (!firstHolder) std::cout << ",\n";
                firstHolder = false;

                std::cout << "    {\n";
                std::cout << "      \"pid\": " << h.pid << ",\n";
                std::cout << "      \"name\": \"" << EscapeJsonString(h.appName) << "\",\n";
                std::cout << "      \"exe\": \"" << EscapeJsonString(h.exePath) << "\",\n";
                std::cout << "      \"matchedPath\": \"" << EscapeJsonString(h.matchedPath) << "\",\n";
                std::cout << "      \"reason\": \"" << EscapeJsonString(h.reason) << "\",\n";
                std::cout << "      \"handles\": [";
                for (size_t i = 0; i < h.handles.size(); i++) {
                    if (i > 0) std::cout << ", ";
                    std::cout << "\"0x" << std::hex << h.handles[i] << std::dec << "\"";
                }
                std::cout << "]\n";
                std::cout << "    }";
            }
            std::cout << "\n  ]";
        }
        std::cout << "\n}\n";
        return 0;
    }

    if (cmd == L"kill" && argc >= 3) {
        DWORD pid = (DWORD)_wtoi(argv[2]);
        bool wasExplorer = false;
        bool ok = KillProcessById(pid, wasExplorer);
        std::cout << "{\"ok\": " << (ok ? "true" : "false") << ", \"pid\": " << pid << ", \"restartedExplorer\": " << (wasExplorer ? "true" : "false") << "}\n";
        return ok ? 0 : 1;
    }

    if (cmd == L"close-handle" && argc >= 4) {
        DWORD pid = (DWORD)_wtoi(argv[2]);
        ULONG_PTR handleVal = (ULONG_PTR)wcstoull(argv[3], NULL, 0);
        bool ok = CloseRemoteHandle(pid, handleVal);
        std::cout << "{\"ok\": " << (ok ? "true" : "false") << "}\n";
        return ok ? 0 : 1;
    }

    return 0;
}
