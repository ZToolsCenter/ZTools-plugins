#include "clipboard_delayed_read_fixture.h"
#include "clipboard_probe.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <windows.h>

namespace clipboard_format_probe {
namespace {
constexpr wchar_t kOwnerClass[] = L"PasteboardG0DelayedOwner";

struct OwnerState {
  HDESK desktop = nullptr;
  HANDLE ready = nullptr;
  std::atomic<HWND> window{nullptr};
  std::atomic<bool> prepared{false};
};

void Marker(const char* value) {
  std::fputs(value, stderr);
  std::fflush(stderr);
}

LRESULT CALLBACK OwnerProcedure(HWND window, UINT message,
                                WPARAM wparam, LPARAM lparam) {
  if (message == WM_RENDERFORMAT && wparam == CF_UNICODETEXT) {
    Marker("fixture-entered\n");
    Sleep(10'000); // Deliberate fault: the supervised parent must kill this helper.
    return 0;
  }
  if (message == WM_RENDERALLFORMATS) return 0;
  if (message == WM_CLOSE) {
    DestroyWindow(window);
    return 0;
  }
  if (message == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

DWORD WINAPI OwnerThread(void* context) {
  auto* state = static_cast<OwnerState*>(context);
  bool prepared = false;
  const HINSTANCE instance = GetModuleHandleW(nullptr);
  ATOM registered = 0;
  HWND window = nullptr;
  if (SetThreadDesktop(state->desktop)) {
    WNDCLASSEXW definition{};
    definition.cbSize = sizeof(definition);
    definition.lpfnWndProc = OwnerProcedure;
    definition.hInstance = instance;
    definition.lpszClassName = kOwnerClass;
    registered = RegisterClassExW(&definition);
    if (registered != 0) {
      window = CreateWindowExW(WS_EX_TOOLWINDOW, kOwnerClass, L"",
          WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, instance, nullptr);
    }
    if (window != nullptr && OpenClipboard(window)) {
      SetLastError(ERROR_SUCCESS);
      const UINT first = EnumClipboardFormats(0);
      const DWORD enumeration_error = GetLastError();
      if (first == 0 && enumeration_error == ERROR_SUCCESS && EmptyClipboard()) {
        // NULL is intentional delayed rendering, not a serialized data handle.
        SetClipboardData(CF_UNICODETEXT, nullptr);
        prepared = IsClipboardFormatAvailable(CF_UNICODETEXT) &&
                   GetClipboardOwner() == window;
      }
      if (!CloseClipboard()) prepared = false;
    }
  }
  state->window.store(window);
  state->prepared.store(prepared);
  SetEvent(state->ready);
  if (prepared) {
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  if (window != nullptr && IsWindow(window)) DestroyWindow(window);
  state->window.store(nullptr);
  if (registered != 0) UnregisterClassW(kOwnerClass, instance);
  return prepared ? 0 : 1;
}

// The station may only be restored after its owning thread has finished.
void StopOwnedThread(HANDLE thread, DWORD thread_id, OwnerState* state) {
  const HWND window = state->window.load();
  if (window != nullptr) PostMessageW(window, WM_CLOSE, 0, 0);
  else PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
  if (WaitForSingleObject(thread, 1000) != WAIT_OBJECT_0) {
    Marker("fixture-cleanup-unconfirmed\n");
    // Only this test helper is terminated; never detach a thread using stack state.
    std::_Exit(73);
  }
  CloseHandle(thread);
}
}  // namespace

int RunDelayedReadFixture() {
  IsolatedWindowStation station;
  std::string error;
  if (!station.Enter(&error)) {
    Marker("fixture-isolation-unavailable\n");
    return 65;
  }
  Win32ClipboardAdapter reader;
  if (!reader.Initialize(&error)) {
    Marker("fixture-reader-unavailable\n");
    return 66;
  }
  OwnerState owner;
  owner.desktop = GetThreadDesktop(GetCurrentThreadId());
  owner.ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (owner.desktop == nullptr || owner.ready == nullptr) {
    if (owner.ready != nullptr) CloseHandle(owner.ready);
    Marker("fixture-control-unavailable\n");
    return 67;
  }
  DWORD thread_id = 0;
  HANDLE thread = CreateThread(nullptr, 0, OwnerThread, &owner, 0, &thread_id);
  if (thread == nullptr) {
    CloseHandle(owner.ready);
    Marker("fixture-owner-unavailable\n");
    return 68;
  }
  const bool ready = WaitForSingleObject(owner.ready, 1500) == WAIT_OBJECT_0 &&
                     owner.prepared.load();
  bool opened = false;
  if (ready && GetClipboardOwner() == owner.window.load() &&
      IsClipboardFormatAvailable(CF_UNICODETEXT)) {
    opened = OpenClipboard(reader.Window()) != FALSE;
  }
  if (opened) {
    Marker("read-call-started\n");
    const HANDLE data = GetClipboardData(CF_UNICODETEXT);
    (void)data;
    Marker("read-call-returned\n");
    CloseClipboard();
  } else {
    Marker("fixture-read-not-started\n");
  }
  StopOwnedThread(thread, thread_id, &owner);
  CloseHandle(owner.ready);
  reader.Shutdown();
  if (!station.Restore(&error)) {
    Marker("fixture-cleanup-unconfirmed\n");
    return 72;
  }
  // Returning is a failed fault test: only the parent-observed blocked read may pass.
  return opened ? 70 : 69;
}
}  // namespace clipboard_format_probe
